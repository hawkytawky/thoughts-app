import { describe, expect, it } from "vitest";
import {
  buildFeelingLayout,
  feelingColor,
  weightedFeelingMean,
  type FeelingThought,
} from "./feeling-layout";

const TODAY = new Date("2026-09-06T12:00:00Z");

function thought(
  id: string,
  date: string,
  valence: number,
  wordCount = 100,
): FeelingThought {
  return {
    id,
    date,
    valence,
    wordCount,
    title: `Thought ${id}`,
    themeLabel: "Test",
  };
}

describe("feeling layout", () => {
  it("uses the exact diverging valence colors", () => {
    expect(feelingColor(-1)).toBe("rgb(201,126,132)");
    expect(feelingColor(0)).toBe("rgb(190,198,205)");
    expect(feelingColor(1)).toBe("rgb(118,160,132)");
  });

  it("caps transcript weight at 600 words", () => {
    const value = weightedFeelingMean([
      thought("long", "2026-09-06", 1, 3000),
      thought("short-a", "2026-09-06", -1, 100),
      thought("short-b", "2026-09-06", -1, 100),
    ]);

    expect(value).toBeCloseTo(0.5);
  });

  it("builds matching swarm and flow points with stable percentages", () => {
    const thoughts = [
      thought("negative", "2026-09-04", -0.8),
      thought("neutral", "2026-09-05", 0),
      thought("positive", "2026-09-06", 0.8),
    ];
    const layout = buildFeelingLayout(thoughts, "week", 349, TODAY);

    expect(layout.percentages).toEqual([33, 33, 33]);
    expect(layout.percentages.reduce((sum, value) => sum + value, 0)).toBe(99);
    expect(layout.swarmPoints.map(({ id }) => id).sort()).toEqual(
      layout.flowPoints.map(({ id }) => id).sort(),
    );
    expect(layout.thoughtIdsByDate["2026-09-06"]).toEqual(["positive"]);
    expect(layout.startDate).toBe("2026-08-31");
    expect(layout.endDate).toBe("2026-09-06");
  });

  it("keeps both charts structurally empty when no valence exists", () => {
    const layout = buildFeelingLayout([], "all", 349, TODAY);

    expect(layout.swarmPoints).toEqual([]);
    expect(layout.flowPoints).toEqual([]);
    expect(layout.flowSamples).toEqual([]);
    expect(layout.monthLabels).toEqual([]);
  });
});
