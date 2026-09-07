import type { Graph, GraphNode } from "@/lib/visualizations";

export const FEELING_SWARM_HEIGHT = 160;
export const FEELING_SWARM_CENTER_Y = 62;
export const FEELING_FLOW_HEIGHT = 230;
export const FEELING_HORIZONTAL_PAD = 8;
export const FEELING_WORD_CAP = 600;
export const FEELING_THRESHOLD = 0.25;

const FLOW_TOP = 10;
const FLOW_BOTTOM = 22;
const DAY_MS = 86_400_000;

const ROSE = [201, 126, 132] as const;
const MID = [190, 198, 205] as const;
const SAGE = [118, 160, 132] as const;

const MONTHS = [
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
] as const;

export type FeelingPeriod = "all" | "today" | "week" | "month";

export type FeelingThought = {
  id: string;
  date: string;
  title: string;
  themeLabel?: string;
  valence: number;
  wordCount: number;
};

export type FeelingSwarmPoint = FeelingThought & {
  x: number;
  y: number;
  color: string;
  alpha: number;
};

export type FeelingFlowPoint = FeelingThought & {
  x: number;
  y: number;
  color: string;
  alpha: number;
};

export type FeelingFlowSample = {
  date: string;
  x: number;
  value: number;
  q1: number;
  q3: number;
  y: number;
  q1Y: number;
  q3Y: number;
};

export type FeelingMonthLabel = {
  label: string;
  x: number;
};

export type FeelingDistributionSegment = {
  startX: number;
  endX: number;
  centerX: number;
};

export type FeelingLayout = {
  width: number;
  thoughts: FeelingThought[];
  swarmPoints: FeelingSwarmPoint[];
  flowPoints: FeelingFlowPoint[];
  flowSamples: FeelingFlowSample[];
  thoughtIdsByDate: Record<string, string[]>;
  dayValues: Record<string, number>;
  distributionShares: [number, number, number];
  percentages: [number, number, number];
  monthLabels: FeelingMonthLabel[];
  endDateLabel: FeelingMonthLabel | null;
  zeroY: number;
  startDate: string | null;
  endDate: string | null;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function mix(from: readonly number[], to: readonly number[], amount: number) {
  return from.map((value, index) =>
    Math.round(value + (to[index] - value) * amount),
  );
}

export function feelingColor(value: number): string {
  const normalized = clamp(value, -1, 1);
  const channels =
    normalized < 0 ? mix(MID, ROSE, -normalized) : mix(MID, SAGE, normalized);
  return `rgb(${channels.join(",")})`;
}

function utcDate(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(dateKeyValue: string, days: number): string {
  const date = utcDate(dateKeyValue);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function daysBetween(start: string, end: string): number {
  return Math.round(
    (utcDate(end).getTime() - utcDate(start).getTime()) / DAY_MS,
  );
}

function periodBounds(
  thoughts: FeelingThought[],
  period: FeelingPeriod,
  today: Date,
): { start: string; end: string } | null {
  if (thoughts.length === 0) return null;
  const todayKey = localDateKey(today);
  if (period === "today") return { start: todayKey, end: todayKey };
  if (period === "week") return { start: addDays(todayKey, -6), end: todayKey };
  if (period === "month")
    return { start: addDays(todayKey, -29), end: todayKey };
  const dates = thoughts.map(({ date }) => date).sort();
  return {
    start: dates[0],
    end:
      dates[dates.length - 1] > todayKey ? dates[dates.length - 1] : todayKey,
  };
}

function weight(thought: FeelingThought): number {
  return Math.min(Math.max(0, thought.wordCount), FEELING_WORD_CAP);
}

export function weightedFeelingMean(thoughts: FeelingThought[]): number {
  const denominator = thoughts.reduce(
    (sum, thought) => sum + weight(thought),
    0,
  );
  if (denominator === 0) return 0;
  return (
    thoughts.reduce(
      (sum, thought) => sum + thought.valence * weight(thought),
      0,
    ) / denominator
  );
}

export function weightedFeelingQuantile(
  thoughts: FeelingThought[],
  quantile: number,
): number {
  if (thoughts.length === 0) return 0;
  const sorted = [...thoughts].sort(
    (left, right) => left.valence - right.valence,
  );
  const total = sorted.reduce((sum, thought) => sum + weight(thought), 0);
  const target = clamp(quantile, 0, 1) * total;
  let accumulated = 0;
  for (const thought of sorted) {
    accumulated += weight(thought);
    if (accumulated >= target) return thought.valence;
  }
  return sorted[sorted.length - 1].valence;
}

export function feelingThoughtsFromGraph(
  graph: Graph | null,
): FeelingThought[] {
  if (!graph) return [];
  const themeById = new Map(
    graph.clusters.map((cluster) => [cluster.id, cluster.label]),
  );
  return graph.nodes.flatMap((node: GraphNode) =>
    node.valence == null
      ? []
      : [
          {
            id: node.id,
            date: (node.date || node.capturedAt).slice(0, 10),
            title: node.title,
            themeLabel: themeById.get(node.cluster),
            valence: clamp(node.valence, -1, 1),
            wordCount: node.wordCount,
          },
        ],
  );
}

export function feelingPercentages(
  thoughts: FeelingThought[],
): [number, number, number] {
  return feelingDistributionShares(thoughts).map((share) =>
    Math.round(share * 100),
  ) as [number, number, number];
}

export function feelingDistributionShares(
  thoughts: FeelingThought[],
): [number, number, number] {
  if (thoughts.length === 0) return [0, 0, 0];
  const negative = thoughts.filter(
    ({ valence }) => valence < -FEELING_THRESHOLD,
  ).length;
  const positive = thoughts.filter(
    ({ valence }) => valence > FEELING_THRESHOLD,
  ).length;
  const neutral = thoughts.length - negative - positive;
  return [negative, neutral, positive].map(
    (count) => count / thoughts.length,
  ) as [number, number, number];
}

export function buildFeelingDistributionSegments(
  width: number,
  shares: [number, number, number],
  padding = FEELING_HORIZONTAL_PAD,
  gap = 3,
): [
  FeelingDistributionSegment,
  FeelingDistributionSegment,
  FeelingDistributionSegment,
] {
  const totalSegmentWidth = Math.max(0, width - 2 * padding - 2 * gap);
  let cursor = padding;
  return shares.map((share) => {
    const startX = cursor;
    const endX = startX + share * totalSegmentWidth;
    cursor = endX + gap;
    return { startX, endX, centerX: (startX + endX) / 2 };
  }) as [
    FeelingDistributionSegment,
    FeelingDistributionSegment,
    FeelingDistributionSegment,
  ];
}

function recencyAlpha(
  date: string,
  startDate: string,
  endDate: string,
  minimum: number,
  range: number,
): number {
  const span = Math.max(1, daysBetween(startDate, endDate));
  const age = clamp(daysBetween(date, endDate), 0, span);
  return minimum + range * (1 - age / span);
}

export function buildFeelingLayout(
  thoughts: FeelingThought[],
  period: FeelingPeriod,
  width = 349,
  today = new Date(),
): FeelingLayout {
  const chartWidth = Math.max(1, width);
  const bounds = periodBounds(thoughts, period, today);
  const xForValence = (value: number) =>
    FEELING_HORIZONTAL_PAD +
    ((clamp(value, -1, 1) + 1) / 2) * (chartWidth - 2 * FEELING_HORIZONTAL_PAD);
  const distributionShares = feelingDistributionShares(thoughts);
  const empty: FeelingLayout = {
    width: chartWidth,
    thoughts,
    swarmPoints: [],
    flowPoints: [],
    flowSamples: [],
    thoughtIdsByDate: {},
    dayValues: {},
    distributionShares,
    percentages: feelingPercentages(thoughts),
    monthLabels: [],
    endDateLabel: null,
    zeroY: FLOW_TOP + (FEELING_FLOW_HEIGHT - FLOW_TOP - FLOW_BOTTOM) / 2,
    startDate: bounds?.start ?? null,
    endDate: bounds?.end ?? null,
  };
  if (!bounds) return empty;

  const radius = 3.6;
  const centerY = FEELING_SWARM_CENTER_Y;
  const columnCounts = new Map<number, number>();
  const sorted = [...thoughts].sort(
    (left, right) =>
      left.valence - right.valence || left.id.localeCompare(right.id),
  );
  const swarmPoints = sorted.map((thought) => {
    const rawX = xForValence(thought.valence);
    const column = Math.round(rawX / (radius * 2.1));
    const levelIndex = columnCounts.get(column) ?? 0;
    columnCounts.set(column, levelIndex + 1);
    const level =
      levelIndex === 0
        ? 0
        : Math.ceil(levelIndex / 2) * (levelIndex % 2 ? 1 : -1);
    return {
      ...thought,
      x: column * radius * 2.1,
      y: centerY + level * radius * 2.05,
      color: feelingColor(thought.valence),
      alpha: recencyAlpha(thought.date, bounds.start, bounds.end, 0.45, 0.5),
    };
  });

  const totalDays = Math.max(0, daysBetween(bounds.start, bounds.end));
  const xForDay = (date: string) =>
    totalDays === 0
      ? chartWidth / 2
      : FEELING_HORIZONTAL_PAD +
        (daysBetween(bounds.start, date) / totalDays) *
          (chartWidth - 2 * FEELING_HORIZONTAL_PAD);
  const yForValence = (value: number) =>
    FLOW_TOP +
    ((1 - clamp(value, -1, 1)) / 2) *
      (FEELING_FLOW_HEIGHT - FLOW_TOP - FLOW_BOTTOM);
  const thoughtsByDate = new Map<string, FeelingThought[]>();
  for (const thought of thoughts) {
    const existing = thoughtsByDate.get(thought.date) ?? [];
    existing.push(thought);
    thoughtsByDate.set(thought.date, existing);
  }

  const flowSamples: FeelingFlowSample[] = [];
  let lastValue = 0;
  let lastQ1 = 0;
  let lastQ3 = 0;
  const dayValues: Record<string, number> = {};
  for (let offset = 0; offset <= totalDays; offset++) {
    const currentDate = addDays(bounds.start, offset);
    const windowThoughts: FeelingThought[] = [];
    for (let delta = -3; delta <= 3; delta++) {
      windowThoughts.push(
        ...(thoughtsByDate.get(addDays(currentDate, delta)) ?? []),
      );
    }
    if (windowThoughts.length > 0) {
      lastValue = weightedFeelingMean(windowThoughts);
      lastQ1 = weightedFeelingQuantile(windowThoughts, 0.25);
      lastQ3 = weightedFeelingQuantile(windowThoughts, 0.75);
    }
    const directThoughts = thoughtsByDate.get(currentDate) ?? [];
    dayValues[currentDate] =
      directThoughts.length > 0
        ? weightedFeelingMean(directThoughts)
        : lastValue;
    flowSamples.push({
      date: currentDate,
      x: xForDay(currentDate),
      value: lastValue,
      q1: lastQ1,
      q3: lastQ3,
      y: yForValence(lastValue),
      q1Y: yForValence(lastQ1),
      q3Y: yForValence(lastQ3),
    });
  }

  const flowPoints = thoughts.map((thought) => ({
    ...thought,
    x: xForDay(thought.date),
    y: yForValence(thought.valence),
    color: feelingColor(thought.valence),
    alpha: recencyAlpha(thought.date, bounds.start, bounds.end, 0.35, 0.35),
  }));
  const thoughtIdsByDate = Object.fromEntries(
    [...thoughtsByDate].map(([date, dayThoughts]) => [
      date,
      dayThoughts.map(({ id }) => id),
    ]),
  );

  const monthLabels: FeelingMonthLabel[] = [];
  let previousMonth = "";
  for (let offset = 0; offset <= totalDays; offset++) {
    const currentDate = addDays(bounds.start, offset);
    const current = utcDate(currentDate);
    const monthKey = `${current.getUTCFullYear()}-${current.getUTCMonth()}`;
    if (monthKey === previousMonth) continue;
    previousMonth = monthKey;
    monthLabels.push({
      label: MONTHS[current.getUTCMonth()],
      x: xForDay(currentDate),
    });
  }
  const endDate = utcDate(bounds.end);
  const endDateLabel = {
    label: `${endDate.getUTCDate()}. ${MONTHS[endDate.getUTCMonth()]}`,
    x: xForDay(bounds.end),
  };

  return {
    ...empty,
    swarmPoints,
    flowPoints,
    flowSamples,
    thoughtIdsByDate,
    dayValues,
    monthLabels: monthLabels.filter(
      ({ x }) => Math.abs(x - endDateLabel.x) >= 44,
    ),
    endDateLabel,
  };
}
