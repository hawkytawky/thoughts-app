import { backendFetch } from "@/lib/auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGraph } from "./visualizations";

vi.mock("@/lib/auth/api", () => ({
  backendFetch: vi.fn(),
}));

const backendFetchMock = vi.mocked(backendFetch);

function graphPayload() {
  return {
    meta: {
      nodes: 2,
      topics: 1,
      sourceCount: 2,
      assignedCount: 2,
      pendingThoughts: 0,
      pipelineVersion: "v2",
    },
    topics: [
      {
        id: "topic-1",
        label: "Produkt",
        description: "Produktgedanken",
        status: "stable",
        color: "#687CC4",
        textColor: "#FFFFFF",
        count: 2,
        anchorX: 0,
        anchorY: 1,
      },
    ],
    nodes: [
      {
        id: "thought-1",
        x: 0,
        y: 0,
        primaryTopicId: "topic-1",
        secondaryTopicIds: [],
        size: 1,
        type: "IDEA",
        title: "Erster Gedanke",
        subtitle: "Untertitel",
        summary: "Zusammenfassung",
        capturedAt: "2026-09-03T08:00:00+02:00",
        wordCount: 20,
        date: "2026-09-03",
        dateLabel: "3. September 2026",
        keyword: "Produkt",
        topTags: ["Produkt"],
      },
      {
        id: "thought-2",
        x: 1,
        y: 1,
        primaryTopicId: "topic-1",
        secondaryTopicIds: [],
        size: 2,
        type: "REFLECTION",
        title: "Zweiter Gedanke",
        subtitle: "Untertitel",
        summary: "Zusammenfassung",
        capturedAt: "2026-09-03T09:00:00+02:00",
        wordCount: 30,
        date: "2026-09-03",
        dateLabel: "3. September 2026",
        keyword: "Lernen",
        topTags: ["Lernen"],
      },
    ],
    similarityEdges: [
      {
        sourceThoughtId: "thought-1",
        targetThoughtId: "thought-2",
        weight: 0.8,
      },
      {
        sourceThoughtId: "missing",
        targetThoughtId: "thought-2",
        weight: 0.5,
      },
    ],
    secondaryTopicEdges: [
      {
        sourceThoughtId: "thought-1",
        targetTopicId: "topic-2",
        relevance: 0.4,
      },
    ],
    time: {
      timezone: "Europe/Berlin",
      maxDailyWordCount: 50,
      days: [
        {
          date: "2026-09-03",
          wordCount: 50,
          thoughtCount: 2,
          topics: [{ topicId: "topic-1", wordCount: 50, thoughtCount: 2 }],
        },
      ],
    },
    generatedAt: "2026-09-03T10:00:00+02:00",
  };
}

describe("fetchGraph", () => {
  beforeEach(() => {
    backendFetchMock.mockReset();
  });

  it("validates and maps the network-v2 response", async () => {
    backendFetchMock.mockResolvedValue({
      ok: true,
      json: async () => graphPayload(),
    } as Response);

    const graph = await fetchGraph();

    expect(backendFetchMock).toHaveBeenCalledWith(
      "/visualizations/graph?surface=network-v2",
    );
    expect(graph.nodes.map(({ id, idx }) => ({ id, idx }))).toEqual([
      { id: "thought-1", idx: 0 },
      { id: "thought-2", idx: 1 },
    ]);
    expect(graph.edges).toEqual([{ source: 0, target: 1, weight: 0.8 }]);
    expect(graph.secondaryTopicEdges).toEqual([
      { source: 0, targetTopicId: "topic-2", relevance: 0.4 },
    ]);
    expect(graph.topicSimilarities).toEqual([]);
    expect(graph.time.days[0].topics).toEqual([
      { cluster: "topic-1", wordCount: 50, thoughtCount: 2 },
    ]);
  });

  it("rejects a response that violates the runtime contract", async () => {
    const payload = graphPayload();
    payload.meta.nodes = -1;
    backendFetchMock.mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as Response);

    await expect(fetchGraph()).rejects.toThrow(
      "Der Graph enthält unerwartete Daten.",
    );
  });
});
