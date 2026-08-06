import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
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
const MIN_SCALE = 0.6;
const MAX_SCALE = 4;
const CLUSTER_CHIP_HEIGHT = 24;
const CLUSTER_CHIP_PAD_X = 10;

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

type Pos = {
  idx: number;
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
  cluster: number;
  color: string;
  tcolor: string;
  keyword: string;
};

type EdgeDraw = { source: number; target: number; weight: number };

type ClusterDraw = {
  id: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
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
        const min = a.r + b.r + 20;
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

export function OverviewGraph({
  filterDate = null,
  graph,
  onRetry,
  showHint = true,
  status,
}: {
  filterDate?: string | null;
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
  const scale = useSharedValue(1);
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
  const clustersSV = useSharedValue<ClusterDraw[]>([]);
  const selectedIdxSV = useSharedValue<number>(-1);
  const selectedClusterIdSV = useSharedValue<number>(-1);
  const neighborFlagsSV = useSharedValue<number[]>([]);
  const dragIdx = useSharedValue<number>(-1);
  // 1 per node when a date filter is active and that node matches; empty
  // array means "no filter", which the worklet treats as everything visible.
  const matchFlagsSV = useSharedValue<number[]>([]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const clusters = graph?.clusters ?? [];

  useEffect(() => {
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
    const pos: Pos[] = nodes.map((n) => {
      const fill = clusterById.get(n.cluster)?.color ?? C.ink40;
      return {
        idx: n.idx,
        cx: PAD + n.x * w,
        cy: PAD + n.y * h,
        r: n.size,
        color: fill,
        tcolor: fill,
        keyword: n.keyword,
      };
    });
    if (pos.length && w > 0 && h > 0) declutter(pos);
    const centroids = clusters.map((c) => {
      const pts = pos.filter((_, i) => nodes[i].cluster === c.id);
      const cx = pts.reduce((s, p) => s + p.cx, 0) / (pts.length || 1);
      const cy = pts.reduce((s, p) => s + p.cy, 0) / (pts.length || 1);
      return {
        ...c,
        cx,
        cy,
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
      cluster: nodes[p.idx]?.cluster ?? -1,
      color: p.color,
      tcolor: p.tcolor,
      keyword: p.keyword,
    }));
    edgesSV.value = edges.map((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
    }));
    clustersSV.value = layout.centroids.map((c) => ({
      id: c.id,
      cx: c.cx,
      cy: c.cy,
      width:
        (clusterFont?.measureText(c.label).width ?? c.label.length * 7) +
        CLUSTER_CHIP_PAD_X * 2,
      height: CLUSTER_CHIP_HEIGHT,
      label: c.label,
      tcolor: c.paletteColor,
    }));
    dragIdx.value = -1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, clusterFont]);

  useEffect(() => {
    selectedClusterIdSV.value = selectedCluster?.id ?? -1;
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

  const matchCount = useMemo(() => {
    if (!filterDate) return 0;
    return nodes.filter(
      (n) => (n.date || n.capturedAt).slice(0, 10) === filterDate,
    ).length;
  }, [filterDate, nodes]);

  useEffect(() => {
    if (!filterDate) {
      matchFlagsSV.value = [];
      return;
    }
    matchFlagsSV.value = nodes.map((n) =>
      (n.date || n.capturedAt).slice(0, 10) === filterDate ? 1 : 0,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterDate, graph]);

  const selectByIndex = (i: number) => {
    setExpanded(false);
    setSelected(i >= 0 ? nodes[i] : null);
  };

  const selectClusterById = (id: number) => {
    setExpanded(false);
    setSelected(null);
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
            e.x >= sx - cluster.width / 2 - 6 &&
            e.x <= sx + cluster.width / 2 + 6 &&
            e.y >= sy - cluster.height / 2 - 6 &&
            e.y <= sy + cluster.height / 2 + 6
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
        if (clusterFocus >= 0 && p.cluster !== clusterFocus) continue;
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
          const hitPad = 6;
          if (
            e.x >= sx - cluster.width / 2 - hitPad &&
            e.x <= sx + cluster.width / 2 + hitPad &&
            e.y >= sy - cluster.height / 2 - hitPad &&
            e.y <= sy + cluster.height / 2 + hitPad
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
        if (clusterFocus >= 0 && p.cluster !== clusterFocus) continue;
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

      // 1) edges — track drifted endpoints, dim on focus.
      for (let i = 0; i < es.length; i++) {
        const e = es[i];
        const a = e.source;
        const b = e.target;
        if (a >= n || b >= n) continue;
        const incident = selIdx >= 0 && (a === selIdx || b === selIdx);
        const normalizedWeight = clamp((e.weight - 0.3) / 0.7, 0, 1);
        const insideFocusedCluster =
          clusterFocus >= 0 &&
          ns[a].cluster === clusterFocus &&
          ns[b].cluster === clusterFocus;
        let op = 0.13 + 0.28 * normalizedWeight;
        let c = col(C.border);
        let sw = 0.75 + 1.75 * normalizedWeight;
        if (clusterFocus >= 0) {
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
        // A date filter keeps an edge lit only while it touches a match.
        if (filtering && !matches(a) && !matches(b)) op = Math.min(op, 0.03);
        edgePaint.setColor(c);
        edgePaint.setAlphaf(op);
        edgePaint.setStrokeWidth(sw);
        canvas.drawLine(dcx[a], dcy[a], dcx[b], dcy[b], edgePaint);
      }

      // 2) nodes — soft shadow, paper ring, colored dot; dim non-neighbours.
      for (let i = 0; i < n; i++) {
        const node = ns[i];
        const dim =
          (clusterFocus >= 0 && node.cluster !== clusterFocus) ||
          (selIdx >= 0 && flags.length > i && flags[i] === 0) ||
          !matches(i);
        const alpha = dim ? 0.07 : selIdx < 0 && !filtering ? 0.92 : 0.97;
        shadowPaint.setAlphaf(dim ? 0.04 : 0.1);
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

      // 3) selection ring
      if (selIdx >= 0 && selIdx < n) {
        canvas.drawCircle(dcx[selIdx], dcy[selIdx], ns[selIdx].r + 3, selPaint);
      }

      canvas.restore();

      // 4) labels in SCREEN space (constant size). Cluster labels fade out and
      // node keywords fade in as you zoom — matching the old overlay.
      const clusterA = lerpClamp(s, 1.15, 1.65, 1, 0);
      if (cFont && clusterA > 0.01) {
        const m = cFont.getMetrics();
        const asc = -m.ascent;
        const desc = m.descent;
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i];
          const active = clusterFocus === c.id;
          const dim = clusterFocus >= 0 && !active;
          const pillAlpha = clusterA * (dim ? 0.18 : 1);
          const sx = px + c.cx * s;
          const sy = py + c.cy * s;
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
          chipFill.setColor(active ? col(c.tcolor) : col(C.card));
          chipFill.setAlphaf((active ? 0.18 : 0.92) * pillAlpha);
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
          const dim =
            (clusterFocus >= 0 && node.cluster !== clusterFocus) ||
            (selIdx >= 0 && flags.length > i && flags[i] === 0) ||
            !matches(i);
          const a2 = keywordA * (dim ? 0.2 : 1);
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
            {filterDate
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
            style={[styles.sheet, cardStyle]}
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
              {selected.dateLabel ? (
                <Text style={styles.cardDate}>{selected.dateLabel}</Text>
              ) : null}
            </View>
            <Text style={styles.cardTitle}>{selected.title}</Text>
            <Text
              style={styles.cardBody}
              numberOfLines={expanded ? undefined : 4}
            >
              {selected.summary || selected.subtitle}
            </Text>
          </Animated.View>
        </GestureDetector>
      ) : selectedCluster ? (
        <Animated.View
          key={`cluster-${selectedCluster.id}`}
          style={styles.sheet}
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Themenbeschreibung schließen"
              hitSlop={10}
              onPress={() => setSelectedCluster(null)}
            >
              <Text style={styles.closeButton}>×</Text>
            </Pressable>
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
        </Animated.View>
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
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
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
  closeButton: {
    fontFamily: NOTE_SANS,
    fontSize: 26,
    lineHeight: 28,
    color: C.ink40,
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
});
