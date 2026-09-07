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
  valence: number | null;
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
      valence: z.number().finite().min(-1).max(1).nullable().default(null),
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
  generatedAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export type GraphSurface = "network-v2";

export async function fetchGraph(
  surface: GraphSurface = "network-v2",
): Promise<Graph> {
  const refresh = Date.now();
  const response = await backendFetch(
    `/visualizations/graph?surface=${surface}&refresh=${refresh}`,
    { cache: "no-store" },
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
    generatedAt: payload.generatedAt,
  };
}
