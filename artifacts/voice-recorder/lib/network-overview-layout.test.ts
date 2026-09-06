import { describe, expect, it } from "vitest";
import {
  buildNetworkPointOffsets,
  NETWORK_LABEL_GAP,
  placeNetworkLabels,
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
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(5.3);
  });

  it("creates a denser core and irregular loose edge", () => {
    const points = buildNetworkPointOffsets(56, 46, 0.8, 0.3, "density");
    const withRadius = points
      .map((point) => ({ ...point, radius: Math.hypot(point.x, point.y) }))
      .sort((left, right) => left.radius - right.radius);
    const nearestDistance = (point: (typeof withRadius)[number]) =>
      Math.min(
        ...withRadius
          .filter((other) => other !== point)
          .map((other) => Math.hypot(point.x - other.x, point.y - other.y)),
      );
    const core = withRadius.slice(0, 14).map(nearestDistance);
    const edge = withRadius.slice(-14).map(nearestDistance);

    expect(
      core.reduce((sum, value) => sum + value, 0) / core.length,
    ).toBeLessThan(edge.reduce((sum, value) => sum + value, 0) / edge.length);
    expect(
      new Set(points.map(({ x, y }) => `${x.toFixed(1)}:${y.toFixed(1)}`)).size,
    ).toBe(points.length);
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
    expect(placed.left.y - labels[0].height / 2).toBe(
      placed.left.centerY + labels[0].radius + NETWORK_LABEL_GAP,
    );
    expect(placed.right.y - labels[1].height / 2).toBe(
      placed.right.centerY + labels[1].radius + NETWORK_LABEL_GAP,
    );
  });

  it("repositions crowded clusters so every initial label remains visible", () => {
    const labels = Array.from({ length: 6 }, (_, index) => ({
      id: `theme-${index}`,
      cx: 150 + (index % 3) * 20,
      cy: 170 + Math.floor(index / 3) * 24,
      radius: 18 + (index % 2) * 3,
      cloudLeft: -19,
      cloudRight: 20,
      cloudTop: -17,
      cloudBottom: 18,
      width: 72 + (index % 2) * 12,
      height: index % 3 === 0 ? 32 : 16,
      importance: 10 - index,
    }));
    const placed = placeNetworkLabels(labels, 361, 560, 48, 438, 0.7);
    const rects = labels.map((label) => {
      const placement = placed[label.id];
      expect(placement.visible).toBe(true);
      expect(placement.y - label.height / 2).toBe(
        placement.centerY +
          (label.cloudBottom ?? label.radius) +
          NETWORK_LABEL_GAP,
      );
      return {
        left: placement.x - label.width / 2,
        right: placement.x + label.width / 2,
        top: placement.y - label.height / 2,
        bottom: placement.y + label.height / 2,
      };
    });
    for (let left = 0; left < rects.length; left += 1) {
      for (let right = left + 1; right < rects.length; right += 1) {
        const overlaps =
          rects[left].left < rects[right].right + 4 &&
          rects[left].right + 4 > rects[right].left &&
          rects[left].top < rects[right].bottom + 4 &&
          rects[left].bottom + 4 > rects[right].top;
        expect(overlaps).toBe(false);
      }
    }
  });
});
