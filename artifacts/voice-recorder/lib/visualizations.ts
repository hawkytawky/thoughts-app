import { backendFetch } from "@/lib/auth/api";
import { z } from "zod";

export type GraphNode = {
  id: string;
  idx: number;
  x: number;
  y: number;
  cluster: string;
  primaryTopicId: string;
  secondaryTopicIds: string[];
  size: number;
  type: string;
  title: string;
  subtitle: string;
  summary: string;
  capturedAt: string;
  wordCount: number;
  date: string;
  dateLabel: string;
  keyword: string;
  topTags: string[];
};

export type GraphCluster = {
  id: string;
  label: string;
  fullTitle?: string;
  description: string;
  status: string;
  color: string;
  textColor: string;
  count: number;
  anchorX: number;
  anchorY: number;
  lastActivity?: string;
};

export type TopicSimilarity = {
  sourceTopicId: string;
  targetTopicId: string;
  similarity: number;
};

export type GraphEdge = { source: number; target: number; weight: number };
export type SecondaryTopicEdge = {
  source: number;
  targetTopicId: string;
  relevance: number;
};

export type TimeTopicVolume = {
  cluster: string;
  wordCount: number;
  thoughtCount: number;
};

export type TimeDayVolume = {
  date: string;
  wordCount: number;
  thoughtCount: number;
  topics: TimeTopicVolume[];
};

export type TimeProjection = {
  timezone: string;
  maxDailyWordCount: number;
  days: TimeDayVolume[];
};

export type Graph = {
  meta: {
    nodes: number;
    clusters: number;
    sourceCount: number;
    assignedCount: number;
    pendingThoughts: number;
    themeThreshold: number;
    model?: string | null;
    pipelineVersion: string;
  };
  clusters: GraphCluster[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  secondaryTopicEdges: SecondaryTopicEdge[];
  topicSimilarities: TopicSimilarity[];
  time: TimeProjection;
  generatedAt?: string | null;
};

const nonNegativeNumber = z.number().finite().nonnegative();
const topicGraphResponseSchema = z.object({
  meta: z.object({
    nodes: z.number().int().nonnegative(),
    topics: z.number().int().nonnegative(),
    sourceCount: z.number().int().nonnegative(),
    assignedCount: z.number().int().nonnegative(),
    pendingThoughts: z.number().int().nonnegative(),
    themeThreshold: z.number().int().nonnegative().optional(),
    model: z.string().nullable().optional(),
    pipelineVersion: z.string(),
  }),
  topics: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      fullTitle: z.string().optional(),
      description: z.string(),
      status: z.string(),
      color: z.string(),
      textColor: z.string(),
      count: z.number().int().nonnegative(),
      anchorX: z.number().finite(),
      anchorY: z.number().finite(),
      lastActivity: z.string().optional(),
    }),
  ),
  nodes: z.array(
    z.object({
      id: z.string(),
      x: z.number().finite(),
      y: z.number().finite(),
      primaryTopicId: z.string(),
      secondaryTopicIds: z.array(z.string()),
      size: nonNegativeNumber,
      type: z.string(),
      title: z.string(),
      subtitle: z.string(),
      summary: z.string(),
      capturedAt: z.string().datetime({ offset: true }),
      wordCount: z.number().int().nonnegative(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dateLabel: z.string(),
      keyword: z.string(),
      topTags: z.array(z.string()),
    }),
  ),
  similarityEdges: z.array(
    z.object({
      sourceThoughtId: z.string(),
      targetThoughtId: z.string(),
      weight: nonNegativeNumber,
    }),
  ),
  topicSimilarities: z
    .array(
      z.object({
        sourceTopicId: z.string(),
        targetTopicId: z.string(),
        similarity: nonNegativeNumber,
      }),
    )
    .default([]),
  secondaryTopicEdges: z.array(
    z.object({
      sourceThoughtId: z.string(),
      targetTopicId: z.string(),
      relevance: nonNegativeNumber,
    }),
  ),
  time: z.object({
    timezone: z.string(),
    maxDailyWordCount: z.number().int().nonnegative(),
    days: z.array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        wordCount: z.number().int().nonnegative(),
        thoughtCount: z.number().int().nonnegative(),
        topics: z.array(
          z.object({
            topicId: z.string(),
            wordCount: z.number().int().nonnegative(),
            thoughtCount: z.number().int().nonnegative(),
          }),
        ),
      }),
    ),
  }),
  generatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type GraphSurface = "network-v2";

export async function fetchGraph(
  surface: GraphSurface = "network-v2",
): Promise<Graph> {
  const response = await backendFetch(
    `/visualizations/graph?surface=${surface}`,
  );
  if (!response.ok) {
    throw new Error(
      `Der Graph konnte nicht geladen werden (${response.status}).`,
    );
  }
  const parsedPayload = topicGraphResponseSchema.safeParse(
    await response.json(),
  );
  if (!parsedPayload.success) {
    if (__DEV__) {
      console.error(
        "Invalid visualization graph response",
        parsedPayload.error.issues,
      );
    }
    throw new Error("Der Graph enthält unerwartete Daten.");
  }
  const payload = parsedPayload.data;
  const indexById = new Map(
    payload.nodes.map((node, index) => [node.id, index]),
  );
  return {
    meta: {
      ...payload.meta,
      clusters: payload.meta.topics,
      themeThreshold:
        payload.meta.themeThreshold ??
        Math.max(5, Math.ceil(payload.meta.sourceCount * 0.03)),
    },
    clusters: payload.topics,
    nodes: payload.nodes.map((node, idx) => ({
      ...node,
      idx,
      cluster: node.primaryTopicId,
    })),
    edges: payload.similarityEdges.flatMap((edge) => {
      const source = indexById.get(edge.sourceThoughtId);
      const target = indexById.get(edge.targetThoughtId);
      return source == null || target == null
        ? []
        : [{ source, target, weight: edge.weight }];
    }),
    secondaryTopicEdges: payload.secondaryTopicEdges.flatMap((edge) => {
      const source = indexById.get(edge.sourceThoughtId);
      return source == null
        ? []
        : [
            {
              source,
              targetTopicId: edge.targetTopicId,
              relevance: edge.relevance,
            },
          ];
    }),
    topicSimilarities: payload.topicSimilarities,
    time: {
      ...payload.time,
      days: payload.time.days.map((day) => ({
        ...day,
        topics: day.topics.map((topic) => ({
          cluster: topic.topicId,
          wordCount: topic.wordCount,
          thoughtCount: topic.thoughtCount,
        })),
      })),
    },
    generatedAt: payload.generatedAt,
  };
}
