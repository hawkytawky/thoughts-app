import { describe, expect, it } from "vitest";
import {
  buildNetworkPointOffsets,
  NETWORK_EDGE_MIN_SIMILARITY,
  NETWORK_MAX_EDGES_PER_THEME,
  placeNetworkLabels,
  selectNetworkOverviewEdges,
} from "./network-overview-layout";

describe("network overview layout", () => {
  it("builds deterministic organic point clouds without random point sizes", () => {
    const first = buildNetworkPointOffsets(24, 42, 0.78, 0.4, "theme-a");
    const second = buildNetworkPointOffsets(24, 42, 0.78, 0.4, "theme-a");

    expect(first).toEqual(second);
    expect(first).toHaveLength(24);
    expect(
      new Set(first.map(({ x, y }) => `${x.toFixed(2)}:${y.toFixed(2)}`)).size,
    ).toBe(24);
    const distances = first.flatMap((point, index) =>
      first
        .slice(index + 1)
        .map((other) => Math.hypot(point.x - other.x, point.y - other.y)),
    );
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(7);
  });

  it("places visible labels below their clouds without label collisions", () => {
    const labels = [
      {
        id: "left",
        cx: 90,
        cy: 140,
        radius: 25,
        width: 68,
        height: 16,
        importance: 4,
      },
      {
        id: "right",
        cx: 250,
        cy: 150,
        radius: 28,
        width: 72,
        height: 32,
        importance: 6,
      },
    ];
    const placed = placeNetworkLabels(labels, 361, 560);

    expect(placed.left.visible).toBe(true);
    expect(placed.right.visible).toBe(true);
    expect(placed.left.y - labels[0].height / 2).toBeGreaterThanOrEqual(
      labels[0].cy + labels[0].radius + 12,
    );
    expect(placed.right.y - labels[1].height / 2).toBeGreaterThanOrEqual(
      labels[1].cy + labels[1].radius + 12,
    );
  });

  it("keeps only strong real relationships and limits lines per theme", () => {
    const themeIds = ["a", "b", "c", "d"];
    const edges = selectNetworkOverviewEdges(themeIds, [
      { sourceId: "a", targetId: "b", similarity: 0.9 },
      { sourceId: "a", targetId: "c", similarity: 0.8 },
      { sourceId: "a", targetId: "d", similarity: 0.7 },
      { sourceId: "b", targetId: "c", similarity: 0.2 },
      { sourceId: "missing", targetId: "d", similarity: 1 },
    ]);

    expect(
      edges.every(
        ({ similarity }) => similarity >= NETWORK_EDGE_MIN_SIMILARITY,
      ),
    ).toBe(true);
    const degrees = new Array(themeIds.length).fill(0);
    for (const edge of edges) {
      degrees[edge.source] += 1;
      degrees[edge.target] += 1;
    }
    expect(Math.max(...degrees)).toBeLessThanOrEqual(
      NETWORK_MAX_EDGES_PER_THEME,
    );
    expect(edges).toHaveLength(2);
  });
});
