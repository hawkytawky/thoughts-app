import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  BlurStyle,
  Canvas,
  createPicture,
  PaintStyle,
  Picture,
  Skia,
  useClock,
  useFont,
} from "@shopify/react-native-skia";
import { InstrumentSans_500Medium } from "@expo-google-fonts/instrument-sans";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  LinearTransition,
  runOnJS,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
  noteCategoryColor,
} from "@/components/NoteUI";
import {
  type Graph,
  type GraphCluster,
  type GraphNode,
} from "@/lib/visualizations";

const PAD = 46;
const INITIAL_SCALE = 0.78;
const MIN_SCALE = 0.36;
const MAX_SCALE = 4;
const FIT_MARGIN_HORIZONTAL = 32;
const FIT_MARGIN_TOP = 36;
const FIT_MARGIN_BOTTOM = 112;
const CLUSTER_GAP = 48;
const FILTER_CONTEXT_NODE_ALPHA = 0.13;
const FILTER_CONTEXT_EDGE_ALPHA = 0.025;
const FILTER_BRIDGE_EDGE_ALPHA = 0.1;
const CLUSTER_CHIP_HEIGHT = 24;
const CLUSTER_CHIP_PAD_X = 10;
const MIN_TOPIC_RADIUS = 18;
const MAX_TOPIC_RADIUS = 34;

// High-contrast label drawn on top of the coloured dot.
const KEYWORD_INK = "#FBFAF7";

function clamp(v: number, lo: number, hi: number) {
  "worklet";
  return Math.min(hi, Math.max(lo, v));
}

// Clamped linear map, used for the zoom-driven label crossfades. Worklet-safe.
function lerpClamp(
  x: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  "worklet";
  const t = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  return y0 + (y1 - y0) * t;
}

function nodeDateKey(node: GraphNode): string {
  return node.date || node.capturedAt.slice(0, 10);
}

function thoughtDateLabel(node: GraphNode): string {
  if (node.dateLabel) return node.dateLabel;
  const date = nodeDateKey(node);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function TopicDensityTimeline({
  clusterId,
  color,
  nodes,
}: {
  clusterId: string;
  color: string;
  nodes: GraphNode[];
}) {
  const timeline = useMemo(() => {
    const validDates = nodes
      .map(nodeDateKey)
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    if (validDates.length === 0) return null;

    const firstThought = new Date(`${validDates[0]}T12:00:00`);
    const start = new Date(
      firstThought.getFullYear(),
      firstThought.getMonth(),
      1,
      12,
    );
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    const days: string[] = [];
    for (const cursor = new Date(start); cursor <= today; ) {
      days.push(localDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const countsByDay = new Map<string, number>();
    for (const node of nodes) {
      if (node.cluster !== clusterId) continue;
      const key = nodeDateKey(node);
      countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
    }

    const bucketSize = Math.max(1, Math.ceil(days.length / 180));
    const buckets: number[] = [];
    for (let index = 0; index < days.length; index += bucketSize) {
      let count = 0;
      for (let offset = 0; offset < bucketSize; offset++) {
        const day = days[index + offset];
        if (!day) break;
        count += countsByDay.get(day) ?? 0;
      }
      buckets.push(count);
    }

    const months: Array<{ key: string; label: string; days: number }> = [];
    for (
      const cursor = new Date(start);
      cursor <= today;
      cursor.setMonth(cursor.getMonth() + 1)
    ) {
      const monthStart = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        1,
        12,
      );
      const nextMonth = new Date(
        cursor.getFullYear(),
        cursor.getMonth() + 1,
        1,
        12,
      );
      const visibleEnd = nextMonth > today ? today : nextMonth;
      const visibleDays = Math.max(
        1,
        Math.round(
          (visibleEnd.getTime() - monthStart.getTime()) / 86_400_000,
        ) + (nextMonth > today ? 1 : 0),
      );
      months.push({
        key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
        label: new Intl.DateTimeFormat("de-DE", { month: "short" }).format(
          cursor,
        ),
        days: visibleDays,
      });
    }

    return {
      buckets,
      maxCount: Math.max(1, ...buckets),
      months,
      labelStep: Math.max(1, Math.ceil(months.length / 8)),
    };
  }, [clusterId, nodes]);

  if (!timeline) return null;

  return (
    <View style={styles.timeline}>
      <Text style={styles.timelineTitle}>VERLAUF</Text>
      <View style={styles.timelinePlot}>
        {timeline.buckets.map((count, index) => (
          <View key={index} style={styles.timelineBucket}>
            {count > 0 ? (
              <View
                style={[
                  styles.timelineBar,
                  {
                    backgroundColor: color,
                    height: 4 + (count / timeline.maxCount) * 22,
                    opacity: 0.38 + (count / timeline.maxCount) * 0.48,
                  },
                ]}
              />
            ) : null}
          </View>
        ))}
      </View>
      <View style={styles.timelineMonths}>
        {timeline.months.map((month, index) => (
          <View
            key={month.key}
            style={[styles.timelineMonth, { flex: month.days }]}
          >
            {index % timeline.labelStep === 0 ||
            index === timeline.months.length - 1 ? (
              <Text style={styles.timelineMonthLabel}>{month.label}</Text>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

type Pos = {
  idx: number;
  cluster: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  tcolor: string;
  keyword: string;
};

// Node draw-data lives in a shared value so the render worklet can read (and,
// while dragging, mutate) base positions without a React re-render. Colors stay
// as hex strings — they're cached to SkColor once per frame inside the worklet.
type NodeDraw = {
  cx: number;
  cy: number;
  r: number;
  cluster: string;
  color: string;
  tcolor: string;
  keyword: string;
};

type EdgeDraw = { source: number; target: number; weight: number };
type SecondaryEdgeDraw = {
  source: number;
  targetX: number;
  targetY: number;
  relevance: number;
  color: string;
};

type ClusterDraw = {
  id: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  radius: number;
  label: string;
  tcolor: string;
};

// Gentle repulsion so dots stop overlapping, anchored to keep clusters in
// place. Runs once per (graph, size) on the JS thread — cheap for our sizes.
function declutter(pos: Pos[]): void {
  const orig = pos.map((p) => ({ x: p.cx, y: p.cy }));
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const a = pos[i];
        const b = pos[j];
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = a.r + b.r + 10;
        if (d < min) {
          const push = (min - d) / 2;
          dx /= d;
          dy /= d;
          a.cx -= dx * push;
          a.cy -= dy * push;
          b.cx += dx * push;
          b.cy += dy * push;
        }
      }
    }
    for (let i = 0; i < pos.length; i++) {
      pos[i].cx += (orig[i].x - pos[i].cx) * 0.02;
      pos[i].cy += (orig[i].y - pos[i].cy) * 0.02;
    }
  }
}

// Preserve each topic's internal shape, then lay out the topic-level graph.
// Cross-topic connections create attraction; repulsion and collision merely
// keep the islands readable. The resulting distance therefore carries meaning.
function arrangeClusterIslands(pos: Pos[], edges: EdgeDraw[]): void {
  const groups = new Map<string, Pos[]>();
  for (const point of pos) {
    const group = groups.get(point.cluster) ?? [];
    group.push(point);
    groups.set(point.cluster, group);
  }

  const islands = Array.from(groups.entries()).map(([id, points]) => {
    const originalX =
      points.reduce((sum, point) => sum + point.cx, 0) / points.length;
    const originalY =
      points.reduce((sum, point) => sum + point.cy, 0) / points.length;
    let maxDistance = 0;
    for (const point of points) {
      maxDistance = Math.max(
        maxDistance,
        Math.hypot(point.cx - originalX, point.cy - originalY),
      );
    }

    // Very dispersed backend coordinates are gently compacted per topic;
    // their direction and relative ordering remain intact.
    const targetSpread = 34 + Math.sqrt(points.length) * 20;
    const compression = Math.min(1, targetSpread / Math.max(1, maxDistance));
    for (const point of points) {
      point.cx = originalX + (point.cx - originalX) * compression;
      point.cy = originalY + (point.cy - originalY) * compression;
    }
    declutter(points);

    const centerX =
      points.reduce((sum, point) => sum + point.cx, 0) / points.length;
    const centerY =
      points.reduce((sum, point) => sum + point.cy, 0) / points.length;
    const radius = points.reduce(
      (largest, point) =>
        Math.max(
          largest,
          Math.hypot(point.cx - centerX, point.cy - centerY) + point.r,
        ),
      0,
    );

    return {
      id,
      points,
      originalX,
      originalY,
      cx: centerX,
      cy: centerY,
      radius,
      vx: 0,
      vy: 0,
    };
  });

  const clusterByNode = new Map(pos.map((point) => [point.idx, point.cluster]));
  const islandById = new Map(islands.map((island, index) => [island.id, index]));
  const pairKey = (a: string, b: string) =>
    a < b ? `${a}:${b}` : `${b}:${a}`;
  const rawAffinity = new Map<string, number>();
  for (const edge of edges) {
    const sourceCluster = clusterByNode.get(edge.source);
    const targetCluster = clusterByNode.get(edge.target);
    if (
      sourceCluster == null ||
      targetCluster == null ||
      sourceCluster === targetCluster
    ) {
      continue;
    }
    const key = pairKey(sourceCluster, targetCluster);
    rawAffinity.set(key, (rawAffinity.get(key) ?? 0) + edge.weight);
  }

  const affinity = new Map<string, number>();
  let strongestAffinity = 0;
  for (const [key, weight] of rawAffinity) {
    const [aId, bId] = key.split(":");
    const a = islands[islandById.get(aId) ?? -1];
    const b = islands[islandById.get(bId) ?? -1];
    if (!a || !b) continue;
    const normalized = weight / Math.sqrt(a.points.length * b.points.length);
    affinity.set(key, normalized);
    strongestAffinity = Math.max(strongestAffinity, normalized);
  }
  if (strongestAffinity > 0) {
    for (const [key, value] of affinity) {
      affinity.set(key, value / strongestAffinity);
    }
  }

  for (let iteration = 0; iteration < 180; iteration++) {
    const fx = islands.map(
      (island) => (island.originalX - island.cx) * 0.0015,
    );
    const fy = islands.map(
      (island) => (island.originalY - island.cy) * 0.0015,
    );

    for (let i = 0; i < islands.length; i++) {
      for (let j = i + 1; j < islands.length; j++) {
        const a = islands[i];
        const b = islands[j];
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.01) {
          const angle = ((i * 37 + j * 61) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const nx = dx / distance;
        const ny = dy / distance;
        const minimumDistance = a.radius + b.radius + CLUSTER_GAP;
        let separationForce = Math.min(2.4, 4200 / (distance * distance));
        if (distance < minimumDistance) {
          separationForce += (minimumDistance - distance) * 0.12;
        }
        fx[i] -= nx * separationForce;
        fy[i] -= ny * separationForce;
        fx[j] += nx * separationForce;
        fy[j] += ny * separationForce;

        const relationship = affinity.get(pairKey(a.id, b.id)) ?? 0;
        if (relationship > 0) {
          const preferredDistance =
            minimumDistance + (1 - relationship) * 72;
          const spring =
            (distance - preferredDistance) *
            (0.01 + relationship * 0.025);
          fx[i] += nx * spring;
          fy[i] += ny * spring;
          fx[j] -= nx * spring;
          fy[j] -= ny * spring;
        }
      }
    }

    for (let i = 0; i < islands.length; i++) {
      const island = islands[i];
      island.vx = (island.vx + fx[i]) * 0.72;
      island.vy = (island.vy + fy[i]) * 0.72;
      const speed = Math.hypot(island.vx, island.vy);
      if (speed > 10) {
        island.vx = (island.vx / speed) * 10;
        island.vy = (island.vy / speed) * 10;
      }
      island.cx += island.vx;
      island.cy += island.vy;
    }
  }

  // Final collision pass is only a readability guard; it does not determine
  // where related clusters want to sit.
  for (let iteration = 0; iteration < 32; iteration++) {
    for (let i = 0; i < islands.length; i++) {
      for (let j = i + 1; j < islands.length; j++) {
        const a = islands[i];
        const b = islands[j];
        let dx = b.cx - a.cx;
        let dy = b.cy - a.cy;
        const distance = Math.hypot(dx, dy) || 0.01;
        const minimumDistance = a.radius + b.radius + CLUSTER_GAP;
        if (distance >= minimumDistance) continue;
        const push = (minimumDistance - distance) / 2;
        dx /= distance;
        dy /= distance;
        a.cx -= dx * push;
        a.cy -= dy * push;
        b.cx += dx * push;
        b.cy += dy * push;
      }
    }
  }

  for (const island of islands) {
    const centerX =
      island.points.reduce((sum, point) => sum + point.cx, 0) /
      island.points.length;
    const centerY =
      island.points.reduce((sum, point) => sum + point.cy, 0) /
      island.points.length;
    const offsetX = island.cx - centerX;
    const offsetY = island.cy - centerY;
    for (const point of island.points) {
      point.cx += offsetX;
      point.cy += offsetY;
    }
  }
}

export function OverviewGraph({
  filterNodeIndices = null,
  graph,
  onRetry,
  showHint = true,
  status,
}: {
  filterNodeIndices?: readonly number[] | null;
  graph: Graph | null;
  onRetry: () => void;
  showHint?: boolean;
  status: "loading" | "error" | "ready";
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<GraphCluster | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(INITIAL_SCALE);
  const prevScale = useSharedValue(1);

  // Peek shows a few lines; expanded shows the whole thought. The card hugs
  // its text exactly, so it always ends right at the last line.
  const dragY = useSharedValue(0);

  // Imperative render state (UI thread).
  const clock = useClock();
  const keywordFont = useFont(InstrumentSans_500Medium, 11);
  const clusterFont = useFont(InstrumentSans_500Medium, 12);
  const nodesSV = useSharedValue<NodeDraw[]>([]);
  const edgesSV = useSharedValue<EdgeDraw[]>([]);
  const secondaryEdgesSV = useSharedValue<SecondaryEdgeDraw[]>([]);
  const clustersSV = useSharedValue<ClusterDraw[]>([]);
  const selectedIdxSV = useSharedValue<number>(-1);
  const selectedClusterIdSV = useSharedValue<string | null>(null);
  const neighborFlagsSV = useSharedValue<number[]>([]);
  const dragIdx = useSharedValue<number>(-1);
  // 1 per node when a date filter is active and that node matches; empty
  // array means "no filter", which the worklet treats as everything visible.
  const matchFlagsSV = useSharedValue<number[]>([]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const secondaryEdges = graph?.secondaryTopicEdges ?? [];
  const clusters = graph?.clusters ?? [];

  useEffect(() => {
    setSelected((current) =>
      current
        ? (graph?.nodes.find((node) => node.id === current.id) ?? null)
        : null,
    );
    setSelectedCluster((current) =>
      current
        ? (graph?.clusters.find((cluster) => cluster.id === current.id) ?? null)
        : null,
    );
  }, [graph]);

  const layout = useMemo(() => {
    const w = Math.max(0, size.w - PAD * 2);
    const h = Math.max(0, size.h - PAD * 2);
    const clusterById = new Map(
      clusters.map((cluster) => [cluster.id, cluster]),
    );
    const worldPoints = [
      ...clusters.map((cluster) => ({
        x: cluster.anchorX,
        y: cluster.anchorY,
      })),
      ...nodes.map((node) => ({ x: node.x, y: node.y })),
    ];
    const minX = Math.min(...worldPoints.map(({ x }) => x), 0);
    const maxX = Math.max(...worldPoints.map(({ x }) => x), 1);
    const minY = Math.min(...worldPoints.map(({ y }) => y), 0);
    const maxY = Math.max(...worldPoints.map(({ y }) => y), 1);
    const projectX = (x: number) => PAD + ((x - minX) / (maxX - minX || 1)) * w;
    const projectY = (y: number) => PAD + ((y - minY) / (maxY - minY || 1)) * h;
    const pos: Pos[] = nodes.map((n) => {
      const fill = clusterById.get(n.cluster)?.color ?? C.ink40;
      return {
        idx: n.idx,
        cluster: n.cluster,
        cx: projectX(n.x),
        cy: projectY(n.y),
        r: clamp(n.size * 0.42, 4.5, 8.5),
        color: fill,
        tcolor: fill,
        keyword: n.keyword,
      };
    });
    if (pos.length && w > 0 && h > 0) {
      for (const cluster of clusters) {
        declutter(pos.filter((point) => point.cluster === cluster.id));
      }
    }
    const centroids = clusters.map((c) => {
      return {
        ...c,
        cx: projectX(c.anchorX),
        cy: projectY(c.anchorY),
        paletteColor: c.color,
      };
    });
    return { pos, centroids };
  }, [graph, size]);

  // Push layout into the shared values the worklet reads. Resets drag state.
  useEffect(() => {
    nodesSV.value = layout.pos.map((p) => ({
      cx: p.cx,
      cy: p.cy,
      r: p.r,
      cluster: p.cluster,
      color: p.color,
      tcolor: p.tcolor,
      keyword: p.keyword,
    }));
    edgesSV.value = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
    }));
    const centroidById = new Map(
      layout.centroids.map((cluster) => [cluster.id, cluster]),
    );
    secondaryEdgesSV.value = secondaryEdges.flatMap((edge) => {
      const target = centroidById.get(edge.targetTopicId);
      return target
        ? [{
            source: edge.source,
            targetX: target.cx,
            targetY: target.cy,
            relevance: edge.relevance,
            color: target.color,
          }]
        : [];
    });
    clustersSV.value = layout.centroids.map((c) => ({
      id: c.id,
      cx: c.cx,
      cy: c.cy,
      width:
        (clusterFont?.measureText(c.label).width ?? c.label.length * 7) +
        CLUSTER_CHIP_PAD_X * 2,
      height: CLUSTER_CHIP_HEIGHT,
      radius: clamp(
        MIN_TOPIC_RADIUS + Math.sqrt(Math.max(1, c.count)) * 2.5,
        MIN_TOPIC_RADIUS,
        MAX_TOPIC_RADIUS,
      ),
      label: c.label,
      tcolor: c.paletteColor,
    }));
    dragIdx.value = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, clusterFont]);

  useEffect(() => {
    selectedClusterIdSV.value = selectedCluster?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCluster]);

  // focus: selected node + neighbours → 0/1 flags for per-node/edge dimming.
  useEffect(() => {
    const idx = selected?.idx ?? -1;
    selectedIdxSV.value = idx;
    const flags = new Array(nodes.length).fill(0);
    if (idx >= 0) {
      if (idx < flags.length) flags[idx] = 1;
      for (const e of edges) {
        if (e.source === idx && e.target < flags.length) flags[e.target] = 1;
        if (e.target === idx && e.source < flags.length) flags[e.source] = 1;
      }
    }
    neighborFlagsSV.value = flags;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, graph]);

  const matchCount = filterNodeIndices?.length ?? 0;
  useEffect(() => {
    if (filterNodeIndices == null) {
      matchFlagsSV.value = [];
      return;
    }
    const matchingIndices = new Set(filterNodeIndices);
    matchFlagsSV.value = nodes.map((node) =>
      matchingIndices.has(node.idx) ? 1 : 0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterNodeIndices, graph]);

  const selectByIndex = (i: number) => {
    setExpanded(false);
    setSelected(i >= 0 ? nodes[i] : null);
  };

  const selectClusterById = (id: string) => {
    setExpanded(false);
    setSelected(null);
    dragY.value = 0;
    setSelectedCluster((current) =>
      current?.id === id
        ? null
        : (clusters.find((cluster) => cluster.id === id) ?? null),
    );
  };

  const clearSelection = () => {
    setExpanded(false);
    setSelected(null);
    setSelectedCluster(null);
  };

  const collapseOrClose = () => {
    if (expanded) setExpanded(false);
    else setSelected(null);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  useEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;

    if (layout.pos.length === 0) {
      scale.value = INITIAL_SCALE;
      prevScale.value = 1;
      tx.value = (size.w * (1 - INITIAL_SCALE)) / 2;
      ty.value = (size.h * (1 - INITIAL_SCALE)) / 2;
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of layout.pos) {
      minX = Math.min(minX, node.cx - node.r);
      maxX = Math.max(maxX, node.cx + node.r);
      minY = Math.min(minY, node.cy - node.r);
      maxY = Math.max(maxY, node.cy + node.r);
    }
    for (const topic of layout.centroids) {
      const radius = clamp(
        MIN_TOPIC_RADIUS + Math.sqrt(Math.max(1, topic.count)) * 2.5,
        MIN_TOPIC_RADIUS,
        MAX_TOPIC_RADIUS,
      );
      minX = Math.min(minX, topic.cx - radius);
      maxX = Math.max(maxX, topic.cx + radius);
      minY = Math.min(minY, topic.cy - radius);
      maxY = Math.max(maxY, topic.cy + radius + CLUSTER_CHIP_HEIGHT);
    }

    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const availableHeight = Math.max(
      1,
      size.h - FIT_MARGIN_TOP - FIT_MARGIN_BOTTOM,
    );
    const fitScale = Math.min(
      (size.w - FIT_MARGIN_HORIZONTAL * 2) / graphWidth,
      availableHeight / graphHeight,
    );
    const nextScale = clamp(
      Math.min(INITIAL_SCALE, fitScale * 0.94),
      MIN_SCALE,
      INITIAL_SCALE,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    scale.value = nextScale;
    prevScale.value = 1;
    tx.value = size.w / 2 - centerX * nextScale;
    ty.value =
      FIT_MARGIN_TOP + availableHeight / 2 - centerY * nextScale;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, size.w, size.h]);

  // ---- canvas gestures ----
  // Pan doubles as node-drag: grab a node on begin, then either move that node
  // (in base coords) or pan the whole canvas.
  const pan = Gesture.Pan()
    .onBegin((e) => {
      const s = scale.value;
      const cs = clustersSV.value;
      if (lerpClamp(s, 1.15, 1.65, 1, 0) > 0.05) {
        for (let i = cs.length - 1; i >= 0; i--) {
          const cluster = cs[i];
          const sx = tx.value + cluster.cx * s;
          const sy = ty.value + cluster.cy * s;
          if (
            Math.hypot(e.x - sx, e.y - sy) <= cluster.radius * s + 8
          ) {
            dragIdx.value = -1;
            return;
          }
        }
      }
      const bx = (e.x - tx.value) / scale.value;
      const by = (e.y - ty.value) / scale.value;
      const ns = nodesSV.value;
      const clusterFocus = selectedClusterIdSV.value;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < ns.length; i++) {
        const p = ns[i];
        if (clusterFocus !== null && p.cluster !== clusterFocus) continue;
        const d = (p.cx - bx) ** 2 + (p.cy - by) ** 2;
        const hit = (p.r + 8) ** 2;
        if (d < hit && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      dragIdx.value = best;
    })
    .onChange((e) => {
      const i = dragIdx.value;
      if (i >= 0) {
        const ns = nodesSV.value;
        if (i < ns.length) {
          ns[i].cx += e.changeX / scale.value;
          ns[i].cy += e.changeY / scale.value;
          nodesSV.value = ns;
        }
      } else {
        tx.value += e.changeX;
        ty.value += e.changeY;
      }
    })
    .onFinalize(() => {
      dragIdx.value = -1;
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      prevScale.value = 1;
    })
    .onUpdate((e) => {
      const factor = e.scale / prevScale.value;
      prevScale.value = e.scale;
      const newScale = clamp(scale.value * factor, MIN_SCALE, MAX_SCALE);
      const applied = newScale / scale.value;
      tx.value = e.focalX - (e.focalX - tx.value) * applied;
      ty.value = e.focalY - (e.focalY - ty.value) * applied;
      scale.value = newScale;
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((e) => {
      const s = scale.value;
      const px = tx.value;
      const py = ty.value;
      const cs = clustersSV.value;
      const clusterAlpha = lerpClamp(s, 1.15, 1.65, 1, 0);
      if (clusterAlpha > 0.05) {
        for (let i = cs.length - 1; i >= 0; i--) {
          const cluster = cs[i];
          const sx = px + cluster.cx * s;
          const sy = py + cluster.cy * s;
          if (
            Math.hypot(e.x - sx, e.y - sy) <= cluster.radius * s + 8
          ) {
            runOnJS(selectClusterById)(cluster.id);
            return;
          }
        }
      }

      const bx = (e.x - tx.value) / scale.value;
      const by = (e.y - ty.value) / scale.value;
      const ns = nodesSV.value;
      const clusterFocus = selectedClusterIdSV.value;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < ns.length; i++) {
        const p = ns[i];
        if (clusterFocus !== null && p.cluster !== clusterFocus) continue;
        const d = (p.cx - bx) ** 2 + (p.cy - by) ** 2;
        const hit = Math.max(p.r + 8, 16) ** 2;
        if (d < hit && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best >= 0) runOnJS(selectByIndex)(best);
      else runOnJS(clearSelection)();
    });

  const canvasGesture = Gesture.Simultaneous(pan, pinch, tap);

  // Thought card drag: swipe up expands, swipe down collapses then dismisses.
  const cardPan = Gesture.Pan()
    .onChange((e) => {
      dragY.value = clamp(dragY.value + e.changeY * 0.5, -30, 90);
    })
    .onEnd((e) => {
      const y = dragY.value;
      const v = e.velocityY;
      dragY.value = withTiming(0, {
        duration: 160,
        easing: Easing.out(Easing.quad),
      });
      if (y < -14 || v < -650) {
        runOnJS(setExpanded)(true);
      } else if (y > 32 || v > 650) {
        runOnJS(collapseOrClose)();
      }
    });

  const clusterPan = Gesture.Pan()
    .onChange((e) => {
      dragY.value = clamp(dragY.value + e.changeY * 0.5, 0, 90);
    })
    .onEnd((e) => {
      const y = dragY.value;
      const v = e.velocityY;
      dragY.value = withTiming(0, {
        duration: 160,
        easing: Easing.out(Easing.quad),
      });
      if (y > 32 || v > 650) {
        runOnJS(setSelectedCluster)(null);
      }
    });

  // Imperative Skia picture, redrawn every frame on the UI thread (clock tick).
  const picture = useDerivedValue(() =>
    createPicture((canvas) => {
      "worklet";
      const kFont = keywordFont;
      const cFont = clusterFont;
      const t = clock.value;
      const s = scale.value;
      const px = tx.value;
      const py = ty.value;
      const ns = nodesSV.value;
      const es = edgesSV.value;
      const secondary = secondaryEdgesSV.value;
      const cs = clustersSV.value;
      const selIdx = selectedIdxSV.value;
      const clusterFocus = selectedClusterIdSV.value;
      const flags = neighborFlagsSV.value;
      const match = matchFlagsSV.value;
      const filtering = match.length > 0;
      const matches = (i: number) => !filtering || match[i] === 1;

      // Cache hex → SkColor once per frame (few unique colors).
      const cache: Record<string, ReturnType<typeof Skia.Color>> = {};
      const col = (hex: string) => {
        if (!cache[hex]) cache[hex] = Skia.Color(hex);
        return cache[hex];
      };

      const edgePaint = Skia.Paint();
      edgePaint.setAntiAlias(true);
      edgePaint.setStyle(PaintStyle.Stroke);

      const shadowPaint = Skia.Paint();
      shadowPaint.setAntiAlias(true);
      shadowPaint.setColor(col(C.ink));
      shadowPaint.setMaskFilter(
        Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 2.0, true),
      );

      const ringPaint = Skia.Paint();
      ringPaint.setAntiAlias(true);
      ringPaint.setColor(col(C.paper));

      const nodePaint = Skia.Paint();
      nodePaint.setAntiAlias(true);

      const selPaint = Skia.Paint();
      selPaint.setAntiAlias(true);
      selPaint.setStyle(PaintStyle.Stroke);
      selPaint.setStrokeWidth(0.75);
      selPaint.setColor(col(C.ink));
      selPaint.setAlphaf(0.7);

      const textPaint = Skia.Paint();
      textPaint.setAntiAlias(true);

      // Topic "toggle" chips: soft paper fill + thin coloured outline.
      const chipFill = Skia.Paint();
      chipFill.setAntiAlias(true);
      chipFill.setColor(col(C.card));

      const chipStroke = Skia.Paint();
      chipStroke.setAntiAlias(true);
      chipStroke.setStyle(PaintStyle.Stroke);
      chipStroke.setStrokeWidth(1);

      const membershipPaint = Skia.Paint();
      membershipPaint.setAntiAlias(true);
      membershipPaint.setStyle(PaintStyle.Stroke);
      membershipPaint.setStrokeWidth(0.8);

      const topicPaint = Skia.Paint();
      topicPaint.setAntiAlias(true);

      const topicOutlinePaint = Skia.Paint();
      topicOutlinePaint.setAntiAlias(true);
      topicOutlinePaint.setStyle(PaintStyle.Stroke);
      topicOutlinePaint.setStrokeWidth(1.4);

      // Ambient drift — per node i, applied on top of (draggable) base pos.
      const n = ns.length;
      const dcx: number[] = [];
      const dcy: number[] = [];
      for (let i = 0; i < n; i++) {
        dcx[i] = ns[i].cx + 1.5 * Math.sin(t * 0.00055 + i * 1.3);
        dcy[i] = ns[i].cy + 1.5 * Math.cos(t * 0.00048 + i * 0.9);
      }

      canvas.save();
      canvas.translate(px, py);
      canvas.scale(s, s);

      // 1) Membership spokes expose the parent topic of every Thought.
      for (let i = 0; i < n; i++) {
        const node = ns[i];
        for (let j = 0; j < cs.length; j++) {
          const topic = cs[j];
          if (topic.id !== node.cluster) continue;
          const focusDim =
            clusterFocus !== null && node.cluster !== clusterFocus;
          const filterContext = filtering && !matches(i);
          membershipPaint.setColor(col(topic.tcolor));
          membershipPaint.setAlphaf(
            focusDim ? 0.018 : filterContext ? 0.025 : 0.16,
          );
          canvas.drawLine(
            topic.cx,
            topic.cy,
            dcx[i],
            dcy[i],
            membershipPaint,
          );
          break;
        }
      }

      // 2) Similarity and secondary-topic edges.
      for (let i = 0; i < secondary.length; i++) {
        const edge = secondary[i];
        if (edge.source >= n) continue;
        const source = ns[edge.source];
        const dimmed =
          clusterFocus !== null && source.cluster !== clusterFocus;
        edgePaint.setColor(col(edge.color));
        edgePaint.setAlphaf(dimmed ? 0.015 : 0.07 + edge.relevance * 0.11);
        edgePaint.setStrokeWidth(0.6 + edge.relevance * 0.8);
        canvas.drawLine(
          dcx[edge.source],
          dcy[edge.source],
          edge.targetX,
          edge.targetY,
          edgePaint,
        );
      }
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        const a = e.source;
        const b = e.target;
        if (a >= n || b >= n) continue;
        const incident = selIdx >= 0 && (a === selIdx || b === selIdx);
        const normalizedWeight = clamp((e.weight - 0.3) / 0.7, 0, 1);
        const insideFocusedCluster =
          clusterFocus !== null &&
          ns[a].cluster === clusterFocus &&
          ns[b].cluster === clusterFocus;
        let op = 0.13 + 0.28 * normalizedWeight;
        let c = col(C.border);
        let sw = 0.75 + 1.75 * normalizedWeight;
        if (clusterFocus !== null) {
          if (insideFocusedCluster) {
            op = 0.2 + 0.38 * normalizedWeight;
            c = col(ns[a].color);
            sw = 1 + 2 * normalizedWeight;
          } else {
            op = 0.018;
            sw = 0.6;
          }
        }
        if (selIdx >= 0) {
          if (incident) {
            op = 0.28 + 0.42 * normalizedWeight;
            c = col(ns[a].color);
            sw = 1.25 + 2.25 * normalizedWeight;
          } else {
            op = insideFocusedCluster ? 0.05 : 0.02;
          }
        }
        // Keep the whole topology visible under a date filter. Connections
        // outside the selected period recede, but still provide spatial context.
        if (filtering) {
          const aMatches = matches(a);
          const bMatches = matches(b);
          if (!aMatches && !bMatches) {
            op = Math.min(op, FILTER_CONTEXT_EDGE_ALPHA);
          } else if (!aMatches || !bMatches) {
            op = Math.min(op, FILTER_BRIDGE_EDGE_ALPHA);
          }
        }
        edgePaint.setColor(c);
        edgePaint.setAlphaf(op);
        edgePaint.setStrokeWidth(sw);
        canvas.drawLine(dcx[a], dcy[a], dcx[b], dcy[b], edgePaint);
      }

      // 3) Large topic nodes sit behind their smaller Thought points.
      for (let i = 0; i < cs.length; i++) {
        const topic = cs[i];
        const active = clusterFocus === topic.id;
        const dimmed = clusterFocus !== null && !active;
        topicPaint.setColor(col(topic.tcolor));
        topicPaint.setAlphaf(dimmed ? 0.08 : active ? 0.92 : 0.72);
        canvas.drawCircle(topic.cx, topic.cy, topic.radius, topicPaint);
        topicOutlinePaint.setColor(col(topic.tcolor));
        topicOutlinePaint.setStrokeWidth(active ? 2.6 : 1.4);
        topicOutlinePaint.setAlphaf(dimmed ? 0.1 : 0.92);
        canvas.drawCircle(
          topic.cx,
          topic.cy,
          topic.radius + (active ? 3 : 0),
          topicOutlinePaint,
        );
      }

      // 4) Thoughts — deliberately smaller than their parent topic.
      for (let i = 0; i < n; i++) {
        const node = ns[i];
        const focusDim =
          (clusterFocus !== null && node.cluster !== clusterFocus) ||
          (selIdx >= 0 && flags.length > i && flags[i] === 0);
        const filterContext = filtering && !matches(i);
        const alpha = focusDim
          ? 0.07
          : filterContext
            ? FILTER_CONTEXT_NODE_ALPHA
            : selIdx < 0 && !filtering
              ? 0.92
              : 0.97;
        shadowPaint.setAlphaf(focusDim ? 0.04 : filterContext ? 0.02 : 0.1);
        canvas.drawCircle(dcx[i], dcy[i] + 1.6, node.r, shadowPaint);
        ringPaint.setAlphaf(alpha);
        canvas.drawCircle(dcx[i], dcy[i], node.r + 1, ringPaint);
        nodePaint.setColor(col(node.color));
        nodePaint.setAlphaf(alpha);
        canvas.drawCircle(dcx[i], dcy[i], node.r, nodePaint);
        // Ring every match so the picked day stands out even when zoomed out.
        if (filtering && match[i] === 1) {
          canvas.drawCircle(dcx[i], dcy[i], node.r + 4, selPaint);
        }
      }

      // 5) Thought selection ring.
      if (selIdx >= 0 && selIdx < n) {
        canvas.drawCircle(dcx[selIdx], dcy[selIdx], ns[selIdx].r + 3, selPaint);
      }

      canvas.restore();

      // 6) labels in SCREEN space (constant size). Topic labels fade out and
      // node keywords fade in as you zoom — matching the old overlay.
      const clusterA = lerpClamp(s, 1.15, 1.65, 1, 0);
      if (cFont && clusterA > 0.01) {
        const m = cFont.getMetrics();
        const asc = -m.ascent;
        const desc = m.descent;
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i];
          if (filtering) {
            let clusterHasMatch = false;
            for (let j = 0; j < n; j++) {
              if (ns[j].cluster === c.id && matches(j)) {
                clusterHasMatch = true;
                break;
              }
            }
            if (!clusterHasMatch) continue;
          }
          const active = clusterFocus === c.id;
          const dim = clusterFocus !== null && !active;
          const pillAlpha = clusterA * (dim ? 0.18 : 1);
          const sx = px + c.cx * s;
          const sy = py + c.cy * s + c.radius * s + 13;
          const w = cFont.measureText(c.label).width;
          const chipW = c.width;
          const chipH = c.height;
          const rect = Skia.XYWHRect(
            sx - chipW / 2,
            sy - chipH / 2,
            chipW,
            chipH,
          );
          const rrect = Skia.RRectXY(rect, chipH / 2, chipH / 2);
          chipFill.setColor(col(C.card));
          chipFill.setAlphaf((active ? 0.98 : 0.9) * pillAlpha);
          canvas.drawRRect(rrect, chipFill);
          chipStroke.setColor(col(c.tcolor));
          chipStroke.setStrokeWidth(active ? 1.8 : 1);
          chipStroke.setAlphaf(0.9 * pillAlpha);
          canvas.drawRRect(rrect, chipStroke);
          textPaint.setColor(col(C.ink));
          textPaint.setAlphaf(pillAlpha);
          canvas.drawText(
            c.label,
            sx - w / 2,
            sy + (asc - desc) / 2,
            textPaint,
            cFont,
          );
        }
      }

      const keywordA = lerpClamp(s, 1.35, 1.85, 0, 1);
      if (kFont && keywordA > 0.01) {
        for (let i = 0; i < n; i++) {
          const node = ns[i];
          const focusDim =
            (clusterFocus !== null && node.cluster !== clusterFocus) ||
            (selIdx >= 0 && flags.length > i && flags[i] === 0);
          const filterContext = filtering && !matches(i);
          const a2 =
            keywordA *
            (filterContext ? 0 : focusDim ? 0.2 : 1);
          if (a2 < 0.01) continue;
          const sx = px + dcx[i] * s;
          const sy = py + dcy[i] * s;
          const w = kFont.measureText(node.keyword).width;
          textPaint.setColor(col(KEYWORD_INK));
          textPaint.setAlphaf(a2);
          // Centred on the dot rather than below it.
          canvas.drawText(node.keyword, sx - w / 2, sy + 4, textPaint, kFont);
        }
      }
    }),
  );

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragY.value }],
  }));

  return (
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={canvasGesture}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={picture} />
          </Canvas>
        </View>
      </GestureDetector>

      {showHint && status === "ready" && nodes.length > 0 ? (
        <View pointerEvents="none" style={styles.hintRow}>
          <Text style={styles.hint}>
            {filterNodeIndices != null
              ? matchCount === 1
                ? "1 Gedanke an diesem Tag"
                : `${matchCount} Gedanken an diesem Tag`
              : `${nodes.length} Gedanken · ${clusters.length} Themen`}
          </Text>
        </View>
      ) : null}

      {status === "loading" ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={C.sky} />
        </View>
      ) : null}

      {status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.stateText}>
            Die Karte konnte nicht geladen werden.
          </Text>
          <Pressable onPress={onRetry} style={styles.retry} hitSlop={8}>
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : null}

      {status === "ready" && nodes.length === 0 ? (
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.stateText}>
            Noch nicht genug Gedanken für eine Karte.
          </Text>
          <Text style={styles.stateHint}>
            Nimm ein paar Gedanken auf — sie erscheinen hier automatisch.
          </Text>
        </View>
      ) : null}

      {selected ? (
        <GestureDetector gesture={cardPan}>
          <Animated.View
            key={selected.idx}
            style={[
              styles.sheet,
              cardStyle,
              expanded && styles.expandedSheet,
              expanded && { maxHeight: Math.max(220, size.h - 12) },
            ]}
            entering={SlideInDown.duration(240)}
            exiting={SlideOutDown.duration(180)}
            layout={LinearTransition.duration(220)}
          >
            <View style={styles.handle} />
            <View style={styles.cardHeader}>
              <View style={styles.typeRow}>
                <View
                  style={[
                    styles.typeDot,
                    { backgroundColor: noteCategoryColor(selected.type) },
                  ]}
                />
                <Text style={styles.typeLabel}>{selected.type}</Text>
              </View>
              {thoughtDateLabel(selected) ? (
                <Text style={styles.cardDate}>
                  {thoughtDateLabel(selected)}
                </Text>
              ) : null}
            </View>
            <Text style={styles.cardTitle}>{selected.title}</Text>
            {expanded ? (
              <ScrollView
                style={[
                  styles.cardBodyScroll,
                  { maxHeight: Math.max(120, size.h - 170) },
                ]}
                contentContainerStyle={styles.cardBodyScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.cardBody}>
                  {selected.summary || selected.subtitle}
                </Text>
              </ScrollView>
            ) : (
              <Text style={styles.cardBody} numberOfLines={4}>
                {selected.summary || selected.subtitle}
              </Text>
            )}
          </Animated.View>
        </GestureDetector>
      ) : selectedCluster ? (
        <GestureDetector gesture={clusterPan}>
          <Animated.View
            key={`cluster-${selectedCluster.id}`}
            style={[styles.sheet, styles.clusterSheet, cardStyle]}
            entering={SlideInDown.duration(240)}
            exiting={SlideOutDown.duration(180)}
            layout={LinearTransition.duration(220)}
          >
            <View style={styles.handle} />
            <View style={styles.clusterHeader}>
              <View style={styles.clusterTitleRow}>
                <View
                  style={[
                    styles.clusterDot,
                    { backgroundColor: selectedCluster.color },
                  ]}
                />
                <Text style={styles.clusterLabel}>{selectedCluster.label}</Text>
              </View>
            </View>
            <Text style={styles.clusterCount}>
              {selectedCluster.count === 1
                ? "1 Gedanke"
                : `${selectedCluster.count} Gedanken`}
            </Text>
            <Text style={styles.clusterDescription}>
              {selectedCluster.description ??
                "Für dieses Thema wird gerade eine kurze Beschreibung erstellt."}
            </Text>
            <TopicDensityTimeline
              clusterId={selectedCluster.id}
              color={selectedCluster.color}
              nodes={nodes}
            />
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent", overflow: "hidden" },
  hintRow: {
    position: "absolute",
    top: 8,
    left: 16,
    right: 16,
  },
  hint: { fontFamily: NOTE_SANS, fontSize: 12, color: C.ink40 },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 32,
  },
  stateText: {
    fontFamily: NOTE_SERIF,
    fontSize: 16,
    color: C.ink60,
    textAlign: "center",
  },
  stateHint: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    color: C.ink40,
    textAlign: "center",
  },
  retry: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: C.skyLight,
  },
  retryText: { fontFamily: NOTE_SANS_MEDIUM, fontSize: 13, color: C.skyDeep },
  sheet: {
    position: "absolute",
    left: 4,
    right: 4,
    bottom: 0,
    backgroundColor: C.card,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 18,
    shadowColor: C.ink,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -5 },
    elevation: 8,
  },
  expandedSheet: { overflow: "hidden" },
  clusterSheet: { paddingTop: 8 },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: "rgba(138,163,184,0.5)",
    alignSelf: "center",
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  typeRow: { flexDirection: "row", alignItems: "center" },
  typeDot: { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  typeLabel: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    letterSpacing: 0.6,
    color: C.ink60,
    textTransform: "uppercase",
  },
  cardTitle: {
    fontFamily: NOTE_SERIF,
    fontSize: 22,
    lineHeight: 28,
    color: C.ink,
    marginBottom: 8,
  },
  cardDate: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    color: C.ink40,
  },
  cardBody: {
    fontFamily: NOTE_SANS,
    fontSize: 14.5,
    lineHeight: 22,
    color: C.ink70,
    marginTop: 2,
  },
  cardBodyScroll: { flexGrow: 0, flexShrink: 1 },
  cardBodyScrollContent: { paddingBottom: 6 },
  clusterHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  clusterTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  clusterDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    marginRight: 9,
  },
  clusterLabel: {
    flex: 1,
    fontFamily: NOTE_SERIF,
    fontSize: 22,
    lineHeight: 28,
    color: C.ink,
  },
  clusterCount: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    color: C.ink40,
    marginTop: 5,
  },
  clusterDescription: {
    fontFamily: NOTE_SANS,
    fontSize: 14.5,
    lineHeight: 22,
    color: C.ink70,
    marginTop: 10,
  },
  timeline: { marginTop: 20 },
  timelineTitle: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 10,
    letterSpacing: 0.8,
    color: C.ink40,
    marginBottom: 8,
  },
  timelinePlot: {
    height: 30,
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  timelineBucket: {
    flex: 1,
    height: 28,
    justifyContent: "flex-end",
    alignItems: "center",
  },
  timelineBar: { width: "72%", minWidth: 1, borderRadius: 2 },
  timelineMonths: { flexDirection: "row", height: 21 },
  timelineMonth: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: C.border,
    paddingLeft: 3,
    paddingTop: 4,
  },
  timelineMonthLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    color: C.ink40,
  },
});
