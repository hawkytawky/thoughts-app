import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated as NativeAnimated,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Canvas,
  createPicture,
  Fill,
  PaintStyle,
  Picture,
  Shader,
  Skia,
  StrokeCap,
  TileMode,
  vec,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { type Href, useRouter } from "expo-router";
import { runOnJS } from "react-native-reanimated";
import { NOTE_SANS, NOTE_SERIF } from "@/components/NoteUI";
import { MEMORY_THEME } from "@/lib/memory-theme";
import {
  buildFeelingDistributionSegments,
  buildFeelingLayout,
  FEELING_FLOW_HEIGHT,
  FEELING_HORIZONTAL_PAD,
  FEELING_SWARM_CENTER_Y,
  FEELING_SWARM_HEIGHT,
  feelingColor,
  feelingThoughtsFromGraph,
  type FeelingFlowSample,
  type FeelingLayout,
  type FeelingPeriod,
} from "@/lib/feeling-layout";
import type { Graph } from "@/lib/visualizations";

const FIELD = MEMORY_THEME.field;
const INK = MEMORY_THEME.ink;
const MUTED = MEMORY_THEME.muted;
const AXIS = MEMORY_THEME.axis;
const GRAPH_WIDTH = 349;
const FLOW_TOP = 10;
const FLOW_BOTTOM = 22;
const SWARM_RADIUS = 3.6;
const DISTRIBUTION_SEGMENT_GAP = 3;
const DISTRIBUTION_BAR_Y = FEELING_SWARM_HEIGHT - 22;
const DISTRIBUTION_PERCENTAGE_TOP = FEELING_SWARM_HEIGHT - 18;

const GRAIN_SHADER = Skia.RuntimeEffect.Make(`
uniform float2 resolution;
float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}
half4 main(float2 xy) {
  float grain = hash(xy * 0.82 + resolution * 0.001);
  return half4(0.0, 0.0, 0.0, (1.0 - grain) * 0.055);
}
`);

function curvePath(samples: FeelingFlowSample[], field: "y" | "q1Y" | "q3Y") {
  const path = Skia.Path.Make();
  if (samples.length === 0) return path;
  path.moveTo(samples[0].x, samples[0][field]);
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    const control = (current.x - previous.x) / 2;
    path.cubicTo(
      previous.x + control,
      previous[field],
      current.x - control,
      current[field],
      current.x,
      current[field],
    );
  }
  return path;
}

function bandPath(samples: FeelingFlowSample[]) {
  const path = curvePath(samples, "q3Y");
  if (samples.length === 0) return path;
  const reversed = [...samples].reverse();
  path.lineTo(reversed[0].x, reversed[0].q1Y);
  for (let index = 1; index < reversed.length; index++) {
    const previous = reversed[index - 1];
    const current = reversed[index];
    const control = (current.x - previous.x) / 2;
    path.cubicTo(
      previous.x + control,
      previous.q1Y,
      current.x - control,
      current.q1Y,
      current.x,
      current.q1Y,
    );
  }
  path.close();
  return path;
}

function percentageSegments(layout: FeelingLayout) {
  const segments = buildFeelingDistributionSegments(
    layout.width,
    layout.distributionShares,
    FEELING_HORIZONTAL_PAD,
    DISTRIBUTION_SEGMENT_GAP,
  );
  return layout.percentages.map((percentage, index) => {
    return {
      ...segments[index],
      color: feelingColor([-0.8, 0, 0.8][index]),
      percentage,
    };
  });
}

function drawSwarm(
  layout: FeelingLayout,
  selectedThoughtId: string | null,
  selectedDate: string | null,
) {
  return createPicture((canvas) => {
    const centerY = FEELING_SWARM_CENTER_Y;
    const axisPaint = Skia.Paint();
    axisPaint.setAntiAlias(true);
    axisPaint.setColor(Skia.Color(AXIS));
    axisPaint.setStrokeWidth(0.8);
    canvas.drawLine(
      FEELING_HORIZONTAL_PAD,
      centerY,
      layout.width - FEELING_HORIZONTAL_PAD,
      centerY,
      axisPaint,
    );

    const segmentPaint = Skia.Paint();
    segmentPaint.setAntiAlias(true);
    segmentPaint.setStrokeWidth(2);
    segmentPaint.setStrokeCap(StrokeCap.Round);
    segmentPaint.setAlphaf(0.85);
    for (const segment of percentageSegments(layout)) {
      if (segment.endX <= segment.startX) continue;
      segmentPaint.setColor(Skia.Color(segment.color));
      canvas.drawLine(
        segment.startX,
        DISTRIBUTION_BAR_Y,
        segment.endX,
        DISTRIBUTION_BAR_Y,
        segmentPaint,
      );
    }

    const selectedDateIds = new Set(
      selectedDate ? (layout.thoughtIdsByDate[selectedDate] ?? []) : [],
    );
    const pointPaint = Skia.Paint();
    pointPaint.setAntiAlias(true);
    for (const point of layout.swarmPoints) {
      const alpha = selectedThoughtId
        ? point.id === selectedThoughtId
          ? 1
          : 0.2
        : selectedDate
          ? selectedDateIds.has(point.id)
            ? 1
            : 0.15
          : point.alpha;
      pointPaint.setColor(Skia.Color(point.color));
      pointPaint.setAlphaf(alpha);
      canvas.drawCircle(point.x, point.y, SWARM_RADIUS, pointPaint);
    }
  });
}

function drawFlow(
  layout: FeelingLayout,
  selectedDate: string | null,
  selectedThoughtId: string | null,
) {
  return createPicture((canvas) => {
    const axisPaint = Skia.Paint();
    axisPaint.setAntiAlias(true);
    axisPaint.setColor(Skia.Color(AXIS));
    axisPaint.setStrokeWidth(0.8);
    canvas.drawLine(
      FEELING_HORIZONTAL_PAD,
      layout.zeroY,
      layout.width - FEELING_HORIZONTAL_PAD,
      layout.zeroY,
      axisPaint,
    );

    if (layout.flowSamples.length > 0) {
      const fillPaint = Skia.Paint();
      fillPaint.setAntiAlias(true);
      fillPaint.setAlphaf(0.28);
      fillPaint.setShader(
        Skia.Shader.MakeLinearGradient(
          vec(0, FLOW_TOP),
          vec(0, FEELING_FLOW_HEIGHT - FLOW_BOTTOM),
          [
            Skia.Color(feelingColor(1)),
            Skia.Color(feelingColor(0)),
            Skia.Color(feelingColor(-1)),
          ],
          [0, 0.5, 1],
          TileMode.Clamp,
        ),
      );
      canvas.drawPath(bandPath(layout.flowSamples), fillPaint);

      const linePaint = Skia.Paint();
      linePaint.setAntiAlias(true);
      linePaint.setStyle(PaintStyle.Stroke);
      linePaint.setStrokeWidth(1.1);
      linePaint.setColor(Skia.Color(INK));
      linePaint.setAlphaf(0.75);
      canvas.drawPath(curvePath(layout.flowSamples, "y"), linePaint);
    }

    const pointPaint = Skia.Paint();
    pointPaint.setAntiAlias(true);
    for (const point of layout.flowPoints) {
      pointPaint.setColor(Skia.Color(point.color));
      pointPaint.setAlphaf(
        selectedThoughtId
          ? point.id === selectedThoughtId
            ? 1
            : 0.12
          : selectedDate
            ? point.date === selectedDate
              ? 1
              : 0.12
            : point.alpha,
      );
      canvas.drawCircle(
        point.x,
        point.y,
        point.id === selectedThoughtId ? 3.2 : 1.7,
        pointPaint,
      );
    }
  });
}

function signedValue(value: number): string {
  const absolute = Math.abs(value).toFixed(2);
  return value < 0 ? `−${absolute}` : `+${absolute}`;
}

function selectedDayText(dateKey: string, count: number, value: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  const month = [
    "Jan",
    "Feb",
    "Mär",
    "Apr",
    "Mai",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Okt",
    "Nov",
    "Dez",
  ][date.getMonth()];
  const label = `${date.getDate()}. ${month}`;
  return {
    primary: label,
    secondary: `${count} ${count === 1 ? "Gedanke" : "Gedanken"} · ${signedValue(value)}`,
  };
}

export function FeelingLens({
  active,
  graph,
  period,
}: {
  active: boolean;
  graph: Graph | null;
  period: FeelingPeriod;
}) {
  const router = useRouter();
  const [width, setWidth] = useState(GRAPH_WIDTH);
  const [selectedThoughtId, setSelectedThoughtId] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectionOpacity = useMemo(() => new NativeAnimated.Value(0), []);
  const markerOpacity = useMemo(() => new NativeAnimated.Value(0), []);
  const markerX = useMemo(() => new NativeAnimated.Value(0), []);
  const markerY = useMemo(() => new NativeAnimated.Value(0), []);
  const markerColor = useMemo(
    () =>
      markerY.interpolate({
        inputRange: [
          FLOW_TOP,
          FLOW_TOP + (FEELING_FLOW_HEIGHT - FLOW_TOP - FLOW_BOTTOM) / 2,
          FEELING_FLOW_HEIGHT - FLOW_BOTTOM,
        ],
        outputRange: [feelingColor(1), feelingColor(0), feelingColor(-1)],
      }),
    [markerY],
  );
  const selectedDateRef = useRef<string | null>(null);
  const selectionVisibleRef = useRef(false);
  const thoughts = useMemo(() => feelingThoughtsFromGraph(graph), [graph]);
  const layout = useMemo(
    () => buildFeelingLayout(thoughts, period, width),
    [period, thoughts, width],
  );

  useEffect(() => {
    setSelectedThoughtId(null);
    setSelectedDate(null);
    selectedDateRef.current = null;
    selectionVisibleRef.current = false;
    selectionOpacity.setValue(0);
    markerOpacity.setValue(0);
  }, [active, markerOpacity, period, selectionOpacity]);

  useEffect(() => {
    if (!selectedThoughtId) return;
    if (layout.thoughts.some(({ id }) => id === selectedThoughtId)) return;
    setSelectedThoughtId(null);
    setSelectedDate(null);
    selectedDateRef.current = null;
    selectionVisibleRef.current = false;
    selectionOpacity.setValue(0);
    markerOpacity.setValue(0);
  }, [layout.thoughts, markerOpacity, selectedThoughtId, selectionOpacity]);

  const selectedThought = selectedThoughtId
    ? (layout.thoughts.find(({ id }) => id === selectedThoughtId) ?? null)
    : null;
  const selectedDay = selectedDate
    ? selectedDayText(
        selectedDate,
        layout.thoughtIdsByDate[selectedDate]?.length ?? 0,
        layout.dayValues[selectedDate] ?? 0,
      )
    : null;

  const animateSelection = () => {
    if (selectionVisibleRef.current) return;
    selectionVisibleRef.current = true;
    selectionOpacity.setValue(0);
    NativeAnimated.timing(selectionOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const showCurveMarker = (x: number) => {
    if (layout.flowSamples.length === 0) return;
    const clampedX = Math.min(
      layout.width - FEELING_HORIZONTAL_PAD,
      Math.max(FEELING_HORIZONTAL_PAD, x),
    );
    const usableWidth = Math.max(1, layout.width - 2 * FEELING_HORIZONTAL_PAD);
    const samplePosition =
      ((clampedX - FEELING_HORIZONTAL_PAD) / usableWidth) *
      (layout.flowSamples.length - 1);
    const leftIndex = Math.floor(samplePosition);
    const rightIndex = Math.min(layout.flowSamples.length - 1, leftIndex + 1);
    const progress = samplePosition - leftIndex;
    const easedProgress = progress * progress * (3 - 2 * progress);
    const left = layout.flowSamples[leftIndex];
    const right = layout.flowSamples[rightIndex];
    markerX.setValue(clampedX);
    markerY.setValue(left.y + (right.y - left.y) * easedProgress);
    markerOpacity.setValue(1);
  };

  const showThoughtMarker = (point: (typeof layout.flowPoints)[number]) => {
    markerX.setValue(point.x);
    markerY.setValue(point.y);
    markerOpacity.setValue(1);
  };

  const selectThought = (thoughtId: string) => {
    const thought = layout.thoughts.find(({ id }) => id === thoughtId);
    const flowPoint = layout.flowPoints.find(({ id }) => id === thoughtId);
    if (!thought || !flowPoint) return;
    selectedDateRef.current = thought.date;
    setSelectedDate(thought.date);
    setSelectedThoughtId(thought.id);
    showThoughtMarker(flowPoint);
    animateSelection();
  };

  const chooseThoughtAt = (x: number, y: number) => {
    let closest: (typeof layout.swarmPoints)[number] | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const point of layout.swarmPoints) {
      const nextDistance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (nextDistance <= 12 ** 2 && nextDistance < distance) {
        closest = point;
        distance = nextDistance;
      }
    }
    if (closest) {
      selectThought(closest.id);
      return;
    }
    selectedDateRef.current = null;
    setSelectedDate(null);
    setSelectedThoughtId(null);
    markerOpacity.setValue(0);
    selectionVisibleRef.current = false;
    selectionOpacity.setValue(0);
  };

  const chooseDayAt = (x: number) => {
    if (
      x < FEELING_HORIZONTAL_PAD ||
      x > layout.width - FEELING_HORIZONTAL_PAD ||
      layout.flowPoints.length === 0
    ) {
      setSelectedDate(null);
      setSelectedThoughtId(null);
      selectedDateRef.current = null;
      markerOpacity.setValue(0);
      selectionVisibleRef.current = false;
      selectionOpacity.setValue(0);
      return;
    }
    showCurveMarker(x);
    const dates = Object.keys(layout.thoughtIdsByDate);
    let closestDate: string | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const date of dates) {
      const point = layout.flowPoints.find(
        (candidate) => candidate.date === date,
      );
      if (!point) continue;
      const nextDistance = Math.abs(point.x - x);
      if (nextDistance < distance) {
        closestDate = date;
        distance = nextDistance;
      }
    }
    if (!closestDate) return;
    setSelectedThoughtId(null);
    if (selectedDateRef.current !== closestDate) {
      selectedDateRef.current = closestDate;
      setSelectedDate(closestDate);
      animateSelection();
    }
  };

  const resetToDefault = () => {
    selectedDateRef.current = null;
    selectionVisibleRef.current = false;
    setSelectedDate(null);
    setSelectedThoughtId(null);
    selectionOpacity.stopAnimation();
    selectionOpacity.setValue(0);
    markerOpacity.stopAnimation();
    markerOpacity.setValue(0);
  };

  const openSelectedThought = () => {
    if (!selectedThought) return;
    router.push(
      `/thoughts/detail?path=${encodeURIComponent(selectedThought.id)}` as Href,
    );
  };

  const swarmGesture = Gesture.Tap()
    .maxDistance(12)
    .onEnd(({ x, y }) => runOnJS(chooseThoughtAt)(x, y));
  const flowGesture = Gesture.Pan()
    .minDistance(0)
    .onBegin(({ x }) => runOnJS(chooseDayAt)(x))
    .onUpdate(({ x }) => runOnJS(chooseDayAt)(x))
    .onFinalize(() => runOnJS(resetToDefault)());

  const swarmPicture = useMemo(
    () => drawSwarm(layout, selectedThoughtId, selectedDate),
    [layout, selectedDate, selectedThoughtId],
  );
  const flowPicture = useMemo(
    () => drawFlow(layout, selectedDate, selectedThoughtId),
    [layout, selectedDate, selectedThoughtId],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0 && Math.abs(nextWidth - width) > 0.5) setWidth(nextWidth);
  };

  return (
    <View style={styles.root}>
      <View style={styles.content} onLayout={onLayout}>
        {selectedThought ? (
          <Pressable
            accessibilityLabel="Auswahl schließen"
            accessibilityRole="button"
            onPress={resetToDefault}
            style={styles.selectionDismissLayer}
          />
        ) : null}
        <Text style={styles.sectionLabel}>VERTEILUNG</Text>
        <View style={styles.swarmWrap}>
          <GestureDetector gesture={swarmGesture}>
            <View style={styles.swarmCanvas}>
              <Canvas style={StyleSheet.absoluteFill}>
                <Picture picture={swarmPicture} />
              </Canvas>
            </View>
          </GestureDetector>
          {layout.swarmPoints.length > 0 ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {percentageSegments(layout).map((segment, index) => (
                <Text
                  key={index}
                  style={[
                    styles.percentage,
                    {
                      color: segment.color,
                      left: segment.centerX - 34,
                    },
                  ]}
                >
                  {segment.percentage} %
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <NativeAnimated.View
          pointerEvents={selectedThought ? "auto" : "none"}
          style={[styles.thoughtPreview, { opacity: selectionOpacity }]}
        >
          {selectedThought ? (
            <Pressable
              accessibilityLabel={`${selectedThought.title}. Vollständigen Thought öffnen`}
              accessibilityRole="button"
              onPress={openSelectedThought}
              style={({ pressed }) => [
                styles.previewRow,
                pressed && styles.previewRowPressed,
              ]}
            >
              <Text style={styles.selectionPrimary} numberOfLines={2}>
                {selectedThought.title}
                {selectedThought.themeLabel ? (
                  <Text style={styles.selectionSecondary}>
                    {`  ${selectedThought.themeLabel}`}
                  </Text>
                ) : null}
              </Text>
              <View pointerEvents="none" style={styles.previewArrow}>
                <Ionicons name="arrow-forward" size={14} color={MUTED} />
              </View>
            </Pressable>
          ) : null}
        </NativeAnimated.View>

        <Text style={[styles.sectionLabel, styles.flowSectionLabel]}>
          VERLAUF
        </Text>
        <NativeAnimated.View
          pointerEvents="none"
          style={[styles.daySelection, { opacity: selectionOpacity }]}
        >
          {selectedDate && selectedDay ? (
            <Text style={styles.selectionPrimary} numberOfLines={1}>
              {selectedDay.primary}
              <Text style={styles.selectionSecondary}>
                {`  ${selectedDay.secondary}`}
              </Text>
            </Text>
          ) : null}
        </NativeAnimated.View>

        <View style={styles.flowWrap}>
          <GestureDetector gesture={flowGesture}>
            <View style={styles.flowCanvas}>
              <Canvas style={StyleSheet.absoluteFill}>
                <Picture picture={flowPicture} />
              </Canvas>
              <NativeAnimated.View
                pointerEvents="none"
                style={[
                  styles.markerLine,
                  {
                    opacity: markerOpacity,
                    transform: [{ translateX: markerX }],
                  },
                ]}
              />
              <NativeAnimated.View
                pointerEvents="none"
                style={[
                  styles.marker,
                  {
                    opacity: markerOpacity,
                    transform: [
                      { translateX: markerX },
                      { translateY: markerY },
                    ],
                    backgroundColor: markerColor,
                  },
                ]}
              />
            </View>
          </GestureDetector>
          {layout.flowPoints.length > 0 ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {layout.monthLabels.map((month, index) => (
                <Text
                  key={`${month.label}-${index}`}
                  style={[styles.month, { left: month.x - 4 }]}
                >
                  {month.label}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>
      {GRAIN_SHADER ? (
        <View pointerEvents="none" style={styles.grain}>
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader
                source={GRAIN_SHADER}
                uniforms={{ resolution: [width, 600] }}
              />
            </Fill>
          </Canvas>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: FIELD,
  },
  content: {
    position: "relative",
    paddingTop: 26,
    paddingHorizontal: 22,
  },
  selectionDismissLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  sectionLabel: {
    marginBottom: 10,
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.32,
    color: MUTED,
  },
  swarmWrap: {
    height: FEELING_SWARM_HEIGHT,
    position: "relative",
  },
  swarmCanvas: {
    height: FEELING_SWARM_HEIGHT,
  },
  percentage: {
    position: "absolute",
    top: DISTRIBUTION_PERCENTAGE_TOP,
    width: 68,
    fontFamily: NOTE_SANS,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  thoughtPreview: {
    position: "relative",
    zIndex: 21,
    minHeight: 44,
    marginTop: 14,
    justifyContent: "flex-start",
  },
  previewRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MEMORY_THEME.previewBorder,
    backgroundColor: MEMORY_THEME.preview,
  },
  previewRowPressed: {
    opacity: 0.5,
  },
  selectionPrimary: {
    flex: 1,
    fontFamily: NOTE_SERIF,
    fontSize: 15.5,
    lineHeight: 22,
    color: INK,
  },
  selectionSecondary: {
    fontFamily: NOTE_SANS,
    fontSize: 11.5,
    color: MUTED,
  },
  previewArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.58)",
  },
  flowSectionLabel: {
    marginTop: 18,
  },
  daySelection: {
    minHeight: 24,
    marginBottom: 6,
    justifyContent: "flex-start",
  },
  flowWrap: {
    height: FEELING_FLOW_HEIGHT,
    position: "relative",
  },
  flowCanvas: {
    height: FEELING_FLOW_HEIGHT,
    overflow: "hidden",
  },
  markerLine: {
    position: "absolute",
    top: FLOW_TOP,
    left: -0.35,
    width: 0.7,
    height: FEELING_FLOW_HEIGHT - FLOW_TOP - FLOW_BOTTOM + 2,
    backgroundColor: "rgba(36,53,66,0.35)",
  },
  marker: {
    position: "absolute",
    top: -4.2,
    left: -4.2,
    width: 8.4,
    height: 8.4,
    borderRadius: 4.2,
    borderWidth: 0.9,
    borderColor: INK,
  },
  month: {
    position: "absolute",
    top: FEELING_FLOW_HEIGHT - 17,
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 14,
    color: MUTED,
  },
  grain: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.2,
    zIndex: 10,
  },
});
