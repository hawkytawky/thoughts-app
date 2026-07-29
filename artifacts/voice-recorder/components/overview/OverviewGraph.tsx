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
import { Canvas, Circle, Group, Line, vec } from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
  noteCategoryColor,
} from "@/components/NoteUI";
import { fetchGraph, type Graph, type GraphNode } from "@/lib/visualizations";

const PAD = 46;
const MIN_SCALE = 0.6;
const MAX_SCALE = 4;

function clamp(v: number, lo: number, hi: number) {
  "worklet";
  return Math.min(hi, Math.max(lo, v));
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
        const min = a.r + b.r + 9;
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

export function OverviewGraph() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">(
    "loading",
  );
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [expanded, setExpanded] = useState(false);

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const prevScale = useSharedValue(1);
  const cardY = useSharedValue(0);

  const load = () => {
    setStatus("loading");
    fetchGraph("network")
      .then((g) => {
        setGraph(g);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  };
  useEffect(load, []);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const clusters = graph?.clusters ?? [];

  const layout = useMemo(() => {
    const w = Math.max(0, size.w - PAD * 2);
    const h = Math.max(0, size.h - PAD * 2);
    const pos: Pos[] = nodes.map((n) => {
      const cl = clusters.find((c) => c.id === n.cluster);
      return {
        idx: n.idx,
        cx: PAD + n.x * w,
        cy: PAD + n.y * h,
        r: n.size,
        color: cl?.color ?? C.sky,
        tcolor: cl?.textColor ?? C.ink,
        keyword: n.keyword,
      };
    });
    if (pos.length && w > 0 && h > 0) declutter(pos);
    const centroids = clusters.map((c) => {
      const pts = pos.filter((_, i) => nodes[i].cluster === c.id);
      const cx = pts.reduce((s, p) => s + p.cx, 0) / (pts.length || 1);
      const cy = pts.reduce((s, p) => s + p.cy, 0) / (pts.length || 1);
      return { ...c, cx, cy };
    });
    return { pos, centroids };
  }, [graph, size]);

  // focus: which nodes are the selected node + its neighbours
  const neighbours = useMemo(() => {
    if (!selected) return null;
    const set = new Set<number>([selected.idx]);
    for (const e of edges) {
      if (e.source === selected.idx) set.add(e.target);
      if (e.target === selected.idx) set.add(e.source);
    }
    return set;
  }, [selected, edges]);

  const selectByIndex = (i: number) => {
    setExpanded(false);
    cardY.value = 0;
    setSelected(i >= 0 ? nodes[i] : null);
  };

  const handleCardSwipe = (dy: number) => {
    if (!expanded && dy < -40) setExpanded(true);
    else if (dy > 60) {
      if (expanded) setExpanded(false);
      else setSelected(null);
    }
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  };

  // ---- canvas gestures (incremental → pan & pinch compose cleanly) ----
  const pan = Gesture.Pan().onChange((e) => {
    tx.value += e.changeX;
    ty.value += e.changeY;
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
      const bx = (e.x - tx.value) / scale.value;
      const by = (e.y - ty.value) / scale.value;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < layout.pos.length; i++) {
        const p = layout.pos[i];
        const d = (p.cx - bx) ** 2 + (p.cy - by) ** 2;
        const hit = Math.max(p.r + 8, 16) ** 2;
        if (d < hit && d < bestD) {
          bestD = d;
          best = i;
        }
      }
      runOnJS(selectByIndex)(best);
    });

  const canvasGesture = Gesture.Simultaneous(pan, pinch, tap);

  const cardPan = Gesture.Pan()
    .onChange((e) => {
      cardY.value = clamp(cardY.value + e.changeY, -180, 400);
    })
    .onEnd(() => {
      const dy = cardY.value;
      cardY.value = withSpring(0, { damping: 18 });
      runOnJS(handleCardSwipe)(dy);
    });

  const skiaTransform = useDerivedValue(() => [
    { translateX: tx.value },
    { translateY: ty.value },
    { scale: scale.value },
  ]);
  const overlayStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));
  // level-of-detail crossfade: cluster labels out, node keywords in
  const clusterLabelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scale.value, [1.15, 1.65], [1, 0], Extrapolation.CLAMP),
  }));
  const keywordStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scale.value, [1.35, 1.85], [0, 1], Extrapolation.CLAMP),
  }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
  }));

  const nodeOpacity = (idx: number) =>
    !selected ? 0.94 : neighbours?.has(idx) ? 0.96 : 0.16;

  return (
    <View style={styles.root} onLayout={onLayout}>
      <GestureDetector gesture={canvasGesture}>
        <View style={StyleSheet.absoluteFill}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Group transform={skiaTransform}>
              {edges.map((ed, i) => {
                const a = layout.pos[ed.source];
                const b = layout.pos[ed.target];
                if (!a || !b) return null;
                const incident =
                  selected != null &&
                  (ed.source === selected.idx || ed.target === selected.idx);
                let op = 0.1 + 0.22 * ed.weight;
                let col: string = C.border;
                let sw = 0.8;
                if (selected != null) {
                  if (incident) {
                    op = 0.35 + 0.5 * ed.weight;
                    col = a.color;
                    sw = 1.6;
                  } else {
                    op = 0.04;
                  }
                }
                return (
                  <Line
                    key={`e${i}`}
                    p1={vec(a.cx, a.cy)}
                    p2={vec(b.cx, b.cy)}
                    color={col}
                    style="stroke"
                    strokeWidth={sw}
                    opacity={op}
                  />
                );
              })}
              {layout.pos.map((p) => (
                <Group key={`n${p.idx}`} opacity={nodeOpacity(p.idx)}>
                  <Circle cx={p.cx} cy={p.cy} r={p.r + 1.5} color={C.paper} />
                  <Circle cx={p.cx} cy={p.cy} r={p.r} color={p.color} />
                </Group>
              ))}
              {selected
                ? (() => {
                    const p = layout.pos[selected.idx];
                    if (!p) return null;
                    return (
                      <Circle
                        cx={p.cx}
                        cy={p.cy}
                        r={p.r + 5}
                        color={C.ink}
                        style="stroke"
                        strokeWidth={2}
                      />
                    );
                  })()
                : null}
            </Group>
          </Canvas>

          {/* labels overlay — synced to pan/zoom, crossfading by zoom */}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.origin, overlayStyle]}
          >
            <Animated.View style={[StyleSheet.absoluteFill, clusterLabelStyle]}>
              {layout.centroids.map((c) => (
                <View
                  key={`l${c.id}`}
                  style={[
                    styles.chip,
                    { left: c.cx, top: c.cy, borderColor: c.color },
                  ]}
                >
                  <Text style={[styles.chipText, { color: c.textColor }]}>
                    {c.label}
                  </Text>
                </View>
              ))}
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, keywordStyle]}>
              {layout.pos.map((p) => (
                <View
                  key={`k${p.idx}`}
                  style={[styles.keyword, { left: p.cx - 44, top: p.cy - 8 }]}
                >
                  <Text
                    numberOfLines={1}
                    style={[styles.keywordText, { color: p.tcolor }]}
                  >
                    {p.keyword}
                  </Text>
                </View>
              ))}
            </Animated.View>
          </Animated.View>
        </View>
      </GestureDetector>

      {status === "ready" && nodes.length > 0 ? (
        <View pointerEvents="none" style={styles.hintRow}>
          <Text style={styles.hint}>
            {nodes.length} Gedanken · {clusters.length} Themen
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
          <Pressable onPress={load} style={styles.retry} hitSlop={8}>
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
          <Animated.View style={[styles.card, cardStyle]}>
            <View style={styles.handle} />
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.typeDot,
                  { backgroundColor: noteCategoryColor(selected.type) },
                ]}
              />
              <Text style={styles.typeLabel}>{selected.type}</Text>
            </View>
            <Text style={styles.cardTitle}>{selected.title}</Text>
            {selected.dateLabel ? (
              <Text style={styles.cardDate}>{selected.dateLabel}</Text>
            ) : null}
            <ScrollView style={{ maxHeight: expanded ? 260 : undefined }}>
              <Text style={styles.cardSubtitle}>
                {expanded
                  ? selected.summary || selected.subtitle
                  : selected.subtitle}
              </Text>
            </ScrollView>
          </Animated.View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper, overflow: "hidden" },
  origin: { transformOrigin: "top left" },
  chip: {
    position: "absolute",
    transform: [{ translateX: -60 }, { translateY: -13 }],
    maxWidth: 170,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 11,
    borderWidth: 1,
    backgroundColor: "rgba(249,249,248,0.86)",
  },
  chipText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11.5,
    textAlign: "center",
  },
  keyword: { position: "absolute", width: 88, alignItems: "center" },
  keywordText: { fontFamily: NOTE_SANS_MEDIUM, fontSize: 10.5 },
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
  card: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 16,
    backgroundColor: C.card,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    shadowColor: C.ink,
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: "rgba(138,163,184,0.5)",
    alignSelf: "center",
    marginBottom: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  typeDot: { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  typeLabel: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    letterSpacing: 0.6,
    color: C.ink60,
    textTransform: "uppercase",
    flex: 1,
  },
  cardTitle: {
    fontFamily: NOTE_SERIF,
    fontSize: 20,
    lineHeight: 26,
    color: C.ink,
    marginBottom: 3,
  },
  cardDate: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 13,
    color: C.ink40,
    marginBottom: 10,
  },
  cardSubtitle: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    lineHeight: 20,
    color: C.ink70,
  },
});
