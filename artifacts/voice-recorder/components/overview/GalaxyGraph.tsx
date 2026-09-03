import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import {
  Canvas,
  createPicture,
  Fill,
  PaintStyle,
  Picture,
  Shader,
  Skia,
  TileMode,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
} from "@/components/NoteUI";
import {
  type Graph,
  type GraphCluster,
  type GraphNode,
} from "@/lib/visualizations";

const W = 361;
const H = 560;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 4;
const FOCUS_Y = H * 0.235;
const LABEL_HEIGHT = 16;
const LABEL_GAP = 10;
const SHEET_CLOSE_DISTANCE = 32;
const SHEET_CLOSE_VELOCITY = 650;
const SPRING = { damping: 26, stiffness: 90, mass: 1 };
const PALETTE = [
  "#687CC4",
  "#A389BE",
  "#78A4D2",
  "#C8B066",
  "#CD8E94",
  "#88B096",
  "#D6966E",
  "#96BABE",
  "#ACA88C",
  "#B8A0C4",
] as const;
const GREY = "#969EA6";

const GRAIN_SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 resolution;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

half4 main(float2 xy) {
  float2 p = xy * 0.82;
  float n = noise(p) * 0.57;
  n += noise(p * 2.0 + 17.3) * 0.28;
  n += noise(p * 4.0 + 41.7) * 0.15;
  float grey = 0.72 + n * 0.28;
  float alpha = 0.30;
  return half4(grey * alpha, grey * alpha, grey * alpha, alpha);
}
`);

type ThemeLayout = {
  id: string;
  label: string;
  fullTitle: string;
  description: string;
  color: string;
  status: string;
  proto: boolean;
  threshold: number;
  count: number;
  totalCount: number;
  lastActivity: number;
  cx: number;
  cy: number;
  radius: number;
  tilt: number;
  eccentricity: number;
  labelX: number;
  labelY: number;
};

type ThoughtLayout = {
  id: string;
  nodeIndex: number;
  themeIndex: number;
  rho: number;
  theta: number;
  size: number;
  recency: number;
};

type DustLayout = {
  x: number;
  y: number;
  size: number;
  alpha: number;
};

type GalaxyLayout = {
  themes: ThemeLayout[];
  thoughts: ThoughtLayout[];
  dust: DustLayout[];
  similarities: number[];
  signature: string;
};

type CameraValues = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  zoom: SharedValue<number>;
  drill: SharedValue<number>;
  selectedThemeIndex: SharedValue<number>;
};

const layoutCache = new Map<string, GalaxyLayout>();
const retainedPositions = new Map<string, { x: number; y: number }>();

function clamp(value: number, low: number, high: number): number {
  "worklet";
  return Math.min(high, Math.max(low, value));
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function seedFrom(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seedValue: string): () => number {
  let seed = seedFrom(seedValue);
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function paletteColor(index: number): string {
  const base = PALETTE[index % PALETTE.length];
  const cycle = Math.floor(index / PALETTE.length);
  if (cycle === 0) return base;
  const direction = cycle % 2 === 1 ? 1 : -1;
  const shift = direction * Math.min(18, 6 * Math.ceil(cycle / 2));
  const channels = [1, 3, 5].map((offset) =>
    clamp(parseInt(base.slice(offset, offset + 2), 16) + shift, 0, 255),
  );
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function fallbackShortLabel(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) return "Thema";
  const first = normalized.split(" ")[0];
  if (first.toLocaleLowerCase("de-DE").includes("thought")) return "thoughts";
  const head = normalized.split(/[,;:–—]|\sund\s/i)[0];
  return head.split(" ").slice(0, 2).join(" ") || first;
}

function nodeTimestamp(node: GraphNode): number {
  const timestamp = Date.parse(node.capturedAt || node.date);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildSimilarityMap(graph: Graph): Map<string, number> {
  const result = new Map<string, number>();
  for (const relationship of graph.topicSimilarities) {
    result.set(
      pairKey(relationship.sourceTopicId, relationship.targetTopicId),
      clamp(relationship.similarity, 0, 1),
    );
  }
  if (result.size > 0) return result;

  for (const edge of graph.edges) {
    const source = graph.nodes[edge.source];
    const target = graph.nodes[edge.target];
    if (!source || !target || source.cluster === target.cluster) continue;
    const key = pairKey(source.cluster, target.cluster);
    result.set(key, Math.max(result.get(key) ?? 0.05, edge.weight));
  }
  return result;
}

function overlaps(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function rectangleHitsCircle(
  rect: { x: number; y: number; width: number; height: number },
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const nearestX = clamp(cx, rect.x, rect.x + rect.width);
  const nearestY = clamp(cy, rect.y, rect.y + rect.height);
  return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}

function placeLabels(themes: ThemeLayout[]): void {
  const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (const theme of themes) {
    const width = Math.max(28, theme.label.length * 7.15);
    const distance = theme.radius + LABEL_GAP;
    const candidates = [
      [0, distance],
      [0, -distance],
      [distance + width / 2, 0],
      [-(distance + width / 2), 0],
      [distance * 0.75, distance * 0.75],
      [-distance * 0.75, distance * 0.75],
      [distance * 0.75, -distance * 0.75],
      [-distance * 0.75, -distance * 0.75],
    ];
    let best = { x: theme.cx, y: theme.cy + distance };
    let bestScore = Infinity;
    for (const [offsetX, offsetY] of candidates) {
      const centerX = theme.cx + offsetX;
      const centerY = theme.cy + offsetY;
      const rect = {
        x: centerX - width / 2,
        y: centerY - LABEL_HEIGHT / 2,
        width,
        height: LABEL_HEIGHT,
      };
      let score = 0;
      if (
        rect.x < 4 ||
        rect.x + rect.width > W - 4 ||
        rect.y < 2 ||
        rect.y + rect.height > H - 4
      ) {
        score += 100;
      }
      for (const existing of placed) {
        if (overlaps(rect, existing)) score += 50;
      }
      for (const other of themes) {
        if (other.id === theme.id) continue;
        if (
          rectangleHitsCircle(
            rect,
            other.cx,
            other.cy,
            other.radius * 1.15,
          )
        ) {
          score += 30;
        }
      }
      if (score < bestScore) {
        bestScore = score;
        best = { x: centerX, y: centerY };
      }
      if (score === 0) break;
    }
    theme.labelX = best.x;
    theme.labelY = best.y;
    placed.push({
      x: best.x - width / 2,
      y: best.y - LABEL_HEIGHT / 2,
      width,
      height: LABEL_HEIGHT,
    });
  }
}

function buildGalaxyLayout(
  graph: Graph,
  filterNodeIndices: readonly number[] | null,
): GalaxyLayout {
  const matching =
    filterNodeIndices == null ? null : new Set<number>(filterNodeIndices);
  const signature = JSON.stringify({
    topics: graph.clusters.map(({ id }) => id),
    nodes: graph.nodes.map(({ id }) => id),
    filter: filterNodeIndices,
    similarities: graph.topicSimilarities,
  });
  const cached = layoutCache.get(signature);
  if (cached) return cached;

  const similarityByPair = buildSimilarityMap(graph);
  const visibleByTheme = new Map<string, GraphNode[]>();
  const allByTheme = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const all = allByTheme.get(node.cluster) ?? [];
    all.push(node);
    allByTheme.set(node.cluster, all);
    if (matching !== null && !matching.has(node.idx)) continue;
    const visible = visibleByTheme.get(node.cluster) ?? [];
    visible.push(node);
    visibleByTheme.set(node.cluster, visible);
  }
  for (const values of visibleByTheme.values()) {
    values.sort((left, right) => nodeTimestamp(right) - nodeTimestamp(left));
  }

  const themeCount = graph.clusters.length;
  const radiusFactor = clamp(Math.sqrt(6 / Math.max(1, themeCount)), 0.68, 1);
  const hasRetainedPosition = graph.clusters.some((cluster) =>
    retainedPositions.has(cluster.id),
  );
  const themes: ThemeLayout[] = graph.clusters.map((cluster, index) => {
    const visible = visibleByTheme.get(cluster.id) ?? [];
    const all = allByTheme.get(cluster.id) ?? [];
    const random = randomFrom(cluster.id);
    const retained = retainedPositions.get(cluster.id);
    const spiralAngle = index * 2.4 + 0.7;
    const spiralRadius = 34 * Math.sqrt(index + 1);
    const edgeRandom = randomFrom(`edge:${cluster.id}`);
    const edgeAngle = edgeRandom() * Math.PI * 2;
    const initialX =
      hasRetainedPosition && !retained
        ? W / 2 + Math.cos(edgeAngle) * Math.min(W, H) * 0.46
        : W / 2 + Math.cos(spiralAngle) * spiralRadius;
    const initialY =
      hasRetainedPosition && !retained
        ? H / 2 + Math.sin(edgeAngle) * Math.min(W, H) * 0.46
        : H / 2 + Math.sin(spiralAngle) * spiralRadius;
    const newest = Math.max(0, ...all.map(nodeTimestamp));
    return {
      id: cluster.id,
      label: fallbackShortLabel(cluster.label),
      fullTitle: cluster.fullTitle || cluster.label,
      description: cluster.description,
      color: paletteColor(index),
      status: cluster.status,
      proto:
        cluster.status === "provisional" &&
        all.length < graph.meta.themeThreshold,
      threshold: graph.meta.themeThreshold,
      count: visible.length,
      totalCount: all.length,
      lastActivity:
        Date.parse(cluster.lastActivity ?? "") || newest || Date.now(),
      cx: retained?.x ?? initialX,
      cy: retained?.y ?? initialY,
      radius: (11 + Math.sqrt(visible.length) * 6.2) * radiusFactor,
      tilt: random() * Math.PI,
      eccentricity: 0.6 + random() * 0.22,
      labelX: 0,
      labelY: 0,
    };
  });
  for (const theme of themes) {
    if (theme.proto) theme.radius = 26 * radiusFactor;
  }

  for (let iteration = 0; iteration < 700; iteration += 1) {
    for (let leftIndex = 0; leftIndex < themes.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < themes.length;
        rightIndex += 1
      ) {
        const left = themes[leftIndex];
        const right = themes[rightIndex];
        let dx = right.cx - left.cx;
        let dy = right.cy - left.cy;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          const angle = (leftIndex * 37 + rightIndex * 61) * 0.1;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const minimum = (left.radius + right.radius) * 1.05 + 42;
        const relationship =
          similarityByPair.get(pairKey(left.id, right.id)) ?? 0.05;
        const wanted = minimum * (1 + (1 - relationship) * 1.9);
        const strength = 0.02 * (0.4 + relationship);
        const spring = ((wanted - distance) * strength) / 2;
        const nx = dx / distance;
        const ny = dy / distance;
        left.cx -= nx * spring;
        left.cy -= ny * spring;
        right.cx += nx * spring;
        right.cy += ny * spring;
        if (distance < minimum) {
          const push = (minimum - distance) / 2;
          left.cx -= nx * push;
          left.cy -= ny * push;
          right.cx += nx * push;
          right.cy += ny * push;
        }
      }
    }
    for (const theme of themes) {
      theme.cx += (W / 2 - theme.cx) * 0.004;
      theme.cy += (H / 2 - theme.cy) * 0.004;
    }
  }

  if (themes.length > 0) {
    const minX = Math.min(...themes.map((theme) => theme.cx - theme.radius));
    const maxX = Math.max(...themes.map((theme) => theme.cx + theme.radius));
    const minY = Math.min(...themes.map((theme) => theme.cy - theme.radius));
    const maxY = Math.max(
      ...themes.map((theme) => theme.cy + theme.radius + 22),
    );
    const fit = Math.min(
      1,
      (W - 28) / Math.max(1, maxX - minX),
      (H - 70) / Math.max(1, maxY - minY),
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    for (const theme of themes) {
      theme.cx = W / 2 + (theme.cx - centerX) * fit;
      theme.cy = H * 0.49 + (theme.cy - centerY) * fit;
      theme.radius *= fit;
      retainedPositions.set(theme.id, { x: theme.cx, y: theme.cy });
    }
  }

  placeLabels(themes);

  const themeIndexById = new Map(
    themes.map((theme, index) => [theme.id, index]),
  );
  const thoughts: ThoughtLayout[] = [];
  for (const theme of themes) {
    const themeIndex = themeIndexById.get(theme.id) ?? -1;
    const visible = visibleByTheme.get(theme.id) ?? [];
    for (let index = 0; index < visible.length; index += 1) {
      const node = visible[index];
      const random = randomFrom(`${theme.id}:${node.id}`);
      const rho =
        (0.18 + 0.82 * Math.sqrt((index + 0.5) / visible.length)) *
        (0.85 + random() * 0.3);
      const ageBucket = Math.min(
        9,
        Math.floor((index * 10) / Math.max(1, visible.length)),
      );
      thoughts.push({
        id: node.id,
        nodeIndex: node.idx,
        themeIndex,
        rho,
        theta: random() * Math.PI * 2,
        size: 0.9 + random() * 1.3,
        recency: 1 - ageBucket / 9,
      });
    }
  }

  const dust: DustLayout[] = [];
  const unassignedCount = Math.max(
    graph.meta.pendingThoughts,
    graph.meta.sourceCount - graph.meta.assignedCount,
  );
  const dustRandom = randomFrom(
    `dust:${graph.meta.sourceCount}:${graph.meta.assignedCount}`,
  );
  for (let attempt = 0; dust.length < unassignedCount && attempt < 1000; attempt += 1) {
    const x = 18 + dustRandom() * (W - 36);
    const y = 28 + dustRandom() * (H - 68);
    const clearsThemes = themes.every(
      (theme) =>
        Math.hypot(theme.cx - x, theme.cy - y) >
        theme.radius * 1.25 + 16,
    );
    const clearsDust = dust.every(
      (point) => Math.hypot(point.x - x, point.y - y) >= 28,
    );
    if (!clearsThemes || !clearsDust) continue;
    dust.push({
      x,
      y,
      size: 0.9 + dustRandom() * 0.7,
      alpha: 0.28 + dustRandom() * 0.2,
    });
  }

  const similarities = new Array(themes.length * themes.length).fill(0.05);
  for (let left = 0; left < themes.length; left += 1) {
    similarities[left * themes.length + left] = 1;
    for (let right = left + 1; right < themes.length; right += 1) {
      const value =
        similarityByPair.get(pairKey(themes[left].id, themes[right].id)) ??
        0.05;
      similarities[left * themes.length + right] = value;
      similarities[right * themes.length + left] = value;
    }
  }

  const result = { themes, thoughts, dust, similarities, signature };
  layoutCache.set(signature, result);
  if (layoutCache.size > 8) {
    const oldest = layoutCache.keys().next().value;
    if (oldest) layoutCache.delete(oldest);
  }
  return result;
}

function worldPoint(
  thought: ThoughtLayout,
  theme: ThemeLayout,
  drill: number,
): { x: number; y: number } {
  "worklet";
  const radius = thought.rho * theme.radius * (1 + 1.45 * drill);
  const eccentricity =
    theme.eccentricity + (0.9 - theme.eccentricity) * drill;
  const ex = Math.cos(thought.theta) * radius;
  const ey = Math.sin(thought.theta) * radius * eccentricity;
  return {
    x:
      theme.cx +
      ex * Math.cos(theme.tilt) -
      ey * Math.sin(theme.tilt),
    y:
      theme.cy +
      ex * Math.sin(theme.tilt) +
      ey * Math.cos(theme.tilt),
  };
}

function projectPoint(
  x: number,
  y: number,
  cameraX: number,
  cameraY: number,
  zoom: number,
  focusProgress: number,
): { x: number; y: number } {
  "worklet";
  return {
    x: W / 2 + (x - cameraX) * zoom,
    y: H / 2 + (FOCUS_Y - H / 2) * focusProgress + (y - cameraY) * zoom,
  };
}

function GalaxyLabel({
  camera,
  onPress,
  scaleX,
  scaleY,
  theme,
}: {
  camera: CameraValues;
  onPress: () => void;
  scaleX: number;
  scaleY: number;
  theme: ThemeLayout;
}) {
  const labelAlpha =
    (Date.now() - theme.lastActivity > 60 * 86400000 ? 0.55 : 1) *
    (theme.count === 0 ? 0.3 : 1);
  const style = useAnimatedStyle(() => {
    const point = projectPoint(
      theme.labelX,
      theme.labelY,
      camera.x.value,
      camera.y.value,
      camera.zoom.value,
      camera.drill.value,
    );
    return {
      opacity: (1 - camera.drill.value) * labelAlpha,
      transform: [
        { translateX: point.x * scaleX },
        { translateY: point.y * scaleY },
      ],
    };
  }, [labelAlpha, scaleX, scaleY, theme]);

  return (
    <Animated.View pointerEvents="box-none" style={[styles.labelAnchor, style]}>
      <Pressable
        accessibilityLabel={`Thema ${theme.label} öffnen`}
        accessibilityRole="button"
        hitSlop={10}
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={[styles.galaxyLabel, { color: theme.color }]}>
          {theme.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function weeklyHistogram(nodes: GraphNode[]): number[] {
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const result = new Array(11).fill(0);
  for (const node of nodes) {
    const age = Math.max(0, now - nodeTimestamp(node));
    const bucket = 10 - Math.min(10, Math.floor(age / week));
    result[bucket] += 1;
  }
  return result;
}

function ThemeSheet({
  nodes,
  onClose,
  sheetY,
  theme,
}: {
  nodes: GraphNode[];
  onClose: () => void;
  sheetY: SharedValue<number>;
  theme: ThemeLayout;
}) {
  const bars = useMemo(() => weeklyHistogram(nodes), [nodes]);
  const maximum = Math.max(1, ...bars);
  const pan = Gesture.Pan()
    .onChange((event) => {
      sheetY.value = clamp(sheetY.value + event.changeY * 0.5, 0, 120);
    })
    .onEnd((event) => {
      const close =
        sheetY.value > SHEET_CLOSE_DISTANCE ||
        event.velocityY > SHEET_CLOSE_VELOCITY;
      sheetY.value = withTiming(close ? 240 : 0, {
        duration: close ? 210 : 160,
        easing: Easing.out(Easing.cubic),
      });
      if (close) runOnJS(onClose)();
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sheet, style]}>
        <View style={styles.handle} />
        <View style={styles.sheetTitleRow}>
          <View style={[styles.sheetDot, { backgroundColor: theme.color }]} />
          <Text style={styles.sheetTitle}>{theme.fullTitle}</Text>
        </View>
        <Text style={styles.sheetCount}>
          {theme.count === 1 ? "1 Gedanke" : `${theme.count} Gedanken`}
        </Text>
        <Text style={styles.sheetDescription}>{theme.description}</Text>
        <Text style={styles.timelineTitle}>VERLAUF</Text>
        <View style={styles.timelinePlot}>
          {bars.map((value, index) => (
            <View key={index} style={styles.timelineBucket}>
              {value > 0 ? (
                <View
                  style={[
                    styles.timelineBar,
                    {
                      backgroundColor: theme.color,
                      height: 4 + (value / maximum) * 36,
                      opacity: 0.55 + (index / 10) * 0.4,
                    },
                  ]}
                />
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.timelineAxis}>
          <Text style={styles.timelineAxisLabel}>vor 10 Wo.</Text>
          <Text style={styles.timelineAxisLabel}>heute</Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

function ProtoSheet({
  nodes,
  onClose,
  sheetY,
  theme,
}: {
  nodes: GraphNode[];
  onClose: () => void;
  sheetY: SharedValue<number>;
  theme: ThemeLayout;
}) {
  const pan = Gesture.Pan()
    .onChange((event) => {
      sheetY.value = clamp(sheetY.value + event.changeY * 0.5, 0, 120);
    })
    .onEnd((event) => {
      const close =
        sheetY.value > SHEET_CLOSE_DISTANCE ||
        event.velocityY > SHEET_CLOSE_VELOCITY;
      sheetY.value = withTiming(close ? 240 : 0, {
        duration: close ? 210 : 160,
        easing: Easing.out(Easing.cubic),
      });
      if (close) runOnJS(onClose)();
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sheet, style]}>
        <View style={styles.handle} />
        <View style={styles.sheetTitleRow}>
          <View style={[styles.sheetDot, { backgroundColor: GREY }]} />
          <Text style={[styles.sheetTitle, styles.protoTitle]}>
            Noch kein Thema
          </Text>
        </View>
        <Text style={styles.sheetCount}>
          {nodes.length} Gedanken · ab {theme.threshold} entsteht eine Galaxie
        </Text>
        <View style={styles.protoList}>
          {nodes.map((node) => (
            <Text key={node.id} numberOfLines={2} style={styles.protoItem}>
              {node.title}
            </Text>
          ))}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

export function GalaxyGraph({
  filterNodeIndices = null,
  graph,
  onRetry,
  status,
}: {
  filterNodeIndices?: readonly number[] | null;
  graph: Graph | null;
  onRetry: () => void;
  status: "loading" | "error" | "ready";
}) {
  const router = useRouter();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [selectedProtoId, setSelectedProtoId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailOpenRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const detailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(
    () =>
      graph
        ? buildGalaxyLayout(graph, filterNodeIndices)
        : ({
            themes: [],
            thoughts: [],
            dust: [],
            similarities: [],
            signature: "empty",
          } satisfies GalaxyLayout),
    [filterNodeIndices, graph],
  );
  const selectedThemeIndex = layout.themes.findIndex(
    (theme) => theme.id === selectedThemeId,
  );
  const selectedTheme =
    selectedThemeIndex >= 0 ? layout.themes[selectedThemeIndex] : null;
  const selectedProto =
    layout.themes.find((theme) => theme.id === selectedProtoId) ?? null;
  const matchingNodeIndices = useMemo(
    () =>
      filterNodeIndices == null ? null : new Set<number>(filterNodeIndices),
    [filterNodeIndices],
  );
  const selectedNodes = selectedTheme
    ? (graph?.nodes.filter(
        (node) =>
          node.cluster === selectedTheme.id &&
          (matchingNodeIndices == null || matchingNodeIndices.has(node.idx)),
      ) ?? [])
    : [];
  const protoNodes = selectedProto
    ? (graph?.nodes.filter(
        (node) =>
          node.cluster === selectedProto.id &&
          (matchingNodeIndices == null || matchingNodeIndices.has(node.idx)),
      ) ?? [])
    : [];

  const cameraX = useSharedValue(W / 2);
  const cameraY = useSharedValue(H / 2);
  const zoom = useSharedValue(1);
  const drill = useSharedValue(0);
  const selectedThemeIndexSV = useSharedValue(-1);
  const selectedThoughtIndexSV = useSharedValue(-1);
  const panStartX = useSharedValue(W / 2);
  const panStartY = useSharedValue(H / 2);
  const pinchStartX = useSharedValue(W / 2);
  const pinchStartY = useSharedValue(H / 2);
  const pinchStartZoom = useSharedValue(1);
  const pinchWorldX = useSharedValue(W / 2);
  const pinchWorldY = useSharedValue(H / 2);
  const sheetY = useSharedValue(0);
  const camera: CameraValues = {
    x: cameraX,
    y: cameraY,
    zoom,
    drill,
    selectedThemeIndex: selectedThemeIndexSV,
  };

  const scaleX = size.width > 0 ? size.width / W : 1;
  const scaleY = size.height > 0 ? size.height / H : 1;

  useEffect(() => {
    if (selectedThemeId && selectedThemeIndex < 0) {
      setSelectedThemeId(null);
      selectedThemeIndexSV.value = -1;
      drill.value = 0;
    }
  }, [drill, selectedThemeId, selectedThemeIndex, selectedThemeIndexSV]);

  useFocusEffect(
    useCallback(() => {
      if (detailOpenRef.current) {
        detailOpenRef.current = false;
        setDetailOpen(false);
        selectedThoughtIndexSV.value = -1;
        sheetY.value = 240;
        sheetY.value = withSpring(0, SPRING);
      }
      return undefined;
    }, [selectedThoughtIndexSV, sheetY]),
  );

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
    },
    [],
  );

  const clampCameraX = (value: number) => clamp(value, W * 0.15, W * 0.85);
  const clampCameraY = (value: number) => clamp(value, H * 0.15, H * 0.85);

  const resetCamera = useCallback(() => {
    cameraX.value = withSpring(W / 2, SPRING);
    cameraY.value = withSpring(H / 2, SPRING);
    zoom.value = withSpring(1, SPRING);
  }, [cameraX, cameraY, zoom]);

  const closeTheme = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    selectedThoughtIndexSV.value = -1;
    sheetY.value = withTiming(180, { duration: 180 });
    drill.value = withSpring(0, SPRING);
    selectedThemeIndexSV.value = -1;
    resetCamera();
    closeTimerRef.current = setTimeout(() => {
      setSelectedThemeId(null);
      closeTimerRef.current = null;
    }, 180);
  }, [drill, resetCamera, selectedThemeIndexSV, selectedThoughtIndexSV, sheetY]);

  const closeProto = useCallback(() => {
    sheetY.value = withTiming(180, { duration: 180 });
    setTimeout(() => setSelectedProtoId(null), 180);
  }, [sheetY]);

  const focusTheme = useCallback(
    (themeIndex: number) => {
      const theme = layout.themes[themeIndex];
      if (!theme) return;
      if (theme.proto) {
        setSelectedProtoId(theme.id);
        sheetY.value = 0;
        return;
      }
      setSelectedProtoId(null);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      const fit = Math.min(W - 44, 236) / (2 * theme.radius * 2.45);
      const targetZoom = clamp(fit, 1, 1.8);
      setSelectedThemeId(theme.id);
      selectedThemeIndexSV.value = themeIndex;
      selectedThoughtIndexSV.value = -1;
      sheetY.value = 0;
      drill.value = withSpring(1, SPRING);
      cameraX.value = withSpring(clampCameraX(theme.cx), SPRING);
      cameraY.value = withSpring(clampCameraY(theme.cy), SPRING);
      zoom.value = withSpring(targetZoom, SPRING);
    },
    [cameraX, cameraY, drill, layout.themes, selectedThemeIndexSV, selectedThoughtIndexSV, sheetY, zoom],
  );

  const openThought = useCallback(
    (nodeIndex: number) => {
      const node = graph?.nodes[nodeIndex];
      if (!node) return;
      const thoughtIndex = layout.thoughts.findIndex(
        (thought) => thought.nodeIndex === nodeIndex,
      );
      const theme = layout.themes[layout.thoughts[thoughtIndex]?.themeIndex];
      selectedThoughtIndexSV.value = thoughtIndex;
      detailOpenRef.current = true;
      sheetY.value = withTiming(240, {
        duration: 220,
        easing: Easing.out(Easing.cubic),
      });
      if (detailTimerRef.current) clearTimeout(detailTimerRef.current);
      detailTimerRef.current = setTimeout(() => {
        setDetailOpen(true);
        router.push(
          `/thoughts/detail?path=${encodeURIComponent(node.id)}&theme=${encodeURIComponent(theme?.fullTitle ?? "")}` as Href,
        );
        detailTimerRef.current = null;
      }, 190);
    },
    [graph?.nodes, layout.themes, layout.thoughts, router, selectedThoughtIndexSV, sheetY],
  );

  const handleTap = useCallback(
    (
      logicalX: number,
      logicalY: number,
      currentX: number,
      currentY: number,
      currentZoom: number,
      currentDrill: number,
      currentThemeIndex: number,
    ) => {
      if (currentThemeIndex >= 0) {
        const theme = layout.themes[currentThemeIndex];
        if (!theme) return;
        let best: ThoughtLayout | null = null;
        let bestDistance = 13;
        for (const thought of layout.thoughts) {
          if (thought.themeIndex !== currentThemeIndex) continue;
          const world = worldPoint(thought, theme, currentDrill);
          const screen = projectPoint(
            world.x,
            world.y,
            currentX,
            currentY,
            currentZoom,
            currentDrill,
          );
          const distance = Math.hypot(screen.x - logicalX, screen.y - logicalY);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = thought;
          }
        }
        if (best) openThought(best.nodeIndex);
        else closeTheme();
        return;
      }

      if (selectedProtoId) {
        closeProto();
        return;
      }

      let bestTheme = -1;
      let bestDistance = Infinity;
      for (let index = 0; index < layout.themes.length; index += 1) {
        const theme = layout.themes[index];
        const screen = projectPoint(
          theme.cx,
          theme.cy,
          currentX,
          currentY,
          currentZoom,
          currentDrill,
        );
        const distance = Math.hypot(screen.x - logicalX, screen.y - logicalY);
        if (
          distance < theme.radius * currentZoom * 1.6 &&
          distance < bestDistance
        ) {
          bestDistance = distance;
          bestTheme = index;
        }
      }
      if (bestTheme >= 0) focusTheme(bestTheme);
    },
    [closeProto, closeTheme, focusTheme, layout.themes, layout.thoughts, openThought, selectedProtoId],
  );

  const handleDoubleTap = useCallback(() => {
    if (selectedThemeIndexSV.value >= 0) closeTheme();
    else resetCamera();
  }, [closeTheme, resetCamera, selectedThemeIndexSV]);

  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(2)
    .onBegin(() => {
      panStartX.value = cameraX.value;
      panStartY.value = cameraY.value;
    })
    .onUpdate((event) => {
      cameraX.value = clamp(
        panStartX.value - event.translationX / scaleX / zoom.value,
        W * 0.15,
        W * 0.85,
      );
      cameraY.value = clamp(
        panStartY.value - event.translationY / scaleY / zoom.value,
        H * 0.15,
        H * 0.85,
      );
    })
    .onEnd((event) => {
      const targetX = clamp(
        cameraX.value - event.velocityX / scaleX / zoom.value * 0.006,
        W * 0.15,
        W * 0.85,
      );
      const targetY = clamp(
        cameraY.value - event.velocityY / scaleY / zoom.value * 0.006,
        H * 0.15,
        H * 0.85,
      );
      cameraX.value = withSpring(targetX, SPRING);
      cameraY.value = withSpring(targetY, SPRING);
    });

  const pinch = Gesture.Pinch()
    .onBegin((event) => {
      pinchStartX.value = cameraX.value;
      pinchStartY.value = cameraY.value;
      pinchStartZoom.value = zoom.value;
      const logicalX = event.focalX / scaleX;
      const logicalY = event.focalY / scaleY;
      const focusY =
        H / 2 + (FOCUS_Y - H / 2) * drill.value;
      pinchWorldX.value =
        pinchStartX.value + (logicalX - W / 2) / pinchStartZoom.value;
      pinchWorldY.value =
        pinchStartY.value + (logicalY - focusY) / pinchStartZoom.value;
    })
    .onUpdate((event) => {
      const nextZoom = clamp(
        pinchStartZoom.value * Math.pow(event.scale, 0.8),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const logicalX = event.focalX / scaleX;
      const logicalY = event.focalY / scaleY;
      const focusY =
        H / 2 + (FOCUS_Y - H / 2) * drill.value;
      cameraX.value = clamp(
        pinchWorldX.value - (logicalX - W / 2) / nextZoom,
        W * 0.15,
        W * 0.85,
      );
      cameraY.value = clamp(
        pinchWorldY.value - (logicalY - focusY) / nextZoom,
        H * 0.15,
        H * 0.85,
      );
      zoom.value = nextZoom;
    });

  const singleTap = Gesture.Tap()
    .maxDistance(2)
    .onEnd((event, success) => {
      if (!success) return;
      runOnJS(handleTap)(
        event.x / scaleX,
        event.y / scaleY,
        cameraX.value,
        cameraY.value,
        zoom.value,
        drill.value,
        selectedThemeIndexSV.value,
      );
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDistance(2)
    .maxDelay(280)
    .onEnd((_event, success) => {
      if (success) runOnJS(handleDoubleTap)();
    });
  const taps = Gesture.Exclusive(doubleTap, singleTap);
  const gesture = Gesture.Simultaneous(pan, pinch, taps);

  const picture = useDerivedValue(() =>
    createPicture((canvas) => {
      "worklet";
      if (size.width <= 0 || size.height <= 0) return;
      const sx = size.width / W;
      const sy = size.height / H;
      const currentZoom = zoom.value;
      const currentDrill = drill.value;
      const selectedIndex = selectedThemeIndexSV.value;
      const selectedThoughtIndex = selectedThoughtIndexSV.value;
      const colors: Record<string, ReturnType<typeof Skia.Color>> = {};
      const color = (hex: string) => {
        if (!colors[hex]) colors[hex] = Skia.Color(hex);
        return colors[hex];
      };
      const transparent = color("#00000000");
      const hazePaint = Skia.Paint();
      hazePaint.setAntiAlias(true);
      const pointPaint = Skia.Paint();
      pointPaint.setAntiAlias(true);
      const ringPaint = Skia.Paint();
      ringPaint.setAntiAlias(true);
      ringPaint.setStyle(PaintStyle.Stroke);
      ringPaint.setStrokeWidth(1);
      const now = Date.now();

      canvas.save();
      canvas.scale(sx, sy);

      const dustAlpha = selectedIndex >= 0 ? 0.25 : 1;
      pointPaint.setColor(color(GREY));
      for (const point of layout.dust) {
        const screen = projectPoint(
          point.x,
          point.y,
          cameraX.value,
          cameraY.value,
          currentZoom,
          currentDrill,
        );
        pointPaint.setAlphaf(point.alpha * dustAlpha);
        canvas.drawCircle(
          screen.x,
          screen.y,
          point.size * Math.sqrt(currentZoom) * 0.75,
          pointPaint,
        );
      }

      for (let index = 0; index < layout.themes.length; index += 1) {
        const theme = layout.themes[index];
        const focused = selectedIndex === index;
        const f = focused ? currentDrill : 0;
        const relationship =
          selectedIndex >= 0
            ? layout.similarities[selectedIndex * layout.themes.length + index] ??
              0.05
            : 1;
        const dim = selectedIndex >= 0 && !focused ? 1 - 0.55 * relationship : 0;
        const activityFactor = now - theme.lastActivity > 60 * 86400000 ? 0.55 : 1;
        const periodFactor = theme.count === 0 ? 0.3 : 1;
        const alphaFactor = activityFactor * periodFactor;
        const screen = projectPoint(
          theme.cx,
          theme.cy,
          cameraX.value,
          cameraY.value,
          currentZoom,
          currentDrill,
        );
        const hazeRadius =
          (theme.proto ? 26 : theme.radius * (1.95 + 1.7 * f)) * currentZoom;
        const hazeAlpha = (1 - 0.85 * dim) * alphaFactor;
        if (theme.proto) {
          const shader = Skia.Shader.MakeRadialGradient(
            { x: screen.x, y: screen.y },
            hazeRadius,
            [color(GREY), transparent],
            [0, 1],
            TileMode.Clamp,
          );
          hazePaint.setShader(shader);
          hazePaint.setAlphaf(0.1 * (selectedIndex >= 0 ? 0.25 : 1));
          canvas.drawCircle(screen.x, screen.y, hazeRadius, hazePaint);
          continue;
        }
        for (const [radius, alpha] of [
          [hazeRadius, 0.14],
          [hazeRadius * 0.5, 0.13],
        ]) {
          const shader = Skia.Shader.MakeRadialGradient(
            { x: screen.x, y: screen.y },
            radius,
            [color(theme.color), transparent],
            [0, 1],
            TileMode.Clamp,
          );
          hazePaint.setShader(shader);
          hazePaint.setAlphaf(alpha * hazeAlpha);
          canvas.drawCircle(screen.x, screen.y, radius, hazePaint);
        }
      }

      for (let index = 0; index < layout.thoughts.length; index += 1) {
        const thought = layout.thoughts[index];
        const theme = layout.themes[thought.themeIndex];
        if (!theme) continue;
        const focused = selectedIndex === thought.themeIndex;
        const f = focused ? currentDrill : 0;
        const relationship =
          selectedIndex >= 0
            ? layout.similarities[
                selectedIndex * layout.themes.length + thought.themeIndex
              ] ?? 0.05
            : 1;
        const dim = selectedIndex >= 0 && !focused ? 1 - 0.55 * relationship : 0;
        const activityFactor = now - theme.lastActivity > 60 * 86400000 ? 0.55 : 1;
        const world = worldPoint(thought, theme, f);
        const screen = projectPoint(
          world.x,
          world.y,
          cameraX.value,
          cameraY.value,
          currentZoom,
          currentDrill,
        );
        const radius =
          thought.size * (1 + 0.9 * f) * Math.sqrt(currentZoom) * 0.75;
        const selectedFactor =
          selectedThoughtIndex >= 0 && selectedThoughtIndex !== index && focused
            ? 0.4
            : 1;
        const alpha =
          (theme.proto ? 0.55 : 0.28 + 0.62 * thought.recency) *
          (1 - 0.9 * dim) *
          activityFactor *
          selectedFactor;

        if (!theme.proto && thought.recency > 0.85) {
          const glowRadius = radius * 4.5;
          const shader = Skia.Shader.MakeRadialGradient(
            { x: screen.x, y: screen.y },
            glowRadius,
            [color(theme.color), transparent],
            [0, 1],
            TileMode.Clamp,
          );
          hazePaint.setShader(shader);
          hazePaint.setAlphaf(
            0.32 * (1 - 0.9 * dim) * activityFactor * selectedFactor,
          );
          canvas.drawCircle(screen.x, screen.y, glowRadius, hazePaint);
        }

        pointPaint.setShader(null);
        pointPaint.setColor(color(theme.proto ? GREY : theme.color));
        pointPaint.setAlphaf(alpha);
        canvas.drawCircle(screen.x, screen.y, radius, pointPaint);
        if (selectedThoughtIndex === index) {
          ringPaint.setColor(color(theme.color));
          ringPaint.setAlphaf(0.85);
          canvas.drawCircle(screen.x, screen.y, radius + 3.5, ringPaint);
        }
      }

      canvas.restore();
    }),
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  return (
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Picture picture={picture} />
          </Canvas>
        </View>
      </GestureDetector>

      {!selectedTheme
        ? layout.themes.map((theme, index) =>
            theme.proto ? null : (
            <GalaxyLabel
              key={theme.id}
              camera={camera}
              onPress={() => focusTheme(index)}
              scaleX={scaleX}
              scaleY={scaleY}
              theme={theme}
            />
            ),
          )
        : null}

      {selectedTheme ? (
        <Pressable
          accessibilityLabel="Zur Themenübersicht"
          hitSlop={12}
          onPress={closeTheme}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.backText}>‹ zurück</Text>
        </Pressable>
      ) : null}

      {status === "loading" ? (
        <View pointerEvents="none" style={styles.center}>
          <ActivityIndicator color={C.sky} />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.stateText}>Die Karte konnte nicht geladen werden.</Text>
          <Pressable hitSlop={8} onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : null}
      {status === "ready" && (graph?.meta.sourceCount ?? 0) === 0 ? (
        <View pointerEvents="none" style={styles.center}>
          <Text style={styles.emptyText}>
            Deine Themen entstehen, sobald sich Gedanken sammeln.
          </Text>
        </View>
      ) : null}

      {selectedTheme && !detailOpen ? (
        <ThemeSheet
          nodes={selectedNodes}
          onClose={closeTheme}
          sheetY={sheetY}
          theme={selectedTheme}
        />
      ) : null}
      {selectedProto ? (
        <ProtoSheet
          nodes={protoNodes}
          onClose={closeProto}
          sheetY={sheetY}
          theme={selectedProto}
        />
      ) : null}

      {GRAIN_SOURCE ? (
        <Canvas pointerEvents="none" style={styles.grain}>
          <Fill blendMode="multiply">
            <Shader
              source={GRAIN_SOURCE}
              uniforms={{ resolution: [size.width, size.height] }}
            />
          </Fill>
        </Canvas>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
  },
  labelAnchor: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 5,
  },
  galaxyLabel: {
    transform: [{ translateX: "-50%" }, { translateY: -7 }],
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    fontWeight: "400",
    letterSpacing: -0.07,
    lineHeight: 16,
  },
  backButton: {
    position: "absolute",
    top: 4,
    left: 8,
    zIndex: 10,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  backText: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    color: C.ink40,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    borderRadius: 24,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 20,
    shadowColor: C.ink,
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 9,
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 4,
    marginBottom: 18,
    borderRadius: 2,
    backgroundColor: "#C7D1DA",
  },
  sheetTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  sheetDot: {
    width: 10,
    height: 10,
    marginTop: 10,
    borderRadius: 5,
  },
  sheetTitle: {
    flex: 1,
    fontFamily: NOTE_SERIF,
    fontSize: 25,
    lineHeight: 30.5,
    letterSpacing: -0.25,
    color: C.ink,
  },
  sheetCount: {
    marginTop: 6,
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    color: C.ink40,
  },
  sheetDescription: {
    marginTop: 12,
    fontFamily: NOTE_SANS,
    fontSize: 15.5,
    lineHeight: 22.5,
    color: C.ink70,
  },
  timelineTitle: {
    marginTop: 18,
    marginBottom: 8,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    letterSpacing: 1.3,
    color: C.ink40,
  },
  timelinePlot: {
    height: 44,
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  timelineBucket: {
    flex: 1,
    height: 42,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  timelineBar: {
    width: "38%",
    minWidth: 2,
    borderRadius: 1,
  },
  timelineAxis: {
    marginTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  timelineAxisLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    color: C.ink40,
  },
  protoTitle: { color: "#6E7A85" },
  protoList: { marginTop: 16, gap: 8 },
  protoItem: {
    fontFamily: NOTE_SERIF,
    fontSize: 16,
    lineHeight: 21,
    color: C.ink70,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 38,
  },
  stateText: {
    fontFamily: NOTE_SERIF,
    fontSize: 16,
    color: C.ink60,
    textAlign: "center",
  },
  emptyText: {
    fontFamily: NOTE_SERIF,
    fontSize: 16,
    lineHeight: 23,
    color: C.ink40,
    textAlign: "center",
  },
  retry: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  retryText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 13,
    color: C.skyDeep,
  },
  grain: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
  },
  pressed: { opacity: 0.58 },
});
