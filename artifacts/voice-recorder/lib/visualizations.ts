import { backendFetch } from "@/lib/auth/api";

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
  description: string;
  status: string;
  color: string;
  textColor: string;
  count: number;
  anchorX: number;
  anchorY: number;
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
    model?: string | null;
    pipelineVersion: string;
  };
  clusters: GraphCluster[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  secondaryTopicEdges: SecondaryTopicEdge[];
  time: TimeProjection;
  generatedAt?: string | null;
};

type TopicGraphResponse = {
  meta: {
    nodes: number;
    topics: number;
    sourceCount: number;
    assignedCount: number;
    pendingThoughts: number;
    model?: string | null;
    pipelineVersion: string;
  };
  topics: GraphCluster[];
  nodes: Array<Omit<GraphNode, "idx" | "cluster">>;
  similarityEdges: Array<{
    sourceThoughtId: string;
    targetThoughtId: string;
    weight: number;
  }>;
  secondaryTopicEdges: Array<{
    sourceThoughtId: string;
    targetTopicId: string;
    relevance: number;
  }>;
  time: {
    timezone: string;
    maxDailyWordCount: number;
    days: Array<{
      date: string;
      wordCount: number;
      thoughtCount: number;
      topics: Array<{
        topicId: string;
        wordCount: number;
        thoughtCount: number;
      }>;
    }>;
  };
  generatedAt?: string | null;
};

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
  const payload = (await response.json()) as TopicGraphResponse;
  const indexById = new Map(
    payload.nodes.map((node, index) => [node.id, index]),
  );
  return {
    meta: {
      ...payload.meta,
      clusters: payload.meta.topics,
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
