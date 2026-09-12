import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  type LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { type Href, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BlendMode,
  Canvas,
  createPicture,
  PaintStyle,
  Picture,
  Skia,
  TileMode,
  useFont,
  type SkFont,
} from "@shopify/react-native-skia";
import { InstrumentSans_400Regular } from "@expo-google-fonts/instrument-sans";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
  ThoughtLoading,
  noteCategoryColor,
} from "@/components/NoteUI";
import { type Graph, type GraphNode } from "@/lib/visualizations";
import { MEMORY_THEME } from "@/lib/memory-theme";

const W = 361;
const H = 560;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 5.2;
const FOCUS_Y = H * 0.235;
const LABEL_HEIGHT = 13;
const LABEL_MAX_WIDTH = 106;
const MIN_THEME_RADIUS = 14;
const SHEET_BOTTOM_INSET = 104;
const SHEET_CLOSE_DISTANCE = 32;
const SHEET_CLOSE_VELOCITY = 650;
const CAMERA_DURATION = 620;
const ROTATION_X = 0.0055;
const ROTATION_Y = 0.0045;
const ROTATION_TAIL_MS = 160;
const SOFT_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);
const GREY = "#969EA6";
const MAX_RETAINED_POSITIONS = 400;
const SEMANTIC_LAYOUT_RADIUS = 1.7;
const SEMANTIC_DEPTH_LIMIT = 0.55;
const TOPIC_DEPTH_SPAN = 185;
const PERSPECTIVE_DISTANCE = 520;
const LABEL_MARGIN_X = 10;
const LABEL_MARGIN_Y = 8;

type ThemeLayout = {
  id: string;
  label: string;
  fullTitle: string;
  description: string;
  color: string;
  sourceColor: string;
  emissionColor: string;
  highlightColor: string;
  shadowColor: string;
  status: string;
  proto: boolean;
  threshold: number;
  count: number;
  totalCount: number;
  lastActivity: number;
  cx: number;
  cy: number;
  cz: number;
  anchorX: number;
  anchorY: number;
  radius: number;
  tilt: number;
  eccentricity: number;
  labelWidth: number;
  labelHeight: number;
};

type ThoughtLayout = {
  id: string;
  nodeIndex: number;
  themeIndex: number;
  label: string;
  rho: number;
  theta: number;
  size: number;
  ageOpacity: number;
  depth: number;
  keywordPriority: number;
  keywordRank: number;
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

type GalaxyPeriod = "all" | "today" | "week" | "month";

const layoutCache = new Map<string, GalaxyLayout>();
const retainedPositions = new Map<string, { x: number; y: number }>();

function retainThemePosition(
  key: string,
  position: { x: number; y: number },
): void {
  retainedPositions.delete(key);
  retainedPositions.set(key, position);
  while (retainedPositions.size > MAX_RETAINED_POSITIONS) {
    const oldest = retainedPositions.keys().next().value;
    if (!oldest) break;
    retainedPositions.delete(oldest);
  }
}

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

function parseHexColor(color: string): [number, number, number] {
  const normalized = color.replace("#", "");
  return [0, 2, 4].map(
    (offset) => parseInt(normalized.slice(offset, offset + 2), 16) / 255,
  ) as [number, number, number];
}

function toLinearSrgb(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function fromLinearSrgb(value: number): number {
  const bounded = clamp(value, 0, 1);
  return bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * Math.pow(bounded, 1 / 2.4) - 0.055;
}

function linearColor(
  color: string,
  target: string | null,
  amount: number,
): string {
  const sourceChannels = parseHexColor(color).map(toLinearSrgb);
  const channels = target
    ? sourceChannels.map((source, index) => {
        const targetChannel = toLinearSrgb(parseHexColor(target)[index]);
        return source + (targetChannel - source) * amount;
      })
    : sourceChannels.map((source) => source * amount);
  return `#${channels
    .map((channel) =>
      Math.round(fromLinearSrgb(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function mutedTopicColor(color: string): string {
  const [r, g, b] = parseHexColor(color).map(toLinearSrgb);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(
        fromLinearSrgb((luminance + (channel - luminance) * 0.68) * 0.86) * 255,
      )
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function projectedDotRadius(size: number, magnification: number): number {
  "worklet";
  return clamp(size * magnification * 0.72, 1.5, 6.4);
}

// Smooth light profiles respond to the visible dot, without random variation.
function thoughtLight(
  radius: number,
  pointScale: number,
  brightness: number,
  clusterCount: number,
) {
  "worklet";
  // Radius is already projected. Normalize only the size weighting so the
  // same thought keeps its character across phone sizes and camera depths.
  const size = clamp((radius / Math.max(0.01, pointScale) - 1.5) / 4.9, 0, 1);
  const light = clamp(brightness / 0.92, 0, 1);
  const glowRadius = radius * (1.75 + 0.7 * size + 1.2 * light);
  const budget = clamp(
    0.95 / Math.sqrt(Math.max(1, clusterCount / 24)),
    0.3,
    0.85,
  );
  return {
    glowRadius,
    auraRadius: glowRadius * (1.12 + 0.1 * size),
    glowAlpha: clamp(budget * brightness * (0.65 + 0.55 * size), 0, 0.9),
    auraAlpha: 0.012 * brightness * (0.65 + 0.6 * size),
  };
}

function graphViewport(width: number, height: number, bottomInset = 104) {
  "worklet";
  const availableHeight = Math.max(1, height - bottomInset - 20);
  // Uniform projection: text, circles, hit boxes and gestures share one scale.
  const scale = Math.max(0.01, Math.min(width / W, availableHeight / H));
  return {
    scale,
    x: (width - W * scale) / 2,
    y: 12 + (availableHeight - H * scale) / 2,
  };
}

// Inverse camera rotation on the focal plane for two-finger zoom and pan.
function screenPlaneOffset(x: number, y: number, yaw: number, pitch: number) {
  "worklet";
  return {
    x: x * Math.cos(yaw) + y * Math.sin(pitch) * Math.sin(yaw),
    y: y * Math.cos(pitch),
    z: x * Math.sin(yaw) - y * Math.sin(pitch) * Math.cos(yaw),
  };
}

function fallbackShortLabel(title: string): string {
  const normalized = title.trim().replace(/\s+/g, " ");
  if (!normalized) return "Thema";
  const first = normalized.split(" ")[0];
  if (first.toLocaleLowerCase("de-DE").includes("thought")) return "thoughts";
  const head = normalized.split(/[,;:/–—]|\sund\s/i)[0];
  const titleWords = head.split(" ").filter(Boolean);
  const words = titleWords.slice(0, titleWords[1] === "&" ? 3 : 2);
  const label = words.join(" ") || first;
  const hyphenParts = label.split("-").filter(Boolean);
  if (hyphenParts.length > 1) {
    return `${hyphenParts[0]}\n${hyphenParts.slice(1).join("-")}`;
  }
  if (words.length === 2 && estimatedLabelWidth(label) > LABEL_MAX_WIDTH) {
    return words.join("\n");
  }
  return label;
}

function estimatedLabelWidth(label: string): number {
  let width = 0;
  for (const character of label) {
    if (/[MWÄÖÜmw]/.test(character)) width += 9;
    else if (/[ilIjtfr1]/.test(character)) width += 4;
    else if (/\s/.test(character)) width += 3.5;
    else width += 7;
  }
  return Math.max(28, width);
}

function labelMetrics(label: string): { width: number; height: number } {
  const lines = label.split("\n");
  return {
    width: Math.min(
      LABEL_MAX_WIDTH,
      Math.max(...lines.map(estimatedLabelWidth)) + 14,
    ),
    height: lines.length * LABEL_HEIGHT,
  };
}

function fitThemeLabels(result: GalaxyLayout, themeFont: SkFont): GalaxyLayout {
  return {
    ...result,
    themes: result.themes.map((theme) => {
      const lines = theme.label.split("\n").map((line) => {
        if (themeFont.getTextWidth(line) <= LABEL_MAX_WIDTH - 8) return line;
        let shortened = line;
        while (
          shortened.length > 1 &&
          themeFont.getTextWidth(`${shortened}…`) > LABEL_MAX_WIDTH - 8
        )
          shortened = shortened.slice(0, -1);
        return `${shortened.trimEnd()}…`;
      });
      return {
        ...theme,
        label: lines.join("\n"),
        labelWidth:
          Math.max(...lines.map((line) => themeFont.getTextWidth(line))) + 8,
      };
    }),
  };
}

function nodeTimestamp(node: GraphNode): number {
  const timestamp = Date.parse(node.capturedAt || node.date);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function thoughtRadius(node: GraphNode, graph: Graph): number {
  const components: number[] = [];
  if (node.wordCount > 0 && (graph.meta.medianWordCount ?? 0) > 0) {
    components.push(node.wordCount / (graph.meta.medianWordCount ?? 1));
  }
  if (
    (node.durationSeconds ?? 0) > 0 &&
    (graph.meta.medianDurationSeconds ?? 0) > 0
  ) {
    components.push(
      (node.durationSeconds ?? 0) / (graph.meta.medianDurationSeconds ?? 1),
    );
  }
  if (components.length === 0) return 4.4;
  const relative =
    components.reduce((total, value) => total + value, 0) / components.length;
  // Radius follows the square root of the mean normalized duration / word count,
  // so visual area carries the importance without letting outliers dominate.
  return clamp(2.1 + 2.3 * Math.sqrt(relative), 2.1, 7.2);
}

function thoughtAgeOpacity(node: GraphNode): number {
  const timestamp = nodeTimestamp(node);
  if (timestamp <= 0) return 0.4;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return 0.26 + 0.66 * Math.pow(2, -ageDays / 45);
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
  "worklet";
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

function buildGalaxyLayout(graph: Graph, period: GalaxyPeriod): GalaxyLayout {
  const signature = JSON.stringify({
    layoutVersion: 12,
    asOfDay: Math.floor(Date.now() / 86_400_000),
    period,
    topics: graph.clusters,
    nodes: graph.nodes,
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
    const visible = visibleByTheme.get(node.cluster) ?? [];
    visible.push(node);
    visibleByTheme.set(node.cluster, visible);
  }
  for (const values of visibleByTheme.values()) {
    values.sort((left, right) => nodeTimestamp(right) - nodeTimestamp(left));
  }

  const materializedClusters = graph.clusters.filter((cluster) =>
    allByTheme.has(cluster.id),
  );
  const themeCount = materializedClusters.length;
  const radiusFactor = clamp(Math.sqrt(6 / Math.max(1, themeCount)), 0.68, 1);
  const hasRetainedPosition = materializedClusters.some((cluster) =>
    retainedPositions.has(`${period}:${cluster.id}`),
  );
  const themes: ThemeLayout[] = materializedClusters.map((cluster, index) => {
    const visible = visibleByTheme.get(cluster.id) ?? [];
    const all = allByTheme.get(cluster.id) ?? [];
    const random = randomFrom(cluster.id);
    const retained = retainedPositions.get(`${period}:${cluster.id}`);
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
    const label = fallbackShortLabel(cluster.label);
    const metrics = labelMetrics(label);
    // Preserve stored colors for the unlit review; production reduces chroma
    // and luminance uniformly, without replacing a topic's hue or identity.
    const color = mutedTopicColor(cluster.color);
    return {
      id: cluster.id,
      label,
      fullTitle: cluster.fullTitle || cluster.label,
      description: cluster.description,
      color,
      sourceColor: cluster.color,
      emissionColor: linearColor(color, "#FFFFFF", 0.38),
      highlightColor: linearColor(color, "#FFFFFF", 0.085),
      shadowColor: linearColor(color, null, 0.88),
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
      cz: 0,
      anchorX: cluster.anchorX,
      anchorY: cluster.anchorY,
      radius: Math.max(
        MIN_THEME_RADIUS,
        4.1 * Math.pow(visible.length, 0.75) * radiusFactor,
      ),
      tilt: random() * Math.PI,
      eccentricity: 0.6 + random() * 0.22,
      labelWidth: metrics.width,
      labelHeight: metrics.height,
    };
  });
  for (const theme of themes) {
    if (theme.proto)
      theme.radius = Math.max(MIN_THEME_RADIUS, 26 * radiusFactor);
  }

  const depthOrder = [...themes].sort(
    (left, right) => seedFrom(left.id) - seedFrom(right.id),
  );
  for (let index = 0; index < depthOrder.length; index += 1) {
    depthOrder[index].cz =
      depthOrder.length <= 1
        ? 0
        : (index / (depthOrder.length - 1) - 0.5) * TOPIC_DEPTH_SPAN;
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
      theme.cy = H * 0.46 + (theme.cy - centerY) * fit;
      theme.radius = Math.max(MIN_THEME_RADIUS, theme.radius * fit);
      retainThemePosition(`${period}:${theme.id}`, {
        x: theme.cx,
        y: theme.cy,
      });
    }
  }

  const themeIndexById = new Map(
    themes.map((theme, index) => [theme.id, index]),
  );
  const thoughts: ThoughtLayout[] = [];
  for (const theme of themes) {
    const themeIndex = themeIndexById.get(theme.id) ?? -1;
    const visible = visibleByTheme.get(theme.id) ?? [];
    for (let index = 0; index < visible.length; index += 1) {
      const node = visible[index];
      const localX = node.x - theme.anchorX;
      const localY = node.y - theme.anchorY;
      const radius = thoughtRadius(node, graph);
      const ageOpacity = thoughtAgeOpacity(node);
      thoughts.push({
        id: node.id,
        nodeIndex: node.idx,
        themeIndex,
        label: thoughtShortLabel(node),
        rho: clamp(
          Math.hypot(localX, localY) / SEMANTIC_LAYOUT_RADIUS,
          visible.length > 1 ? 0.16 : 0.05,
          1,
        ),
        theta: Math.atan2(localY, localX),
        size: radius,
        ageOpacity,
        depth:
          Math.abs(node.z) > 0.0001
            ? clamp(node.z / SEMANTIC_DEPTH_LIMIT, -1, 1)
            : randomFrom(`depth:${node.id}`)() * 2 - 1,
        keywordPriority:
          0.52 * ((radius - 2.1) / 5.1) + 0.48 * ((ageOpacity - 0.26) / 0.66),
        keywordRank: 0,
      });
    }
  }
  for (let themeIndex = 0; themeIndex < themes.length; themeIndex += 1) {
    const ranked = thoughts
      .map((thought, index) => ({ thought, index }))
      .filter(({ thought }) => thought.themeIndex === themeIndex)
      .sort(
        (left, right) =>
          right.thought.keywordPriority - left.thought.keywordPriority ||
          left.thought.id.localeCompare(right.thought.id),
      );
    ranked.forEach(({ index }, rank) => {
      thoughts[index].keywordRank = rank;
    });
  }

  const dust: DustLayout[] = [];
  const unassignedCount =
    period === "all"
      ? Math.max(
          graph.meta.pendingThoughts,
          graph.meta.sourceCount - graph.meta.assignedCount,
        )
      : 0;
  const dustRandom = randomFrom(
    `dust:${graph.meta.sourceCount}:${graph.meta.assignedCount}`,
  );
  for (
    let attempt = 0;
    dust.length < unassignedCount && attempt < 1000;
    attempt += 1
  ) {
    const x = 18 + dustRandom() * (W - 36);
    const y = 28 + dustRandom() * (H - 68);
    const clearsThemes = themes.every(
      (theme) =>
        Math.hypot(theme.cx - x, theme.cy - y) > theme.radius * 1.25 + 16,
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
): { x: number; y: number; z: number } {
  "worklet";
  const radius = thought.rho * theme.radius * (1.24 + 1.16 * drill);
  const eccentricity = theme.eccentricity + (0.9 - theme.eccentricity) * drill;
  const ex = Math.cos(thought.theta) * radius;
  const ey = Math.sin(thought.theta) * radius * eccentricity;
  return {
    x: theme.cx + ex * Math.cos(theme.tilt) - ey * Math.sin(theme.tilt),
    y: theme.cy + ex * Math.sin(theme.tilt) + ey * Math.cos(theme.tilt),
    z: theme.cz + thought.depth * theme.radius * (0.92 + 0.68 * drill),
  };
}

function focusedThemeOffset(
  theme: ThemeLayout,
  focusedTheme: ThemeLayout | null,
  drill: number,
): { x: number; y: number } {
  "worklet";
  if (!focusedTheme || theme.id === focusedTheme.id || drill <= 0) {
    return { x: 0, y: 0 };
  }
  let dx = theme.cx - focusedTheme.cx;
  let dy = theme.cy - focusedTheme.cy;
  let distance = Math.hypot(dx, dy);
  if (distance < 0.001) {
    dx = 1;
    dy = 0;
    distance = 1;
  }
  const shift = 78 * drill;
  return { x: (dx / distance) * shift, y: (dy / distance) * shift };
}

function projectPoint(
  x: number,
  y: number,
  z: number,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  zoom: number,
  yaw: number,
  pitch: number,
  focusProgress: number,
): { x: number; y: number; depth: number; magnification: number } {
  "worklet";
  const dx = x - cameraX;
  const dy = y - cameraY;
  const dz = z - cameraZ;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const rotatedX = dx * cosYaw + dz * sinYaw;
  const yawDepth = -dx * sinYaw + dz * cosYaw;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const rotatedY = dy * cosPitch - yawDepth * sinPitch;
  const depth = dy * sinPitch + yawDepth * cosPitch;
  const magnification =
    PERSPECTIVE_DISTANCE / Math.max(160, PERSPECTIVE_DISTANCE + depth);
  return {
    x: W / 2 + rotatedX * zoom * magnification,
    y:
      H / 2 +
      (FOCUS_Y - H / 2) * focusProgress +
      rotatedY * zoom * magnification,
    depth,
    magnification,
  };
}

function fitOverviewCamera(layout: GalaxyLayout) {
  const points = layout.thoughts.map((thought) =>
    worldPoint(thought, layout.themes[thought.themeIndex], 0),
  );
  // Unassigned thoughts are also real marks and must fit on entry.
  points.push(
    ...layout.dust.map((point) => ({ x: point.x, y: point.y, z: 0 })),
  );
  if (!points.length) return { x: W / 2, y: H / 2, z: 0, zoom: 1 };
  let x =
    (Math.min(...points.map((p) => p.x)) +
      Math.max(...points.map((p) => p.x))) /
    2;
  let y =
    (Math.min(...points.map((p) => p.y)) +
      Math.max(...points.map((p) => p.y))) /
    2;
  const z =
    (Math.min(...points.map((p) => p.z)) +
      Math.max(...points.map((p) => p.z))) /
    2;
  // Center the projected cloud, not the average of arbitrarily sized topics.
  for (let iteration = 0; iteration < 4; iteration++) {
    const projected = points.map((p) =>
      projectPoint(p.x, p.y, p.z, x, y, z, 1, 0, 0.06, 0),
    );
    const dx =
      (Math.min(...projected.map((p) => p.x)) +
        Math.max(...projected.map((p) => p.x))) /
        2 -
      W / 2;
    const dy =
      (Math.min(...projected.map((p) => p.y)) +
        Math.max(...projected.map((p) => p.y))) /
        2 -
      H / 2;
    const shift = screenPlaneOffset(dx, dy, 0, 0.06);
    x += shift.x;
    y += shift.y;
  }
  let halfWidth = 1;
  let halfHeight = 1;
  // Reserve room for a moderate inspection orbit as well as the initial pose.
  for (const yaw of [-0.65, 0, 0.65])
    for (const pitch of [-0.2, 0.06, 0.25]) {
      for (const point of points) {
        const p = projectPoint(
          point.x,
          point.y,
          point.z,
          x,
          y,
          z,
          1,
          yaw,
          pitch,
          0,
        );
        halfWidth = Math.max(halfWidth, Math.abs(p.x - W / 2));
        halfHeight = Math.max(halfHeight, Math.abs(p.y - H / 2));
      }
    }
  return {
    x,
    y,
    z,
    zoom: Math.min(1, (W / 2 - 28) / halfWidth, (H / 2 - 32) / halfHeight),
  };
}

type ProjectedThemeLabel = {
  themeIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

function projectedThemeLabels(
  themes: ThemeLayout[],
  thoughts: ThoughtLayout[],
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  zoom: number,
  yaw: number,
  pitch: number,
  drill = 0,
  selectedIndex = -1,
): ProjectedThemeLabel[] {
  "worklet";
  const focusedTheme = themes[selectedIndex] ?? null;
  // Use the same world positions, camera and dot radii as the renderer.
  // Provisional themes also obstruct labels, even without a label of their own.
  const points = thoughts.map((thought) => {
    const theme = themes[thought.themeIndex];
    const offset = focusedThemeOffset(theme, focusedTheme, drill);
    const world = worldPoint(
      thought,
      theme,
      thought.themeIndex === selectedIndex ? drill : 0,
    );
    const point = projectPoint(
      world.x + offset.x,
      world.y + offset.y,
      world.z,
      cameraX,
      cameraY,
      cameraZ,
      zoom,
      yaw,
      pitch,
      drill,
    );
    return {
      ...point,
      themeIndex: thought.themeIndex,
      radius: projectedDotRadius(thought.size, point.magnification),
    };
  });
  const projected = themes
    .map((theme, themeIndex) => ({
      theme,
      themeIndex,
      points: points.filter((point) => point.themeIndex === themeIndex),
    }))
    .filter(({ theme, points }) => !theme.proto && points.length > 0)
    .sort(
      (a, b) =>
        b.theme.totalCount - a.theme.totalCount ||
        a.theme.id.localeCompare(b.theme.id),
    );
  const maxLabels = zoom < 0.9 ? 5 : zoom < 1.25 ? 7 : 9;
  const placed: ProjectedThemeLabel[] = [];
  for (const item of projected) {
    if (placed.length >= maxLabels) break;
    const { theme, themeIndex, points: own } = item;
    const width = theme.labelWidth;
    const height = theme.labelHeight;
    const left = own.reduce((a, b) =>
      a.x - a.radius < b.x - b.radius ? a : b,
    );
    const right = own.reduce((a, b) =>
      a.x + a.radius > b.x + b.radius ? a : b,
    );
    const top = own.reduce((a, b) => (a.y - a.radius < b.y - b.radius ? a : b));
    const bottom = own.reduce((a, b) =>
      a.y + a.radius > b.y + b.radius ? a : b,
    );
    const candidates = [
      { x: bottom.x, y: bottom.y + bottom.radius + 7 + height / 2 },
      { x: top.x, y: top.y - top.radius - 7 - height / 2 },
      { x: right.x + right.radius + 7 + width / 2, y: right.y },
      { x: left.x - left.radius - 7 - width / 2, y: left.y },
    ];
    for (const candidate of candidates) {
      const rect = {
        x: candidate.x - width / 2,
        y: candidate.y - height / 2,
        width,
        height,
      };
      if (
        rect.x < LABEL_MARGIN_X ||
        rect.x + width > W - LABEL_MARGIN_X ||
        rect.y < LABEL_MARGIN_Y ||
        rect.y + height > H - LABEL_MARGIN_Y
      )
        continue;
      if (
        placed.some((other) =>
          overlaps(rect, {
            x: other.x - other.width / 2 - 4,
            y: other.y - other.height / 2 - 3,
            width: other.width + 8,
            height: other.height + 6,
          }),
        )
      )
        continue;
      let ownDistance = Infinity;
      let foreignDistance = Infinity;
      for (const point of points) {
        const dx = Math.max(rect.x - point.x, 0, point.x - rect.x - width);
        const dy = Math.max(rect.y - point.y, 0, point.y - rect.y - height);
        const distance = Math.hypot(dx, dy) - point.radius;
        if (point.themeIndex === themeIndex)
          ownDistance = Math.min(ownDistance, distance);
        else foreignDistance = Math.min(foreignDistance, distance);
      }
      // Free space is insufficient: the entire label must be unambiguously
      // closer to its own points and must not cover any dot.
      if (
        ownDistance < 4 ||
        ownDistance > 12 ||
        foreignDistance < ownDistance + 6
      )
        continue;
      placed.push({ themeIndex, ...candidate, width, height });
      break;
    }
  }
  return placed;
}

function thoughtShortLabel(node: GraphNode): string {
  const source = (node.keyword || node.title).trim().replace(/\s+/g, " ");
  if (!source) return "Gedanke";
  const head = source.split(/[,;:–—]|\s(?:und|oder|sowie)\s/i)[0];
  const words = head.split(" ").filter(Boolean).slice(0, 3);
  let label = words.join(" ");
  if (label.length > 22) {
    label = words.slice(0, 2).join(" ");
  }
  return label.length > 22 ? `${label.slice(0, 21)}…` : label;
}

type GraphCamera = {
  x: number;
  y: number;
  z: number;
  zoom: number;
  yaw: number;
  pitch: number;
  drill: number;
  themeIndex: number;
  thoughtIndex: number;
};
type ThoughtLabel = {
  nodeIndex: number;
  themeIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
};

function graphLabelLayout(
  layout: GalaxyLayout,
  graph: Graph | null,
  thoughtFont: SkFont | null,
  period: GalaxyPeriod,
  camera: GraphCamera,
  thoughtLayoutIndexByNodeIndex: number[],
): { themes: ProjectedThemeLabel[]; thoughts: ThoughtLabel[] } {
  "worklet";
  const themes =
    period === "today" || camera.drill >= 0.98
      ? []
      : projectedThemeLabels(
          layout.themes,
          layout.thoughts,
          camera.x,
          camera.y,
          camera.z,
          camera.zoom,
          camera.yaw,
          camera.pitch,
          camera.drill,
          camera.themeIndex,
        );
  const placedTextRects = themes.map((label) => ({
    x: label.x - label.width / 2,
    y: label.y - label.height / 2,
    width: label.width,
    height: label.height,
  }));
  const focusedTheme = layout.themes[camera.themeIndex] ?? null;
  const drawingOrder = layout.thoughts.map((thought) => {
    const theme = layout.themes[thought.themeIndex];
    const offset = focusedThemeOffset(theme, focusedTheme, camera.drill);
    const world = worldPoint(
      thought,
      theme,
      thought.themeIndex === camera.themeIndex ? camera.drill : 0,
    );
    const screen = projectPoint(
      world.x + offset.x,
      world.y + offset.y,
      world.z,
      camera.x,
      camera.y,
      camera.z,
      camera.zoom,
      camera.yaw,
      camera.pitch,
      camera.drill,
    );
    return {
      ...screen,
      radius: projectedDotRadius(thought.size, screen.magnification),
    };
  });
  const labels: ThoughtLabel[] = [];
  if (thoughtFont && period !== "today") {
    const overviewLabelProgress = clamp((camera.zoom - 2.35) / 0.9, 0, 1);
    const focusLabelProgress =
      0.68 + 0.32 * clamp((camera.zoom - 1) / 0.65, 0, 1);
    const labelCap =
      camera.zoom < 2 ? 2 : camera.zoom < 3 ? 3 : camera.zoom < 4.5 ? 4 : 6;
    const selectedLabels: number[] = [];
    if (camera.thoughtIndex >= 0) {
      selectedLabels.push(camera.thoughtIndex);
      const related: { index: number; weight: number }[] = [];
      if (graph) {
        for (const edge of graph.edges) {
          const sourceIndex = thoughtLayoutIndexByNodeIndex[edge.source];
          const targetIndex = thoughtLayoutIndexByNodeIndex[edge.target];
          if (sourceIndex === camera.thoughtIndex && targetIndex >= 0) {
            related.push({ index: targetIndex, weight: edge.weight });
          } else if (targetIndex === camera.thoughtIndex && sourceIndex >= 0) {
            related.push({ index: sourceIndex, weight: edge.weight });
          }
        }
      }
      related
        .sort(
          (left, right) =>
            right.weight - left.weight || left.index - right.index,
        )
        .slice(0, 2)
        .forEach(({ index }) => selectedLabels.push(index));
    }
    for (let index = 0; index < layout.thoughts.length; index += 1) {
      const thought = layout.thoughts[index];
      const theme = layout.themes[thought.themeIndex];
      if (!theme) continue;
      const focused = camera.themeIndex === thought.themeIndex;
      if (camera.themeIndex >= 0 && !focused) continue;
      if (
        camera.thoughtIndex >= 0
          ? !selectedLabels.includes(index)
          : thought.keywordRank >= labelCap
      ) {
        continue;
      }
      const labelProgress =
        camera.themeIndex >= 0
          ? focusLabelProgress * camera.drill
          : overviewLabelProgress;
      if (labelProgress <= 0.01) continue;
      const f = focused ? camera.drill : 0;
      const offset = focusedThemeOffset(theme, focusedTheme, camera.drill);
      const world = worldPoint(thought, theme, f);
      const screen = projectPoint(
        world.x + offset.x,
        world.y + offset.y,
        world.z,
        camera.x,
        camera.y,
        camera.z,
        camera.zoom,
        camera.yaw,
        camera.pitch,
        camera.drill,
      );
      const width = thoughtFont.getTextWidth(thought.label);
      const dotRadius = projectedDotRadius(thought.size, screen.magnification);
      const dotGap = dotRadius + 6;
      const candidates = [
        { x: screen.x + dotGap, y: screen.y + 3.2 },
        { x: screen.x - width - dotGap, y: screen.y + 3.2 },
        { x: screen.x - width / 2, y: screen.y - dotRadius - 6 },
        { x: screen.x - width / 2, y: screen.y + dotRadius + 14 },
      ];
      let position: { x: number; y: number } | null = null;
      for (const candidate of candidates) {
        const rect = {
          x: candidate.x - 2,
          y: candidate.y - 10,
          width: width + 4,
          height: 13,
        };
        if (
          rect.x < 7 ||
          rect.x + rect.width > W - 7 ||
          rect.y < 7 ||
          rect.y + rect.height > H - 7 ||
          placedTextRects.some((placed) => overlaps(rect, placed)) ||
          drawingOrder.some((point) => {
            const dx = Math.max(
              rect.x - point.x,
              0,
              point.x - rect.x - rect.width,
            );
            const dy = Math.max(
              rect.y - point.y,
              0,
              point.y - rect.y - rect.height,
            );
            return Math.hypot(dx, dy) < point.radius + 3;
          })
        ) {
          continue;
        }
        position = candidate;
        placedTextRects.push(rect);
        break;
      }
      if (!position) continue;
      labels.push({
        nodeIndex: thought.nodeIndex,
        themeIndex: thought.themeIndex,
        text: thought.label,
        x: position.x,
        y: position.y,
        width,
        height: 13,
        alpha: 0.68 * labelProgress,
      });
    }
  }

  return { themes, thoughts: labels };
}

function hitThoughtLabel(labels: ThoughtLabel[], x: number, y: number): number {
  "worklet";
  // First honor the actual text rectangles. Only then apply a small touch
  // allowance, choosing the nearest rectangle if allowances overlap.
  for (const padding of [0, 5]) {
    let best = -1;
    let distance = Infinity;
    for (const label of labels) {
      if (label.alpha < 0.12) continue;
      const dx = Math.max(label.x - x, 0, x - label.x - label.width);
      const dy = Math.max(label.y - 10 - y, 0, y - label.y - 3);
      if (dx > padding || dy > padding) continue;
      const candidate = Math.hypot(dx, dy);
      if (candidate < distance) {
        best = label.nodeIndex;
        distance = candidate;
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

function nodeDateKey(node: GraphNode): string {
  return node.date || node.capturedAt.slice(0, 10);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

function TopicDensityTimeline({
  color,
  nodes,
}: {
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
    for (
      const cursor = new Date(start);
      cursor <= today;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      days.push(localDateKey(cursor));
    }

    const countsByDay = new Map<string, number>();
    for (const node of nodes) {
      const key = nodeDateKey(node);
      countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
    }
    const bucketSize = Math.max(1, Math.ceil(days.length / 180));
    const buckets: number[] = [];
    for (let index = 0; index < days.length; index += bucketSize) {
      let count = 0;
      for (let offset = 0; offset < bucketSize; offset += 1) {
        const day = days[index + offset];
        if (!day) break;
        count += countsByDay.get(day) ?? 0;
      }
      buckets.push(count);
    }

    const months: { key: string; label: string; days: number }[] = [];
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
        Math.round((visibleEnd.getTime() - monthStart.getTime()) / 86_400_000) +
          (nextMonth > today ? 1 : 0),
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
  }, [nodes]);

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
        <TopicDensityTimeline color={theme.color} nodes={nodes} />
      </Animated.View>
    </GestureDetector>
  );
}

function ThoughtSheet({
  node,
  onClose,
  onOpenDetail,
  sheetY,
}: {
  node: GraphNode;
  onClose: () => void;
  onOpenDetail: () => void;
  sheetY: SharedValue<number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapseOrClose = () => {
    if (expanded) setExpanded(false);
    else onClose();
  };
  const pan = Gesture.Pan()
    .onChange((event) => {
      sheetY.value = clamp(sheetY.value + event.changeY * 0.5, -30, 120);
    })
    .onEnd((event) => {
      const expand = sheetY.value < -14 || event.velocityY < -650;
      const close =
        sheetY.value > SHEET_CLOSE_DISTANCE ||
        event.velocityY > SHEET_CLOSE_VELOCITY;
      sheetY.value = withTiming(0, {
        duration: 160,
        easing: Easing.out(Easing.quad),
      });
      if (expand) runOnJS(setExpanded)(true);
      else if (close) runOnJS(collapseOrClose)();
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetY.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[styles.sheet, style, expanded && styles.expandedSheet]}
      >
        <View style={styles.handle} />
        <View style={styles.thoughtHeader}>
          <View style={styles.thoughtTypeRow}>
            <View
              style={[
                styles.thoughtTypeDot,
                { backgroundColor: noteCategoryColor(node.type) },
              ]}
            />
            <Text style={styles.thoughtTypeLabel}>{node.type}</Text>
          </View>
          {thoughtDateLabel(node) ? (
            <Text style={styles.thoughtDate}>{thoughtDateLabel(node)}</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityLabel="Vollständigen Thought öffnen"
          accessibilityRole="button"
          onPress={onOpenDetail}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Text style={styles.thoughtTitle}>{node.title}</Text>
          {expanded ? (
            <ScrollView
              contentContainerStyle={styles.thoughtBodyScrollContent}
              showsVerticalScrollIndicator={false}
              style={styles.thoughtBodyScroll}
            >
              <Text style={styles.thoughtBody}>
                {node.summary || node.subtitle}
              </Text>
            </ScrollView>
          ) : (
            <Text numberOfLines={4} style={styles.thoughtBody}>
              {node.summary || node.subtitle}
            </Text>
          )}
        </Pressable>
        <Pressable
          accessibilityLabel="Vollständigen Thought öffnen"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onOpenDetail}
          style={({ pressed }) => [
            styles.thoughtDetailButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.thoughtDetailButtonText}>Details öffnen →</Text>
        </Pressable>
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
  graph,
  onRetry,
  period,
  status,
  renderingStage = "glow",
}: {
  graph: Graph | null;
  onRetry: () => void;
  period: GalaxyPeriod;
  status: "loading" | "error" | "ready";
  /** Review stages share layout, dot size and camera. Production uses glow. */
  renderingStage?: "colors" | "matte" | "glow";
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const thoughtFont = useFont(InstrumentSans_400Regular, 9);
  const themeFont = useFont(InstrumentSans_400Regular, 11);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [selectedProtoId, setSelectedProtoId] = useState<string | null>(null);
  const [selectedThoughtNodeIndex, setSelectedThoughtNodeIndex] = useState<
    number | null
  >(null);
  const themeClosingRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thoughtCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const protoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(() => {
    if (!graph)
      return {
        themes: [],
        thoughts: [],
        dust: [],
        similarities: [],
        signature: "empty",
      } satisfies GalaxyLayout;
    const result = buildGalaxyLayout(graph, period);
    if (!themeFont) return result;
    return fitThemeLabels(result, themeFont);
  }, [graph, period, themeFont]);
  const thoughtLayoutIndexByNodeIndex = useMemo(() => {
    const result = new Array(graph?.nodes.length ?? 0).fill(-1);
    layout.thoughts.forEach((thought, index) => {
      result[thought.nodeIndex] = index;
    });
    return result;
  }, [graph?.nodes.length, layout.thoughts]);
  const selectedThemeIndex = layout.themes.findIndex(
    (theme) => theme.id === selectedThemeId,
  );
  const selectedTheme =
    selectedThemeIndex >= 0 ? layout.themes[selectedThemeIndex] : null;
  const selectedProto =
    layout.themes.find((theme) => theme.id === selectedProtoId) ?? null;
  const selectedThought =
    selectedThoughtNodeIndex == null
      ? null
      : (graph?.nodes[selectedThoughtNodeIndex] ?? null);
  const selectedNodes = selectedTheme
    ? (graph?.nodes.filter((node) => node.cluster === selectedTheme.id) ?? [])
    : [];
  const protoNodes = selectedProto
    ? (graph?.nodes.filter((node) => node.cluster === selectedProto.id) ?? [])
    : [];

  const overviewCamera = useMemo(() => fitOverviewCamera(layout), [layout]);
  const viewport = graphViewport(
    size.width,
    size.height,
    Math.max(104, insets.bottom + 86),
  );
  const cameraX = useSharedValue(overviewCamera.x);
  const cameraY = useSharedValue(overviewCamera.y);
  const cameraZ = useSharedValue(overviewCamera.z);
  const yaw = useSharedValue(0);
  const pitch = useSharedValue(0.06);
  const zoom = useSharedValue(overviewCamera.zoom);
  const drill = useSharedValue(0);
  const selectedThemeIndexSV = useSharedValue(-1);
  const selectedThoughtIndexSV = useSharedValue(-1);
  const thoughtSelectionProgress = useSharedValue(0);
  const panOrigin = useSharedValue({
    touchX: 0,
    touchY: 0,
  });
  const pinchActive = useSharedValue(false);
  const pinchStartZoom = useSharedValue(1);
  const pinchAnchor = useSharedValue({ x: W / 2, y: H / 2, z: 0 });
  const sheetY = useSharedValue(0);
  const scaleX = viewport.scale;
  const scaleY = viewport.scale;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!selectedThemeId) return;
    if (selectedThemeIndex < 0) {
      setSelectedThemeId(null);
      setSelectedThoughtNodeIndex(null);
      themeClosingRef.current = false;
      selectedThemeIndexSV.value = -1;
      selectedThoughtIndexSV.value = -1;
      thoughtSelectionProgress.value = 0;
      drill.value = 0;
      return;
    }
    // A refreshed graph may reorder its themes while preserving their IDs.
    // Keep the worklet index aligned with the ID-based React selection.
    selectedThemeIndexSV.value = selectedThemeIndex;
  }, [
    drill,
    selectedThemeId,
    selectedThemeIndex,
    selectedThemeIndexSV,
    selectedThoughtIndexSV,
    thoughtSelectionProgress,
  ]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (thoughtCloseTimerRef.current) {
        clearTimeout(thoughtCloseTimerRef.current);
      }
      if (protoCloseTimerRef.current) clearTimeout(protoCloseTimerRef.current);
    },
    [],
  );

  const resetCamera = useCallback(() => {
    const duration = reduceMotion ? 0 : CAMERA_DURATION;
    yaw.value = withTiming(0, { duration, easing: SOFT_EASING });
    pitch.value = withTiming(0.06, { duration, easing: SOFT_EASING });
    cameraX.value = withTiming(overviewCamera.x, {
      duration,
      easing: SOFT_EASING,
    });
    cameraY.value = withTiming(overviewCamera.y, {
      duration,
      easing: SOFT_EASING,
    });
    cameraZ.value = withTiming(overviewCamera.z, {
      duration,
      easing: SOFT_EASING,
    });
    zoom.value = withTiming(overviewCamera.zoom, {
      duration,
      easing: SOFT_EASING,
    });
  }, [
    cameraX,
    cameraY,
    cameraZ,
    reduceMotion,
    zoom,
    overviewCamera,
    yaw,
    pitch,
  ]);

  const fittedPeriodRef = useRef<string | null>(null);
  useEffect(() => {
    if (layout.thoughts.length === 0 || fittedPeriodRef.current === period)
      return;
    fittedPeriodRef.current = period;
    for (const timer of [
      closeTimerRef,
      thoughtCloseTimerRef,
      protoCloseTimerRef,
    ]) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
    for (const value of [
      cameraX,
      cameraY,
      cameraZ,
      zoom,
      yaw,
      pitch,
      drill,
      sheetY,
    ])
      cancelAnimation(value);
    setSelectedThemeId(null);
    setSelectedProtoId(null);
    setSelectedThoughtNodeIndex(null);
    themeClosingRef.current = false;
    selectedThemeIndexSV.value = -1;
    selectedThoughtIndexSV.value = -1;
    thoughtSelectionProgress.value = 0;
    drill.value = 0;
    sheetY.value = 0;
    cameraX.value = overviewCamera.x;
    cameraY.value = overviewCamera.y;
    cameraZ.value = overviewCamera.z;
    zoom.value = overviewCamera.zoom;
    yaw.value = 0;
    pitch.value = 0.06;
  }, [
    layout.thoughts.length,
    period,
    overviewCamera,
    cameraX,
    cameraY,
    cameraZ,
    zoom,
    yaw,
    pitch,
    drill,
    sheetY,
    selectedThemeIndexSV,
    selectedThoughtIndexSV,
    thoughtSelectionProgress,
  ]);

  const closeTheme = useCallback(() => {
    if (themeClosingRef.current) return;
    themeClosingRef.current = true;
    cancelAnimation(cameraX);
    cancelAnimation(cameraY);
    cancelAnimation(cameraZ);
    cancelAnimation(zoom);
    cancelAnimation(drill);
    cancelAnimation(sheetY);
    setSelectedThoughtNodeIndex(null);
    thoughtSelectionProgress.value = withTiming(0, { duration: 260 });
    sheetY.value = withTiming(420, {
      duration: 280,
      easing: Easing.in(Easing.cubic),
    });
    drill.value = withTiming(0, {
      duration: CAMERA_DURATION,
      easing: SOFT_EASING,
    });
    resetCamera();
    closeTimerRef.current = setTimeout(() => {
      selectedThoughtIndexSV.value = -1;
      selectedThemeIndexSV.value = -1;
      setSelectedThemeId(null);
      themeClosingRef.current = false;
      closeTimerRef.current = null;
    }, CAMERA_DURATION);
  }, [
    cameraX,
    cameraY,
    cameraZ,
    drill,
    resetCamera,
    selectedThemeIndexSV,
    selectedThoughtIndexSV,
    sheetY,
    thoughtSelectionProgress,
    zoom,
  ]);

  const closeProto = useCallback(() => {
    if (protoCloseTimerRef.current) clearTimeout(protoCloseTimerRef.current);
    sheetY.value = withTiming(180, { duration: 180 });
    protoCloseTimerRef.current = setTimeout(() => {
      setSelectedProtoId(null);
      protoCloseTimerRef.current = null;
    }, 180);
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
      themeClosingRef.current = false;
      setSelectedProtoId(null);
      setSelectedThoughtNodeIndex(null);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      const fit = Math.min(W - 44, 236) / (2 * theme.radius * 2.15);
      const targetZoom = clamp(fit, 1, 1.4);
      cancelAnimation(cameraX);
      cancelAnimation(cameraY);
      cancelAnimation(cameraZ);
      cancelAnimation(zoom);
      cancelAnimation(drill);
      cancelAnimation(sheetY);
      sheetY.value = 420;
      setSelectedThemeId(theme.id);
      selectedThemeIndexSV.value = themeIndex;
      selectedThoughtIndexSV.value = -1;
      thoughtSelectionProgress.value = 0;
      sheetY.value = withDelay(
        reduceMotion ? 0 : 70,
        withTiming(0, {
          duration: reduceMotion ? 0 : 430,
          easing: SOFT_EASING,
        }),
      );
      drill.value = withTiming(1, {
        duration: reduceMotion ? 0 : CAMERA_DURATION,
        easing: SOFT_EASING,
      });
      cameraX.value = withTiming(theme.cx, {
        duration: reduceMotion ? 0 : CAMERA_DURATION,
        easing: SOFT_EASING,
      });
      cameraY.value = withTiming(theme.cy, {
        duration: reduceMotion ? 0 : CAMERA_DURATION,
        easing: SOFT_EASING,
      });
      cameraZ.value = withTiming(theme.cz, {
        duration: reduceMotion ? 0 : CAMERA_DURATION,
        easing: SOFT_EASING,
      });
      zoom.value = withTiming(targetZoom, {
        duration: reduceMotion ? 0 : CAMERA_DURATION,
        easing: SOFT_EASING,
      });
    },
    [
      cameraX,
      cameraY,
      cameraZ,
      drill,
      layout.themes,
      reduceMotion,
      selectedThemeIndexSV,
      selectedThoughtIndexSV,
      sheetY,
      thoughtSelectionProgress,
      zoom,
    ],
  );

  const openThoughtPreview = useCallback(
    (nodeIndex: number) => {
      const node = graph?.nodes[nodeIndex];
      if (!node) return;
      const thoughtIndex = layout.thoughts.findIndex(
        (thought) => thought.nodeIndex === nodeIndex,
      );
      if (thoughtCloseTimerRef.current) {
        clearTimeout(thoughtCloseTimerRef.current);
        thoughtCloseTimerRef.current = null;
      }
      sheetY.value = 42;
      selectedThoughtIndexSV.value = thoughtIndex;
      setSelectedThoughtNodeIndex(nodeIndex);
      thoughtSelectionProgress.value = 0;
      thoughtSelectionProgress.value = withTiming(1, {
        duration: 380,
        easing: Easing.out(Easing.cubic),
      });
      sheetY.value = withTiming(0, {
        duration: 420,
        easing: Easing.out(Easing.cubic),
      });
    },
    [
      graph?.nodes,
      layout.thoughts,
      selectedThoughtIndexSV,
      sheetY,
      thoughtSelectionProgress,
    ],
  );

  const closeThoughtPreview = useCallback(() => {
    setSelectedThoughtNodeIndex(null);
    thoughtSelectionProgress.value = withTiming(0, { duration: 280 });
    sheetY.value = 26;
    sheetY.value = withTiming(0, {
      duration: 360,
      easing: Easing.out(Easing.cubic),
    });
    thoughtCloseTimerRef.current = setTimeout(() => {
      selectedThoughtIndexSV.value = -1;
      thoughtCloseTimerRef.current = null;
    }, 280);
  }, [selectedThoughtIndexSV, sheetY, thoughtSelectionProgress]);

  const resetToOverview = useCallback(() => {
    if (selectedThemeId) {
      closeTheme();
      return;
    }
    if (selectedProtoId) closeProto();
    if (selectedThoughtNodeIndex != null) closeThoughtPreview();
    resetCamera();
  }, [
    closeProto,
    closeTheme,
    closeThoughtPreview,
    resetCamera,
    selectedProtoId,
    selectedThemeId,
    selectedThoughtNodeIndex,
  ]);

  const openThoughtDetailForNode = useCallback(
    (node: GraphNode) => {
      const themeTitle =
        layout.themes.find((theme) => theme.id === node.cluster)?.fullTitle ??
        graph?.clusters.find((cluster) => cluster.id === node.cluster)
          ?.fullTitle ??
        "";
      router.push(
        `/thoughts/detail?path=${encodeURIComponent(node.id)}&theme=${encodeURIComponent(themeTitle)}` as Href,
      );
    },
    [graph?.clusters, layout.themes, router],
  );

  const openThoughtDetail = useCallback(() => {
    if (!selectedThought) return;
    openThoughtDetailForNode(selectedThought);
  }, [openThoughtDetailForNode, selectedThought]);

  const openThoughtDetailByIndex = useCallback(
    (nodeIndex: number) => {
      const node = graph?.nodes[nodeIndex];
      if (!node) return;
      openThoughtDetailForNode(node);
    },
    [graph?.nodes, openThoughtDetailForNode],
  );

  const handleTap = useCallback(
    (
      logicalX: number,
      logicalY: number,
      currentX: number,
      currentY: number,
      currentZ: number,
      currentZoom: number,
      currentYaw: number,
      currentPitch: number,
      currentDrill: number,
      currentThemeIndex: number,
      labelNodeIndex: number,
    ) => {
      if (labelNodeIndex >= 0) {
        const thought = layout.thoughts.find(
          (item) => item.nodeIndex === labelNodeIndex,
        );
        if (thought && currentThemeIndex !== thought.themeIndex)
          focusTheme(thought.themeIndex);
        openThoughtPreview(labelNodeIndex);
        return;
      }
      if (period === "today") {
        let best: ThoughtLayout | null = null;
        let bestDistance = 22;
        for (const thought of layout.thoughts) {
          const theme = layout.themes[thought.themeIndex];
          if (!theme) continue;
          const world = worldPoint(thought, theme, 0);
          const screen = projectPoint(
            world.x,
            world.y,
            world.z,
            currentX,
            currentY,
            currentZ,
            currentZoom,
            currentYaw,
            currentPitch,
            0,
          );
          const distance = Math.hypot(screen.x - logicalX, screen.y - logicalY);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = thought;
          }
        }
        if (best) openThoughtDetailByIndex(best.nodeIndex);
        return;
      }

      if (currentThemeIndex >= 0) {
        const theme = layout.themes[currentThemeIndex];
        if (!theme) return;
        let best: ThoughtLayout | null = null;
        let bestDistance = 19;
        for (const thought of layout.thoughts) {
          if (thought.themeIndex !== currentThemeIndex) continue;
          const world = worldPoint(thought, theme, currentDrill);
          const screen = projectPoint(
            world.x,
            world.y,
            world.z,
            currentX,
            currentY,
            currentZ,
            currentZoom,
            currentYaw,
            currentPitch,
            currentDrill,
          );
          const distance = Math.hypot(screen.x - logicalX, screen.y - logicalY);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = thought;
          }
        }
        if (best) {
          openThoughtPreview(best.nodeIndex);
        } else {
          closeTheme();
        }
        return;
      }

      if (selectedProtoId) {
        closeProto();
        return;
      }

      const projectedLabels = projectedThemeLabels(
        layout.themes,
        layout.thoughts,
        currentX,
        currentY,
        currentZ,
        currentZoom,
        currentYaw,
        currentPitch,
      );
      let bestTheme = -1;
      let bestDistance = Infinity;
      for (let index = 0; index < layout.themes.length; index += 1) {
        const theme = layout.themes[index];
        const center = projectPoint(
          theme.cx,
          theme.cy,
          theme.cz,
          currentX,
          currentY,
          currentZ,
          currentZoom,
          currentYaw,
          currentPitch,
          currentDrill,
        );
        const label = projectedLabels.find(
          (candidate) => candidate.themeIndex === index,
        );
        const distance = Math.hypot(center.x - logicalX, center.y - logicalY);
        const labelDistance = label
          ? Math.hypot(label.x - logicalX, label.y - logicalY)
          : Infinity;
        const labelHit = Boolean(
          label &&
          Math.abs(label.x - logicalX) <= label.width / 2 + 8 &&
          Math.abs(label.y - logicalY) <= label.height / 2 + 8,
        );
        const selectionDistance = labelHit ? labelDistance * 0.1 : distance;
        if (
          (labelHit || distance < theme.radius * currentZoom * 1.6) &&
          selectionDistance < bestDistance
        ) {
          bestDistance = selectionDistance;
          bestTheme = index;
        }
      }
      if (bestTheme >= 0) focusTheme(bestTheme);
    },
    [
      closeProto,
      closeTheme,
      focusTheme,
      layout.themes,
      layout.thoughts,
      openThoughtDetailByIndex,
      openThoughtPreview,
      period,
      selectedProtoId,
    ],
  );

  const stopCameraMotion = () => {
    "worklet";
    cancelAnimation(yaw);
    cancelAnimation(pitch);
    cancelAnimation(cameraX);
    cancelAnimation(cameraY);
    cancelAnimation(cameraZ);
    cancelAnimation(zoom);
  };
  const settleCamera = () => {
    "worklet";
    const settle = (current: number, low: number, high: number) => {
      "worklet";
      const target = clamp(current, low, high);
      return reduceMotion
        ? target
        : withTiming(target, {
            duration: 180,
            easing: Easing.out(Easing.cubic),
          });
    };
    cameraX.value = settle(cameraX.value, -W * 0.5, W * 1.5);
    cameraY.value = settle(cameraY.value, -H * 0.5, H * 1.5);
    cameraZ.value = settle(
      cameraZ.value,
      -PERSPECTIVE_DISTANCE * 0.5,
      PERSPECTIVE_DISTANCE * 0.5,
    );
  };
  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(4)
    .onBegin(stopCameraMotion)
    .onStart((event) => {
      stopCameraMotion();
      panOrigin.value = {
        touchX: event.translationX,
        touchY: event.translationY,
      };
    })
    .onUpdate((event) => {
      const dx = (event.translationX - panOrigin.value.touchX) / scaleX;
      const dy = (event.translationY - panOrigin.value.touchY) / scaleY;
      panOrigin.value = {
        touchX: event.translationX,
        touchY: event.translationY,
      };
      if (pinchActive.value || event.numberOfPointers > 1) return;
      // Follow the finger directly. Incremental movement lets a reversal respond
      // immediately, even after dragging beyond the vertical rotation limit.
      yaw.value += dx * ROTATION_X;
      pitch.value = clamp(pitch.value + dy * ROTATION_Y, -0.9, 0.9);
    })
    .onEnd((event, success) => {
      if (!success || pinchActive.value || reduceMotion) return;
      // A cubic ease-out starts at the release speed, then stops within 160 ms.
      // Bound fast flicks, and let a resting finger stop without extra travel.
      const coast = (velocity: number, gain: number, limit: number) => {
        "worklet";
        if (Math.abs(velocity) < 12) return 0;
        return clamp(
          (velocity * gain * ROTATION_TAIL_MS) / 3000,
          -limit,
          limit,
        );
      };
      const dx = coast(event.velocityX / scaleX, ROTATION_X, 0.22);
      const dy = coast(event.velocityY / scaleY, ROTATION_Y, 0.16);
      if (dx !== 0) {
        yaw.value = withTiming(yaw.value + dx, {
          duration: ROTATION_TAIL_MS,
          easing: Easing.out(Easing.cubic),
        });
      }
      if (dy !== 0) {
        pitch.value = withTiming(clamp(pitch.value + dy, -0.9, 0.9), {
          duration: ROTATION_TAIL_MS,
          easing: Easing.out(Easing.cubic),
        });
      }
    });

  const pinch = Gesture.Pinch()
    .onStart((event) => {
      stopCameraMotion();
      pinchActive.value = true;
      pinchStartZoom.value = zoom.value;
      const focusY = H / 2 + (FOCUS_Y - H / 2) * drill.value;
      const offset = screenPlaneOffset(
        ((event.focalX - viewport.x) / scaleX - W / 2) / zoom.value,
        ((event.focalY - viewport.y) / scaleY - focusY) / zoom.value,
        yaw.value,
        pitch.value,
      );
      pinchAnchor.value = {
        x: cameraX.value + offset.x,
        y: cameraY.value + offset.y,
        z: cameraZ.value + offset.z,
      };
    })
    .onUpdate((event) => {
      const nextZoom = clamp(
        pinchStartZoom.value * event.scale,
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const focusY = H / 2 + (FOCUS_Y - H / 2) * drill.value;
      const offset = screenPlaneOffset(
        ((event.focalX - viewport.x) / scaleX - W / 2) / nextZoom,
        ((event.focalY - viewport.y) / scaleY - focusY) / nextZoom,
        yaw.value,
        pitch.value,
      );
      cameraX.value = pinchAnchor.value.x - offset.x;
      cameraY.value = pinchAnchor.value.y - offset.y;
      cameraZ.value = pinchAnchor.value.z - offset.z;
      zoom.value = nextZoom;
    })
    .onFinalize(() => {
      if (!pinchActive.value) return;
      pinchActive.value = false;
      settleCamera();
    });

  const projectedLabels = useDerivedValue(() =>
    graphLabelLayout(
      layout,
      graph,
      thoughtFont,
      period,
      {
        x: cameraX.value,
        y: cameraY.value,
        z: cameraZ.value,
        zoom: zoom.value,
        yaw: yaw.value,
        pitch: pitch.value,
        drill: drill.value,
        themeIndex: selectedThemeIndexSV.value,
        thoughtIndex: selectedThoughtIndexSV.value,
      },
      thoughtLayoutIndexByNodeIndex,
    ),
  );

  const singleTap = Gesture.Tap()
    .maxDistance(12)
    .maxDuration(350)
    .onBegin(() => {
      cancelAnimation(yaw);
      cancelAnimation(pitch);
    })
    .onEnd((event, success) => {
      if (!success) return;
      runOnJS(handleTap)(
        (event.x - viewport.x) / scaleX,
        (event.y - viewport.y) / scaleY,
        cameraX.value,
        cameraY.value,
        cameraZ.value,
        zoom.value,
        yaw.value,
        pitch.value,
        drill.value,
        selectedThemeIndexSV.value,
        hitThoughtLabel(
          projectedLabels.value.thoughts,
          (event.x - viewport.x) / scaleX,
          (event.y - viewport.y) / scaleY,
        ),
      );
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDistance(16)
    .maxDuration(250)
    .maxDelay(250)
    .onBegin(() => {
      stopCameraMotion();
    })
    .onEnd((_event, success) => {
      if (success) runOnJS(resetToOverview)();
    });
  // A short finger movement must resolve to either a tap or a pan, never both.
  // Give a double tap priority over a single tap, while keeping two-finger
  // pinching simultaneous and unaffected.
  const taps = Gesture.Exclusive(doubleTap, singleTap);
  const gesture = Gesture.Simultaneous(pinch, Gesture.Race(pan, taps));

  const picture = useDerivedValue(() =>
    createPicture((canvas) => {
      "worklet";
      if (size.width <= 0 || size.height <= 0) return;
      const sx = viewport.scale;
      const sy = viewport.scale;
      const pointScale = Math.min(sx, sy);
      const currentZoom = zoom.value;
      const currentDrill = drill.value;
      const selectedIndex = selectedThemeIndexSV.value;
      const selectedThoughtIndex = selectedThoughtIndexSV.value;
      const currentThoughtSelection = thoughtSelectionProgress.value;
      const focusedTheme =
        selectedIndex >= 0 ? layout.themes[selectedIndex] : null;
      const colors: Record<string, ReturnType<typeof Skia.Color>> = {};
      const color = (hex: string) => {
        if (!colors[hex]) colors[hex] = Skia.Color(hex);
        return colors[hex];
      };
      const transparent = color("#00000000");
      const roomPaint = Skia.Paint();
      roomPaint.setAntiAlias(true);
      roomPaint.setDither(true);
      const hazePaint = Skia.Paint();
      hazePaint.setAntiAlias(true);
      const pointPaint = Skia.Paint();
      pointPaint.setAntiAlias(true);
      const ringPaint = Skia.Paint();
      ringPaint.setAntiAlias(true);
      ringPaint.setStyle(PaintStyle.Stroke);
      ringPaint.setStrokeWidth(1);
      const linePaint = Skia.Paint();
      linePaint.setAntiAlias(true);
      linePaint.setStyle(PaintStyle.Stroke);
      linePaint.setStrokeWidth(0.65 * pointScale);
      linePaint.setColor(color("#7B91A0"));
      const textPaint = Skia.Paint();
      textPaint.setAntiAlias(true);
      canvas.save();

      // Broad, overlapping light fields imply distance without drawing a room.
      // Different parallax depths keep the atmosphere behind the orbiting dots.
      if (renderingStage !== "colors") {
        const orbitX = Math.sin(yaw.value);
        const orbitY = Math.sin(pitch.value);
        const wash = (
          x: number,
          y: number,
          width: number,
          height: number,
          tint: string,
          alpha: number,
        ) => {
          "worklet";
          canvas.save();
          canvas.translate(size.width * x, size.height * y);
          canvas.scale(size.width * width, size.height * height);
          roomPaint.setShader(
            Skia.Shader.MakeRadialGradient(
              { x: 0, y: 0 },
              1,
              [
                color(tint),
                color(tint + "C7"),
                color(tint + "3D"),
                color(tint + "00"),
              ],
              [0, 0.3, 0.65, 1],
              TileMode.Clamp,
            ),
          );
          roomPaint.setAlphaf(alpha);
          canvas.drawCircle(0, 0, 1, roomPaint);
          canvas.restore();
        };
        canvas.saveLayer();
        // Cool distance is offset from the light, rather than centered like a spotlight.
        wash(
          0.64 - orbitX * 0.055,
          0.53 - orbitY * 0.04,
          0.78,
          0.59,
          "#9DB8CB",
          0.34,
        );
        // A trace of warmer reflected light gives the pale field some tonal depth.
        wash(
          0.38 - orbitX * 0.025,
          0.72 - orbitY * 0.02,
          0.65,
          0.4,
          "#BDB0BD",
          0.14,
        );
        // The nearer soft light moves a little more, making rotation perceptible.
        wash(
          0.25 + orbitX * 0.075,
          0.3 + orbitY * 0.045,
          0.68,
          0.55,
          "#FFFCF5",
          0.66,
        );
        // Fade the entire atmosphere back to the native app field at every edge.
        const fieldMask = Skia.Paint();
        fieldMask.setBlendMode(BlendMode.DstIn);
        fieldMask.setDither(true);
        for (const vertical of [false, true]) {
          fieldMask.setShader(
            Skia.Shader.MakeLinearGradient(
              { x: 0, y: 0 },
              { x: vertical ? 0 : size.width, y: vertical ? size.height : 0 },
              [
                transparent,
                color("#FFFFFF21"),
                color("#FFFFFFA6"),
                color("#FFFFFF"),
                color("#FFFFFF"),
                color("#FFFFFFA6"),
                color("#FFFFFF21"),
                transparent,
              ],
              [0, 0.06, 0.16, 0.28, 0.72, 0.84, 0.94, 1],
              TileMode.Clamp,
            ),
          );
          canvas.drawRect(
            Skia.XYWHRect(0, 0, size.width, size.height),
            fieldMask,
          );
        }
        canvas.restore();
      }

      canvas.translate(viewport.x, viewport.y);
      const dustAlpha = selectedIndex >= 0 ? 1 - 0.75 * currentDrill : 1;
      pointPaint.setColor(color(GREY));
      for (const point of layout.dust) {
        const screen = projectPoint(
          point.x,
          point.y,
          0,
          cameraX.value,
          cameraY.value,
          cameraZ.value,
          currentZoom,
          yaw.value,
          pitch.value,
          currentDrill,
        );
        pointPaint.setAlphaf(point.alpha * dustAlpha);
        canvas.drawCircle(
          screen.x * sx,
          screen.y * sy,
          point.size * Math.sqrt(currentZoom) * 0.75 * pointScale,
          pointPaint,
        );
      }

      if (period !== "today" && graph) {
        for (const edge of graph.edges) {
          const sourceLayoutIndex = thoughtLayoutIndexByNodeIndex[edge.source];
          const targetLayoutIndex = thoughtLayoutIndexByNodeIndex[edge.target];
          if (sourceLayoutIndex == null || targetLayoutIndex == null) continue;
          if (sourceLayoutIndex < 0 || targetLayoutIndex < 0) continue;
          const sourceThought = layout.thoughts[sourceLayoutIndex];
          const targetThought = layout.thoughts[targetLayoutIndex];
          if (!sourceThought || !targetThought) continue;
          if (sourceThought.themeIndex !== targetThought.themeIndex) continue;
          const theme = layout.themes[sourceThought.themeIndex];
          if (!theme) continue;
          const focused = selectedIndex === sourceThought.themeIndex;
          const focusAmount = focused ? currentDrill : 0;
          const offset = focusedThemeOffset(theme, focusedTheme, currentDrill);
          const sourceWorld = worldPoint(sourceThought, theme, focusAmount);
          const targetWorld = worldPoint(targetThought, theme, focusAmount);
          const source = projectPoint(
            sourceWorld.x + offset.x,
            sourceWorld.y + offset.y,
            sourceWorld.z,
            cameraX.value,
            cameraY.value,
            cameraZ.value,
            currentZoom,
            yaw.value,
            pitch.value,
            currentDrill,
          );
          const target = projectPoint(
            targetWorld.x + offset.x,
            targetWorld.y + offset.y,
            targetWorld.z,
            cameraX.value,
            cameraY.value,
            cameraZ.value,
            currentZoom,
            yaw.value,
            pitch.value,
            currentDrill,
          );
          const direct =
            selectedThoughtIndex >= 0 &&
            (sourceLayoutIndex === selectedThoughtIndex ||
              targetLayoutIndex === selectedThoughtIndex);
          const selectedElsewhere =
            selectedThoughtIndex >= 0 && !direct && focused;
          const baseAlpha = focused ? 0.24 : 0.075;
          const similarityAlpha = clamp((edge.weight - 0.3) / 0.7, 0, 1);
          const alpha =
            (direct ? 0.46 : selectedElsewhere ? 0.025 : baseAlpha) *
            (0.55 + 0.45 * similarityAlpha) *
            Math.min(sourceThought.ageOpacity, targetThought.ageOpacity);
          linePaint.setAlphaf(alpha);
          linePaint.setStrokeWidth((direct ? 0.9 : 0.65) * pointScale);
          canvas.drawLine(
            source.x * sx,
            source.y * sy,
            target.x * sx,
            target.y * sy,
            linePaint,
          );
        }
      }

      const drawingOrder = layout.thoughts
        .map((thought, index) => {
          const theme = layout.themes[thought.themeIndex];
          if (!theme) return { index, depth: 0, x: -1000, y: -1000, radius: 0 };
          const focused = selectedIndex === thought.themeIndex;
          const focusAmount = focused ? currentDrill : 0;
          const offset = focusedThemeOffset(theme, focusedTheme, currentDrill);
          const world = worldPoint(thought, theme, focusAmount);
          const screen = projectPoint(
            world.x + offset.x,
            world.y + offset.y,
            world.z,
            cameraX.value,
            cameraY.value,
            cameraZ.value,
            currentZoom,
            yaw.value,
            pitch.value,
            currentDrill,
          );
          return {
            index,
            depth: screen.depth,
            x: screen.x,
            y: screen.y,
            radius: projectedDotRadius(thought.size, screen.magnification),
          };
        })
        .sort((left, right) => right.depth - left.depth);
      // Composite every halo underneath every dot, so later halos cannot
      // wash out earlier dots or shift their material color.
      for (const pass of ["aura", "glow", "dots"]) {
        if (pass !== "dots" && renderingStage !== "glow") continue;
        if (pass === "aura") canvas.saveLayer();
        if (pass === "glow") {
          const lightLayer = Skia.Paint();
          lightLayer.setBlendMode(BlendMode.Screen);
          canvas.saveLayer(lightLayer);
        }
        for (const { index } of drawingOrder) {
          const thought = layout.thoughts[index];
          const theme = layout.themes[thought.themeIndex];
          if (!theme) continue;
          const focused = selectedIndex === thought.themeIndex;
          const f = focused ? currentDrill : 0;
          const relationship =
            selectedIndex >= 0
              ? (layout.similarities[
                  selectedIndex * layout.themes.length + thought.themeIndex
                ] ?? 0.05)
              : 1;
          const dim =
            selectedIndex >= 0 && !focused
              ? currentDrill * (1 - 0.55 * relationship)
              : 0;
          const offset = focusedThemeOffset(theme, focusedTheme, currentDrill);
          const world = worldPoint(thought, theme, f);
          const screen = projectPoint(
            world.x + offset.x,
            world.y + offset.y,
            world.z,
            cameraX.value,
            cameraY.value,
            cameraZ.value,
            currentZoom,
            yaw.value,
            pitch.value,
            currentDrill,
          );
          const radius =
            projectedDotRadius(thought.size, screen.magnification) * pointScale;
          const screenX = screen.x * sx;
          const screenY = screen.y * sy;
          const selectedFactor =
            selectedThoughtIndex >= 0 &&
            selectedThoughtIndex !== index &&
            focused
              ? 1 - 0.6 * currentThoughtSelection
              : 1;
          const baseAlpha = thought.ageOpacity;
          const alpha =
            (theme.proto
              ? 0.65 * baseAlpha
              : renderingStage === "colors"
                ? 1
                : baseAlpha) *
            (1 - 0.9 * dim) *
            selectedFactor;

          const light = thoughtLight(radius, pointScale, alpha, theme.count);
          if (pass === "aura") {
            if (theme.proto) continue;
            const radiusOfLight = light.auraRadius;
            hazePaint.setShader(
              Skia.Shader.MakeRadialGradient(
                { x: screenX, y: screenY },
                radiusOfLight,
                [color(theme.color), color(`${theme.color}00`)],
                [0, 1],
                TileMode.Clamp,
              ),
            );
            hazePaint.setAlphaf(light.auraAlpha);
            canvas.drawCircle(screenX, screenY, radiusOfLight, hazePaint);
            continue;
          }
          if (pass === "glow") {
            if (theme.proto) continue;
            const glowRadius = light.glowRadius;
            const shader = Skia.Shader.MakeRadialGradient(
              { x: screenX, y: screenY },
              glowRadius,
              [
                color(theme.emissionColor),
                color(theme.emissionColor),
                color(`${theme.emissionColor}00`),
              ],
              [0, 0.26, 1],
              TileMode.Clamp,
            );
            hazePaint.setShader(shader);
            hazePaint.setAlphaf(light.glowAlpha);
            canvas.drawCircle(screenX, screenY, glowRadius, hazePaint);
            continue;
          }

          if (theme.proto || renderingStage === "colors") {
            pointPaint.setShader(null);
            pointPaint.setColor(color(theme.proto ? GREY : theme.sourceColor));
          } else {
            pointPaint.setShader(
              Skia.Shader.MakeRadialGradient(
                { x: screenX - radius * 0.28, y: screenY - radius * 0.34 },
                radius * 1.4,
                [
                  color(theme.highlightColor),
                  color(theme.color),
                  color(theme.shadowColor),
                ],
                [0, 0.6, 1],
                TileMode.Clamp,
              ),
            );
          }
          pointPaint.setAlphaf(alpha);
          canvas.drawCircle(screenX, screenY, radius, pointPaint);
          if (selectedThoughtIndex === index) {
            ringPaint.setColor(color(theme.color));
            ringPaint.setAlphaf(0.72 * currentThoughtSelection);
            canvas.drawCircle(
              screenX,
              screenY,
              radius + 3.5 * pointScale,
              ringPaint,
            );
          }
        }

        if (pass !== "dots") {
          // Fade only the halo layer at all four edges; dots retain their color.
          const mask = Skia.Paint();
          mask.setBlendMode(BlendMode.DstIn);
          for (const vertical of [false, true]) {
            mask.setShader(
              Skia.Shader.MakeLinearGradient(
                { x: 0, y: 0 },
                { x: vertical ? 0 : W * sx, y: vertical ? H * sy : 0 },
                [transparent, color("#FFFFFF"), color("#FFFFFF"), transparent],
                [0, 0.1, 0.9, 1],
                TileMode.Clamp,
              ),
            );
            canvas.drawRect(Skia.XYWHRect(0, 0, W * sx, H * sy), mask);
          }
          canvas.restore();
        }
      }

      canvas.save();
      canvas.scale(sx, sy);
      if (themeFont && period !== "today" && currentDrill < 0.98) {
        const topicLabels = projectedLabels.value.themes;
        textPaint.setColor(color(MEMORY_THEME.ink));
        for (const label of topicLabels) {
          const theme = layout.themes[label.themeIndex];
          if (!theme || theme.proto) continue;
          const alpha = (theme.count === 0 ? 0.3 : 0.92) * (1 - currentDrill);
          if (alpha <= 0.01) continue;
          textPaint.setAlphaf(alpha);
          const lines = theme.label.split("\n");
          const firstBaseline =
            label.y - ((lines.length - 1) * LABEL_HEIGHT) / 2 + 3.6;
          for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex];
            const width = themeFont.getTextWidth(line);
            canvas.drawText(
              line,
              label.x - width / 2,
              firstBaseline + lineIndex * LABEL_HEIGHT,
              textPaint,
              themeFont,
            );
          }
        }
      }

      for (const label of projectedLabels.value.thoughts) {
        const theme = layout.themes[label.themeIndex];
        textPaint.setColor(color(theme.proto ? GREY : theme.color));
        textPaint.setAlphaf(label.alpha);
        if (thoughtFont)
          canvas.drawText(label.text, label.x, label.y, textPaint, thoughtFont);
      }

      canvas.restore();
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

      {status === "loading" ? (
        <View pointerEvents="none" style={styles.center}>
          <ThoughtLoading compact label="Deine Gedanken verbinden sich …" />
        </View>
      ) : null}
      {status === "error" ? (
        <View style={styles.center}>
          <Text style={styles.stateText}>
            Die Karte konnte nicht geladen werden.
          </Text>
          <Pressable hitSlop={8} onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : null}
      {status === "ready" && (graph?.nodes.length ?? 0) === 0 ? (
        <View pointerEvents="none" style={styles.center}>
          <Text style={styles.emptyText}>
            {period === "today"
              ? "Heute noch keine Gedanken."
              : period === "week"
                ? "In den letzten 7 Tagen keine Gedanken."
                : period === "month"
                  ? "Im letzten Monat keine Gedanken."
                  : "Deine Themen entstehen, sobald sich Gedanken sammeln."}
          </Text>
        </View>
      ) : null}

      {period !== "today" && selectedThought ? (
        <ThoughtSheet
          key={selectedThought.id}
          node={selectedThought}
          onClose={closeThoughtPreview}
          onOpenDetail={openThoughtDetail}
          sheetY={sheetY}
        />
      ) : period !== "today" && selectedTheme ? (
        <ThemeSheet
          nodes={selectedNodes}
          onClose={closeTheme}
          sheetY={sheetY}
          theme={selectedTheme}
        />
      ) : null}
      {period !== "today" && selectedProto ? (
        <ProtoSheet
          nodes={protoNodes}
          onClose={closeProto}
          sheetY={sheetY}
          theme={selectedProto}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: MEMORY_THEME.field,
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: SHEET_BOTTOM_INSET,
    zIndex: 20,
    borderRadius: 24,
    backgroundColor: "#F9FAFB",
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 20,
    shadowColor: C.ink,
    shadowOpacity: 0,
    elevation: 0,
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
  expandedSheet: {
    maxHeight: "78%",
    overflow: "hidden",
  },
  thoughtHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  thoughtTypeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  thoughtTypeDot: {
    width: 9,
    height: 9,
    marginRight: 7,
    borderRadius: 5,
  },
  thoughtTypeLabel: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    letterSpacing: 0.6,
    color: C.ink60,
    textTransform: "uppercase",
  },
  thoughtDate: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    color: C.ink40,
  },
  thoughtTitle: {
    marginBottom: 8,
    fontFamily: NOTE_SERIF,
    fontSize: 22,
    lineHeight: 28,
    color: C.ink,
  },
  thoughtBody: {
    marginTop: 2,
    fontFamily: NOTE_SANS,
    fontSize: 14.5,
    lineHeight: 22,
    color: C.ink70,
  },
  thoughtBodyScroll: {
    maxHeight: 280,
    flexGrow: 0,
    flexShrink: 1,
  },
  thoughtBodyScrollContent: {
    paddingBottom: 6,
  },
  thoughtDetailButton: {
    alignSelf: "flex-end",
    minHeight: 36,
    marginTop: 12,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  thoughtDetailButtonText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12.5,
    color: C.skyDeep,
  },
  timeline: {
    marginTop: 20,
  },
  timelineTitle: {
    marginBottom: 8,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 10,
    letterSpacing: 0.8,
    color: C.ink40,
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
    alignItems: "center",
    justifyContent: "flex-end",
  },
  timelineBar: {
    width: "72%",
    minWidth: 1,
    borderRadius: 2,
  },
  timelineMonths: {
    flexDirection: "row",
    height: 21,
  },
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
  pressed: { opacity: 0.58 },
});
