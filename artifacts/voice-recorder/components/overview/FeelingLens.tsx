import React, { useEffect, useMemo, useState } from "react";
import {
  Animated as NativeAnimated,
  LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  Canvas,
  createPicture,
  Fill,
  PaintStyle,
  Picture,
  Shader,
  Skia,
  TileMode,
  vec,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { NOTE_SANS, NOTE_SERIF } from "@/components/NoteUI";
import {
  buildFeelingLayout,
  FEELING_FLOW_HEIGHT,
  FEELING_HORIZONTAL_PAD,
  FEELING_SWARM_HEIGHT,
  FEELING_THRESHOLD,
  feelingColor,
  feelingThoughtsFromGraph,
  type FeelingFlowSample,
  type FeelingLayout,
  type FeelingPeriod,
} from "@/lib/feeling-layout";
import type { Graph } from "@/lib/visualizations";

const FIELD = "#F2F3F5";
const INK = "#243542";
const MUTED = "#8A949C";
const AXIS = "#D5DBE0";
const TICK = "#C9D0D6";
const GRAPH_WIDTH = 349;
const FLOW_TOP = 10;
const FLOW_BOTTOM = 22;
const SWARM_RADIUS = 3.6;

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

function drawSwarm(
  layout: FeelingLayout,
  selectedThoughtId: string | null,
  selectedDate: string | null,
) {
  return createPicture((canvas) => {
    const centerY = FEELING_SWARM_HEIGHT / 2;
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

    const tickPaint = Skia.Paint();
    tickPaint.setAntiAlias(true);
    tickPaint.setColor(Skia.Color(TICK));
    tickPaint.setStrokeWidth(0.8);
    for (const threshold of [-FEELING_THRESHOLD, FEELING_THRESHOLD]) {
      const x =
        FEELING_HORIZONTAL_PAD +
        ((threshold + 1) / 2) * (layout.width - 2 * FEELING_HORIZONTAL_PAD);
      canvas.drawLine(x, centerY - 6, x, centerY + 6, tickPaint);
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

function drawFlow(layout: FeelingLayout, selectedDate: string | null) {
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
        selectedDate ? (point.date === selectedDate ? 1 : 0.12) : point.alpha,
      );
      canvas.drawCircle(point.x, point.y, 1.7, pointPaint);
    }

    if (selectedDate) {
      const selectedPoint = layout.flowPoints.find(
        (point) => point.date === selectedDate,
      );
      const dayValue = layout.dayValues[selectedDate];
      if (selectedPoint && dayValue != null) {
        const markerY =
          FLOW_TOP +
          ((1 - dayValue) / 2) * (FEELING_FLOW_HEIGHT - FLOW_TOP - FLOW_BOTTOM);
        const markerLine = Skia.Paint();
        markerLine.setAntiAlias(true);
        markerLine.setColor(Skia.Color(INK));
        markerLine.setStrokeWidth(0.7);
        markerLine.setAlphaf(0.35);
        canvas.drawLine(
          selectedPoint.x,
          FLOW_TOP,
          selectedPoint.x,
          FEELING_FLOW_HEIGHT - FLOW_BOTTOM + 2,
          markerLine,
        );

        const marker = Skia.Paint();
        marker.setAntiAlias(true);
        marker.setColor(Skia.Color(feelingColor(dayValue)));
        canvas.drawCircle(selectedPoint.x, markerY, 4.2, marker);
        marker.setStyle(PaintStyle.Stroke);
        marker.setStrokeWidth(0.9);
        marker.setColor(Skia.Color(INK));
        canvas.drawCircle(selectedPoint.x, markerY, 4.2, marker);
      }
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
  graph,
  period,
}: {
  graph: Graph | null;
  period: FeelingPeriod;
}) {
  const [width, setWidth] = useState(GRAPH_WIDTH);
  const [selectedThoughtId, setSelectedThoughtId] = useState<string | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectionOpacity = useMemo(() => new NativeAnimated.Value(0), []);
  const thoughts = useMemo(() => feelingThoughtsFromGraph(graph), [graph]);
  const layout = useMemo(
    () => buildFeelingLayout(thoughts, period, width),
    [period, thoughts, width],
  );

  useEffect(() => {
    setSelectedThoughtId(null);
    setSelectedDate(null);
    selectionOpacity.setValue(0);
  }, [layout, selectionOpacity]);

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
    selectionOpacity.setValue(0);
    NativeAnimated.timing(selectionOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
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
    setSelectedDate(null);
    setSelectedThoughtId(closest?.id ?? null);
    if (closest) animateSelection();
  };

  const chooseDayAt = (x: number) => {
    if (
      x < FEELING_HORIZONTAL_PAD ||
      x > layout.width - FEELING_HORIZONTAL_PAD ||
      layout.flowPoints.length === 0
    ) {
      setSelectedDate(null);
      setSelectedThoughtId(null);
      return;
    }
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
    setSelectedThoughtId(null);
    setSelectedDate(closestDate);
    if (closestDate) animateSelection();
  };

  const swarmGesture = Gesture.Tap()
    .maxDistance(12)
    .onEnd(({ x, y }) => runOnJS(chooseThoughtAt)(x, y));
  const flowGesture = Gesture.Tap()
    .maxDistance(12)
    .onEnd(({ x }) => runOnJS(chooseDayAt)(x));

  const swarmPicture = useMemo(
    () => drawSwarm(layout, selectedThoughtId, selectedDate),
    [layout, selectedDate, selectedThoughtId],
  );
  const flowPicture = useMemo(
    () => drawFlow(layout, selectedDate),
    [layout, selectedDate],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    if (nextWidth > 0 && Math.abs(nextWidth - width) > 0.5) setWidth(nextWidth);
  };

  return (
    <View style={styles.root}>
      <View style={styles.content} onLayout={onLayout}>
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
              {layout.percentages.map((percentage, index) => (
                <Text
                  key={index}
                  style={[
                    styles.percentage,
                    {
                      color: feelingColor([-0.8, 0, 0.8][index]),
                      left: layout.percentageX[index] - 34,
                    },
                  ]}
                >
                  {percentage} %
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <NativeAnimated.View
          pointerEvents="none"
          style={[styles.selectionLine, { opacity: selectionOpacity }]}
        >
          {selectedThought ? (
            <Text style={styles.selectionPrimary} numberOfLines={2}>
              {selectedThought.title}
              {selectedThought.themeLabel ? (
                <Text style={styles.selectionSecondary}>
                  {`  ${selectedThought.themeLabel}`}
                </Text>
              ) : null}
            </Text>
          ) : selectedDate && selectedDay ? (
            <Text style={styles.selectionPrimary} numberOfLines={2}>
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
                uniforms={{ resolution: [width, 458] }}
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
    paddingTop: 34,
    paddingHorizontal: 22,
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
    top: FEELING_SWARM_HEIGHT - 16,
    width: 68,
    fontFamily: NOTE_SANS,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  selectionLine: {
    minHeight: 44,
    marginTop: 14,
    justifyContent: "flex-start",
  },
  selectionPrimary: {
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
  flowWrap: {
    height: FEELING_FLOW_HEIGHT,
    marginTop: 26,
    position: "relative",
  },
  flowCanvas: {
    height: FEELING_FLOW_HEIGHT,
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
