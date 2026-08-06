import { backendFetch } from "@/lib/auth/api";

export type GraphNode = {
  id: string;
  idx: number;
  x: number;
  y: number;
  cluster: number;
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
  id: number;
  label: string;
  description?: string | null;
  color: string;
  textColor: string;
  count: number;
};

export type GraphEdge = { source: number; target: number; weight: number };

export type TimeTopicVolume = {
  cluster: number;
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
  meta: { nodes: number; clusters: number; model?: string | null };
  clusters: GraphCluster[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  time: TimeProjection;
  generatedAt?: string | null;
};

export type GraphSurface = "network" | "base" | "time";

export async function fetchGraph(
  surface: GraphSurface = "network",
): Promise<Graph> {
  const response = await backendFetch(
    `/visualizations/graph?surface=${surface}`,
  );
  if (!response.ok) {
    throw new Error(
      `Der Graph konnte nicht geladen werden (${response.status}).`,
    );
  }
  return (await response.json()) as Graph;
}
