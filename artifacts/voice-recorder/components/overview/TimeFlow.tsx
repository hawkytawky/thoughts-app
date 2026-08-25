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
  Canvas,
  createPicture,
  PaintStyle,
  Picture,
  Skia,
  useFont,
} from "@shopify/react-native-skia";
import { InstrumentSans_500Medium } from "@expo-google-fonts/instrument-sans";
import { type Href, useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  FadeInDown,
  FadeOutDown,
  runOnJS,
  useDerivedValue,
  useSharedValue,
} from "react-native-reanimated";
import {
  NOTE_COLORS as C,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
} from "@/components/NoteUI";
import {
  type Graph,
  type GraphCluster,
  type GraphNode,
} from "@/lib/visualizations";

const MIN_SCALE = 1;
const MAX_SCALE = 16;
const LEFT_PAD = 42;
const RIGHT_PAD = 18;
const TOP_PAD = 8;
const BOTTOM_PAD = 18;

function clamp(value: number, minimum: number, maximum: number): number {
  "worklet";
  return Math.min(maximum, Math.max(minimum, value));
}

function lerp(
  value: number,
  inputStart: number,
  inputEnd: number,
  outputStart: number,
  outputEnd: number,
): number {
  "worklet";
  const progress = clamp(
    (value - inputStart) / (inputEnd - inputStart),
    0,
    1,
  );
  return outputStart + (outputEnd - outputStart) * progress;
}

type BandSample = { x0: number; x1: number; y: number };
type BandDraw = {
  cluster: string;
  color: string;
  samples: BandSample[];
};
type DotDraw = {
  nodeIndex: number;
  cluster: string;
  cx: number;
  cy: number;
  color: string;
};
type DayDraw = {
  y: number;
  shortLabel: string;
  detailLabel: string;
};
type ChipDraw = {
  cluster: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  color: string;
  label: string;
};

type FlowLayout = {
  bands: BandDraw[];
  chips: ChipDraw[];
  days: DayDraw[];
  dots: DotDraw[];
};

const EMPTY_LAYOUT: FlowLayout = { bands: [], chips: [], days: [], dots: [] };

function germanDayLabel(dateKey: string, thoughtCount: number): DayDraw {
  const date = new Date(`${dateKey}T12:00:00`);
  const shortLabel = new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
  const weekday = new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
  })
    .format(date)
    .replace(".", "");
  return {
    y: 0,
    shortLabel,
    detailLabel: `${weekday} ${shortLabel} · ${thoughtCount}`,
  };
}

function timeFraction(capturedAt: string): number {
  const match = capturedAt.match(/T(\d{2}):(\d{2})/);
  if (!match) return 0.5;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return clamp(minutes / 1440, 0.08, 0.92);
}

function buildLayout(
  graph: Graph,
  width: number,
  height: number,
): FlowLayout {
  const days = graph.time?.days ?? [];
  if (width <= 0 || height <= 0 || days.length === 0) return EMPTY_LAYOUT;

  const clusters = new Map<string, GraphCluster>(
    graph.clusters.map((cluster) => [cluster.id, cluster]),
  );
  const totalWords = new Map<string, number>();
  for (const day of days) {
    for (const topic of day.topics) {
      totalWords.set(
        topic.cluster,
        (totalWords.get(topic.cluster) ?? 0) + topic.wordCount,
      );
    }
  }
  const order = [...clusters.keys()].sort(
    (left, right) =>
      (totalWords.get(right) ?? 0) - (totalWords.get(left) ?? 0) ||
      left.localeCompare(right),
  );

  const availableWidth = Math.max(1, width - LEFT_PAD - RIGHT_PAD);
  const maxWords = Math.max(1, graph.time.maxDailyWordCount);
  const centerX = LEFT_PAD + availableWidth / 2;
  const step = Math.max(1, (height - TOP_PAD - BOTTOM_PAD) / days.length);
  const samplesByCluster = new Map<string, BandSample[]>();
  const dayCenters = new Map<string, Map<string, number>>();
  order.forEach((cluster) => samplesByCluster.set(cluster, []));

  days.forEach((day, dayIndex) => {
    const byCluster = new Map(
      day.topics.map((topic) => [topic.cluster, topic.wordCount]),
    );
    const dayWidth = (availableWidth * day.wordCount) / maxWords;
    let cursor = centerX - dayWidth / 2;
    const centers = new Map<string, number>();
    const y = TOP_PAD + (dayIndex + 0.5) * step;

    for (const cluster of order) {
      const widthForTopic =
        (availableWidth * (byCluster.get(cluster) ?? 0)) / maxWords;
      const x0 = cursor;
      const x1 = cursor + widthForTopic;
      samplesByCluster.get(cluster)?.push({ x0, x1, y });
      centers.set(cluster, (x0 + x1) / 2);
      cursor = x1;
    }
    dayCenters.set(day.date, centers);
  });

  const bands: BandDraw[] = order.map((clusterId) => {
    const cluster = clusters.get(clusterId);
    const coreSamples = samplesByCluster.get(clusterId) ?? [];
    const first = coreSamples[0];
    const last = coreSamples[coreSamples.length - 1];
    return {
      cluster: clusterId,
      color: cluster?.color ?? C.ink40,
      samples:
        first && last
          ? [
              { x0: first.x0, x1: first.x1, y: TOP_PAD },
              ...coreSamples,
              { x0: last.x0, x1: last.x1, y: height - BOTTOM_PAD },
            ]
          : [],
    };
  });

  const dots: DotDraw[] = [];
  const dayIndexByDate = new Map(days.map((day, index) => [day.date, index]));
  graph.nodes.forEach((node, nodeIndex) => {
    const dayIndex = dayIndexByDate.get(node.date);
    if (dayIndex == null) return;
    const fraction = timeFraction(node.capturedAt);
    const centers = dayCenters.get(node.date);
    const cx = centers?.get(node.cluster) ?? centerX;
    dots.push({
      nodeIndex,
      cluster: node.cluster,
      cx,
      cy: TOP_PAD + (dayIndex + 0.12 + fraction * 0.76) * step,
      color: clusters.get(node.cluster)?.color ?? C.ink40,
    });
  });

  const dayLabels = days.map((day, index) => ({
    ...germanDayLabel(day.date, day.thoughtCount),
    y: TOP_PAD + index * step,
  }));

  const chips: ChipDraw[] = [];
  const usedY: number[] = [];
  for (const band of [...bands].sort((left, right) => {
    const leftWidth = Math.max(
      0,
      ...left.samples.map((sample) => sample.x1 - sample.x0),
    );
    const rightWidth = Math.max(
      0,
      ...right.samples.map((sample) => sample.x1 - sample.x0),
    );
    return rightWidth - leftWidth;
  })) {
    const widest = [...band.samples]
      .slice(1, -1)
      .sort(
        (left, right) =>
          right.x1 - right.x0 - (left.x1 - left.x0),
      )
      .find(
        (sample) =>
          sample.x1 - sample.x0 >= 14 &&
          usedY.every((used) => Math.abs(used - sample.y) >= 30),
      );
    const cluster = clusters.get(band.cluster);
    if (!widest || !cluster) continue;
    usedY.push(widest.y);
    chips.push({
      cluster: band.cluster,
      cx: (widest.x0 + widest.x1) / 2,
      cy: widest.y,
      width: cluster.label.length * 7 + 20,
      height: 24,
      color: cluster.color,
      label: cluster.label,
    });
  }

  return { bands, chips, days: dayLabels, dots };
}

export function TimeFlow({
  graph,
  onRetry,
  status,
}: {
  graph: Graph | null;
  onRetry: () => void;
  status: "loading" | "error" | "ready";
}) {
  const router = useRouter();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [focusedCluster, setFocusedCluster] = useState<string | null>(null);

  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const previousPinchScale = useSharedValue(1);
  const focusedClusterSV = useSharedValue<string | null>(null);
  const selectedNodeSV = useSharedValue(-1);
  const bandsSV = useSharedValue<BandDraw[]>([]);
  const chipsSV = useSharedValue<ChipDraw[]>([]);
  const daysSV = useSharedValue<DayDraw[]>([]);
  const dotsSV = useSharedValue<DotDraw[]>([]);

  const dayFont = useFont(InstrumentSans_500Medium, 10);
  const clusterFont = useFont(InstrumentSans_500Medium, 12);

  const layout = useMemo(
    () =>
      graph
        ? buildLayout(graph, size.width, size.height)
        : EMPTY_LAYOUT,
    [graph, size],
  );

  useEffect(() => {
    bandsSV.value = layout.bands;
    const metrics = clusterFont?.getMetrics();
    chipsSV.value = layout.chips.map((chip) => ({
      ...chip,
      width:
        (clusterFont?.measureText(chip.label).width ?? chip.width - 20) + 20,
      height: metrics ? -metrics.ascent + metrics.descent + 8 : chip.height,
    }));
    daysSV.value = layout.days;
    dotsSV.value = layout.dots;
    scale.value = 1;
    translateY.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, clusterFont]);

  useEffect(() => {
    focusedClusterSV.value = focusedCluster;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedCluster]);

  const choose = (nodeIndex: number, cluster: string | null) => {
    setFocusedCluster(cluster);
    setSelected(nodeIndex >= 0 ? (graph?.nodes[nodeIndex] ?? null) : null);
    selectedNodeSV.value = nodeIndex;
  };

  const clearFocus = () => {
    setFocusedCluster(null);
    setSelected(null);
    selectedNodeSV.value = -1;
  };

  const boundedTranslate = (candidate: number, nextScale: number): number => {
    "worklet";
    const top = TOP_PAD;
    const bottom = Math.max(top, size.height - BOTTOM_PAD);
    return clamp(
      candidate,
      bottom - bottom * nextScale,
      top - top * nextScale,
    );
  };

  const pan = Gesture.Pan()
    .activeOffsetY([-5, 5])
    .failOffsetX([-12, 12])
    .onChange((event) => {
      translateY.value = boundedTranslate(
        translateY.value + event.changeY,
        scale.value,
      );
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      previousPinchScale.value = 1;
    })
    .onUpdate((event) => {
      const factor = event.scale / previousPinchScale.value;
      previousPinchScale.value = event.scale;
      const nextScale = clamp(scale.value * factor, MIN_SCALE, MAX_SCALE);
      const applied = nextScale / scale.value;
      const nextTranslate =
        event.focalY - (event.focalY - translateY.value) * applied;
      scale.value = nextScale;
      translateY.value = boundedTranslate(nextTranslate, nextScale);
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((event) => {
      const currentScale = scale.value;
      const currentTranslate = translateY.value;
      const chips = chipsSV.value;
      const chipAlpha = lerp(currentScale, 1.15, 1.65, 1, 0);
      if (chipAlpha > 0.05) {
        for (let i = chips.length - 1; i >= 0; i--) {
          const chip = chips[i];
          const screenY = currentTranslate + chip.cy * currentScale;
          const centerX = clamp(
            chip.cx,
            LEFT_PAD + chip.width / 2,
            size.width - 5 - chip.width / 2,
          );
          const hitPadding = 8;
          if (
            event.x >= centerX - chip.width / 2 - hitPadding &&
            event.x <= centerX + chip.width / 2 + hitPadding &&
            event.y >= screenY - chip.height / 2 - hitPadding &&
            event.y <= screenY + chip.height / 2 + hitPadding
          ) {
            if (focusedClusterSV.value === chip.cluster) {
              runOnJS(clearFocus)();
            } else {
              runOnJS(choose)(-1, chip.cluster);
            }
            return;
          }
        }
      }

      const dots = dotsSV.value;
      let bestNode = -1;
      let bestDistance = Infinity;
      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const screenY = currentTranslate + dot.cy * currentScale;
        const distance = (dot.cx - event.x) ** 2 + (screenY - event.y) ** 2;
        const hitRadius = Math.max(16, 7 + currentScale * 0.8);
        if (distance <= hitRadius ** 2 && distance < bestDistance) {
          bestNode = dot.nodeIndex;
          bestDistance = distance;
        }
      }
      if (bestNode >= 0) {
        const dot = dots.find((candidate) => candidate.nodeIndex === bestNode);
        runOnJS(choose)(bestNode, dot?.cluster ?? null);
        return;
      }

      const baseY = (event.y - currentTranslate) / currentScale;
      const bands = bandsSV.value;
      for (let b = bands.length - 1; b >= 0; b--) {
        const band = bands[b];
        const samples = band.samples;
        for (let i = 1; i < samples.length; i++) {
          const before = samples[i - 1];
          const after = samples[i];
          if (baseY < before.y || baseY > after.y) continue;
          const progress = (baseY - before.y) / Math.max(1, after.y - before.y);
          const x0 = before.x0 + (after.x0 - before.x0) * progress;
          const x1 = before.x1 + (after.x1 - before.x1) * progress;
          if (event.x >= x0 && event.x <= x1) {
            runOnJS(choose)(-1, band.cluster);
            return;
          }
        }
      }
      runOnJS(clearFocus)();
    });

  const gesture = Gesture.Simultaneous(pan, pinch, tap);

  const picture = useDerivedValue(() =>
    createPicture((canvas) => {
      "worklet";
      const currentScale = scale.value;
      const currentTranslate = translateY.value;
      const focus = focusedClusterSV.value;
      const selectedIndex = selectedNodeSV.value;
      const bands = bandsSV.value;
      const dots = dotsSV.value;
      const days = daysSV.value;
      const chips = chipsSV.value;
      const width = size.width;
      const height = size.height;

      const colorCache: Record<string, ReturnType<typeof Skia.Color>> = {};
      const color = (hex: string) => {
        if (!colorCache[hex]) colorCache[hex] = Skia.Color(hex);
        return colorCache[hex];
      };

      const gridPaint = Skia.Paint();
      gridPaint.setAntiAlias(true);
      gridPaint.setStyle(PaintStyle.Stroke);
      gridPaint.setStrokeWidth(1);
      gridPaint.setColor(color(C.ink));
      gridPaint.setAlphaf(0.05);

      const bandPaint = Skia.Paint();
      bandPaint.setAntiAlias(true);
      const separatorPaint = Skia.Paint();
      separatorPaint.setAntiAlias(true);
      separatorPaint.setStyle(PaintStyle.Stroke);
      separatorPaint.setStrokeWidth(0.6);
      separatorPaint.setColor(color(C.card));
      separatorPaint.setAlphaf(0.3);

      for (let b = 0; b < bands.length; b++) {
        const band = bands[b];
        const samples = band.samples;
        if (samples.length < 2) continue;
        const path = Skia.Path.Make();
        const first = samples[0];
        path.moveTo(first.x0, currentTranslate + first.y * currentScale);
        for (let i = 1; i < samples.length; i++) {
          const before = samples[i - 1];
          const after = samples[i];
          const beforeY = currentTranslate + before.y * currentScale;
          const afterY = currentTranslate + after.y * currentScale;
          const middleY = (beforeY + afterY) / 2;
          path.cubicTo(
            before.x0,
            middleY,
            after.x0,
            middleY,
            after.x0,
            afterY,
          );
        }
        const last = samples[samples.length - 1];
        path.lineTo(last.x1, currentTranslate + last.y * currentScale);
        for (let i = samples.length - 2; i >= 0; i--) {
          const before = samples[i + 1];
          const after = samples[i];
          const beforeY = currentTranslate + before.y * currentScale;
          const afterY = currentTranslate + after.y * currentScale;
          const middleY = (beforeY + afterY) / 2;
          path.cubicTo(
            before.x1,
            middleY,
            after.x1,
            middleY,
            after.x1,
            afterY,
          );
        }
        path.close();
        bandPaint.setColor(color(band.color));
        const bandAlpha = lerp(currentScale, 1.05, 2.4, 0.68, 0.42);
        bandPaint.setAlphaf(
          focus === null || focus === band.cluster ? bandAlpha : 0.1,
        );
        canvas.drawPath(path, bandPaint);
        canvas.drawPath(path, separatorPaint);
      }

      const labelPaint = Skia.Paint();
      labelPaint.setAntiAlias(true);
      labelPaint.setColor(color(C.ink40));
      let previousDayY = -100;
      if (dayFont) {
        for (let i = 0; i < days.length; i++) {
          const day = days[i];
          const screenY = currentTranslate + day.y * currentScale;
          if (screenY < -12 || screenY > height + 12) continue;
          canvas.drawLine(0, screenY, width, screenY, gridPaint);
          if (screenY - previousDayY < 22) continue;
          previousDayY = screenY;
          const text = currentScale >= 2.3 ? day.detailLabel : day.shortLabel;
          labelPaint.setAlphaf(0.92);
          canvas.drawText(text, 4, screenY + 11, labelPaint, dayFont);
        }
      }

      const detail = lerp(currentScale, 1.05, 2.4, 0, 1);
      const haloPaint = Skia.Paint();
      haloPaint.setAntiAlias(true);
      const dotPaint = Skia.Paint();
      dotPaint.setAntiAlias(true);
      const innerPaint = Skia.Paint();
      innerPaint.setAntiAlias(true);
      innerPaint.setColor(color(C.card));
      const selectedPaint = Skia.Paint();
      selectedPaint.setAntiAlias(true);
      selectedPaint.setStyle(PaintStyle.Stroke);
      selectedPaint.setStrokeWidth(1);
      selectedPaint.setColor(color(C.ink));
      selectedPaint.setAlphaf(0.75);

      for (let i = 0; i < dots.length; i++) {
        const dot = dots[i];
        const screenY = currentTranslate + dot.cy * currentScale;
        if (screenY < -14 || screenY > height + 14) continue;
        const dimmed = focus !== null && focus !== dot.cluster;
        const radius = 2.6 + detail * 2.1;
        const alpha = dimmed ? 0.1 : 0.95;
        haloPaint.setColor(color(dot.color));
        haloPaint.setAlphaf(dimmed ? 0.04 : 0.12 + detail * 0.08);
        canvas.drawCircle(dot.cx, screenY, radius + 4, haloPaint);
        dotPaint.setColor(color(dot.color));
        dotPaint.setAlphaf(alpha);
        canvas.drawCircle(dot.cx, screenY, radius, dotPaint);
        innerPaint.setAlphaf(dimmed ? 0.35 : 1);
        canvas.drawCircle(dot.cx, screenY, Math.max(1, radius - 1.4), innerPaint);
        if (dot.nodeIndex === selectedIndex) {
          canvas.drawCircle(dot.cx, screenY, radius + 3, selectedPaint);
        }
      }

      const chipAlpha = lerp(currentScale, 1.15, 1.65, 1, 0);
      if (clusterFont && chipAlpha > 0.01) {
        const metrics = clusterFont.getMetrics();
        const ascent = -metrics.ascent;
        const descent = metrics.descent;
        const textHeight = ascent + descent;
        const textPaint = Skia.Paint();
        textPaint.setAntiAlias(true);
        textPaint.setColor(color(C.ink));
        const fillPaint = Skia.Paint();
        fillPaint.setAntiAlias(true);
        fillPaint.setColor(color(C.card));
        const strokePaint = Skia.Paint();
        strokePaint.setAntiAlias(true);
        strokePaint.setStyle(PaintStyle.Stroke);
        strokePaint.setStrokeWidth(1);

        for (let i = 0; i < chips.length; i++) {
          const chip = chips[i];
          const screenY = currentTranslate + chip.cy * currentScale;
          if (screenY < -20 || screenY > height + 20) continue;
          const textWidth = clusterFont.measureText(chip.label).width;
          const chipWidth = chip.width;
          const chipHeight = chip.height;
          const centerX = clamp(
            chip.cx,
            LEFT_PAD + chipWidth / 2,
            width - 5 - chipWidth / 2,
          );
          const rect = Skia.XYWHRect(
            centerX - chipWidth / 2,
            screenY - chipHeight / 2,
            chipWidth,
            chipHeight,
          );
          const rounded = Skia.RRectXY(
            rect,
            chipHeight / 2,
            chipHeight / 2,
          );
          const dimmed = focus !== null && focus !== chip.cluster;
          const alpha = chipAlpha * (dimmed ? 0.12 : 1);
          fillPaint.setAlphaf(alpha * 0.92);
          canvas.drawRRect(rounded, fillPaint);
          strokePaint.setColor(color(chip.color));
          strokePaint.setAlphaf(alpha * 0.9);
          canvas.drawRRect(rounded, strokePaint);
          textPaint.setAlphaf(alpha);
          canvas.drawText(
            chip.label,
            centerX - textWidth / 2,
            screenY + (ascent - descent) / 2,
            textPaint,
            clusterFont,
          );
        }
      }
    }),
  );

  const selectedTopic = selected
    ? graph?.clusters.find((cluster) => cluster.id === selected.cluster)
    : null;

  const openSelected = () => {
    if (!selected) return;
    router.push(
      `/thoughts/detail?path=${encodeURIComponent(selected.id)}` as Href,
    );
  };

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

      {status === "loading" ? (
        <View pointerEvents="none" style={styles.center}>
          <ActivityIndicator color={C.sky} />
        </View>
      ) : null}

      {status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.stateText}>
            Der Gedankenfluss konnte nicht geladen werden.
          </Text>
          <Pressable hitSlop={8} onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : null}

      {status === "ready" && graph?.nodes.length === 0 ? (
        <View pointerEvents="none" style={styles.center}>
          <Text style={styles.stateText}>
            Noch nicht genug Gedanken für einen Verlauf.
          </Text>
        </View>
      ) : null}

      {selected ? (
        <Animated.View
          entering={FadeInDown.duration(180)}
          exiting={FadeOutDown.duration(140)}
          style={styles.cardWrap}
        >
          <Pressable
            accessibilityLabel={`${selectedTopic?.label ?? "Thema"}: ${selected.title}. Thought öffnen`}
            accessibilityRole="button"
            onPress={openSelected}
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
          >
            <Text
              style={[
                styles.topic,
                { color: selectedTopic?.textColor ?? C.ink60 },
              ]}
            >
              {selectedTopic?.label ?? "Thema"}
            </Text>
            <Text style={styles.title}>{selected.title}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent", overflow: "hidden" },
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
  retry: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: C.skyLight,
  },
  retryText: { fontFamily: NOTE_SANS_MEDIUM, fontSize: 13, color: C.skyDeep },
  cardWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 12,
  },
  card: {
    paddingHorizontal: 15,
    paddingTop: 11,
    paddingBottom: 13,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    backgroundColor: C.card,
    shadowColor: C.ink,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  topic: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    fontFamily: NOTE_SERIF,
    fontSize: 17,
    lineHeight: 22,
    color: C.ink,
  },
});
