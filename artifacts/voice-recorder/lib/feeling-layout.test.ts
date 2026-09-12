import { describe, expect, it } from "vitest";
import {
  buildFeelingDistributionSegments,
  buildFeelingLayout,
  feelingColor,
  feelingDistributionShares,
  feelingPercentages,
  formatValence,
  valenceDotColor,
  valenceTextColor,
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
    expect(layout.distributionShares).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(layout.swarmPoints.map(({ id }) => id).sort()).toEqual(
      layout.flowPoints.map(({ id }) => id).sort(),
    );
    expect(layout.thoughtIdsByDate["2026-09-06"]).toEqual(["positive"]);
    expect(layout.startDate).toBe("2026-08-31");
    expect(layout.endDate).toBe("2026-09-06");
  });

  it("calculates the actual share of all three feeling areas", () => {
    const thoughts = [
      ...Array.from({ length: 2 }, (_, index) =>
        thought(`negative-${index}`, "2026-09-04", -0.8),
      ),
      ...Array.from({ length: 3 }, (_, index) =>
        thought(`neutral-${index}`, "2026-09-05", 0),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        thought(`positive-${index}`, "2026-09-06", 0.8),
      ),
    ];

    expect(feelingPercentages(thoughts)).toEqual([20, 30, 50]);
    expect(feelingDistributionShares(thoughts)).toEqual([0.2, 0.3, 0.5]);
  });

  it("uses counts rather than word weights for distribution shares", () => {
    const thoughts = [
      thought("long-negative", "2026-09-04", -0.8, 5000),
      thought("short-neutral", "2026-09-05", 0, 1),
      thought("short-positive-a", "2026-09-06", 0.8, 1),
      thought("short-positive-b", "2026-09-06", 0.9, 1),
    ];

    expect(feelingDistributionShares(thoughts)).toEqual([0.25, 0.25, 0.5]);
    expect(feelingPercentages(thoughts)).toEqual([25, 25, 50]);
  });

  it("sizes distribution segments from unrounded shares with fixed gaps", () => {
    const segments = buildFeelingDistributionSegments(349, [0.2, 0.3, 0.5]);

    expect(segments[0].startX).toBe(8);
    expect(segments[0].endX - segments[0].startX).toBeCloseTo(65.4);
    expect(segments[1].startX - segments[0].endX).toBe(3);
    expect(segments[1].endX - segments[1].startX).toBeCloseTo(98.1);
    expect(segments[2].startX - segments[1].endX).toBe(3);
    expect(segments[2].endX - segments[2].startX).toBeCloseTo(163.5);
    expect(segments[2].endX).toBeCloseTo(341);
  });

  it("keeps the threshold values in the neutral area", () => {
    const thoughts = [
      thought("below", "2026-09-04", -0.251),
      thought("lower-bound", "2026-09-04", -0.25),
      thought("zero", "2026-09-05", 0),
      thought("upper-bound", "2026-09-05", 0.25),
      thought("above", "2026-09-06", 0.251),
    ];

    expect(feelingPercentages(thoughts)).toEqual([20, 60, 20]);
  });

  it("uses equal opacity so valence alone determines point color", () => {
    const layout = buildFeelingLayout(
      [
        thought("older-high", "2026-09-01", 0.8),
        thought("newer-low", "2026-09-06", 0.6),
      ],
      "week",
      349,
      TODAY,
    );

    expect(layout.swarmPoints.map(({ alpha }) => alpha)).toEqual([0.9, 0.9]);
    expect(layout.flowPoints.map(({ alpha }) => alpha)).toEqual([0.72, 0.72]);
  });

  it("stacks equal backend values in symmetric columns", () => {
    const thoughts = [
      thought("repeated-a", "2026-09-06", 0.82),
      thought("repeated-b", "2026-09-06", 0.82),
      thought("repeated-c", "2026-09-06", 0.82),
    ];
    const layout = buildFeelingLayout(thoughts, "week", 349, TODAY);

    expect(layout.swarmPoints.map(({ valence }) => valence)).toEqual([
      0.82, 0.82, 0.82,
    ]);
    expect(new Set(layout.swarmPoints.map(({ x }) => x)).size).toBe(1);
    expect(layout.swarmPoints.map(({ y }) => y)).toEqual([
      62,
      62 + 3.6 * 2.05,
      62 - 3.6 * 2.05,
    ]);
    expect(layout.percentages).toEqual([0, 0, 100]);
  });

  it("keeps both charts structurally empty when no valence exists", () => {
    const layout = buildFeelingLayout([], "all", 349, TODAY);

    expect(layout.swarmPoints).toEqual([]);
    expect(layout.flowPoints).toEqual([]);
    expect(layout.flowSamples).toEqual([]);
    expect(layout.monthLabels).toEqual([]);
    expect(layout.monthBoundaries).toEqual([]);
    expect(layout.distributionShares).toEqual([0, 0, 0]);
  });

  it("extends the complete timeline through today", () => {
    const layout = buildFeelingLayout(
      [thought("latest", "2026-09-01", 0.4)],
      "all",
      349,
      TODAY,
    );

    expect(layout.endDate).toBe("2026-09-06");
    expect(layout.flowSamples.at(-1)?.date).toBe("2026-09-06");
    expect(layout.dayValues["2026-09-06"]).toBeCloseTo(0.4);
    expect(layout.flowPoints[0].x).toBeLessThan(349 - 8);
  });

  it("marks each new month without adding a label for today", () => {
    const layout = buildFeelingLayout(
      [thought("start", "2026-08-08", 0.2)],
      "month",
      349,
      TODAY,
    );

    expect(layout.monthLabels.map(({ label }) => label)).toEqual([
      "Aug",
      "Sep",
    ]);
    expect(layout.monthBoundaries).toHaveLength(1);
    expect(layout.monthBoundaries[0]).toBeCloseTo(8 + (24 / 29) * 333);
  });
});

describe("valence chip", () => {
  const channels = (color: string) =>
    color
      .replace(/rgb\(|\)/g, "")
      .split(",")
      .map((part) => Number(part.trim()));

  it("formats with a German decimal comma and an explicit sign", () => {
    expect(formatValence(0.48)).toBe("+0,48");
    expect(formatValence(-0.62)).toBe("\u22120,62");
    expect(formatValence(-0.05)).toBe("\u22120,05");
  });

  it("never renders a negative zero", () => {
    expect(formatValence(0)).toBe("+0,00");
  });

  it("clamps values outside the backend range", () => {
    expect(formatValence(1.4)).toBe("+1,00");
    expect(formatValence(-3)).toBe("\u22121,00");
  });

  it("keeps a near-zero dot visible instead of fading into grey", () => {
    // Without the floor a 0.02 valence would be indistinguishable from MID.
    expect(valenceDotColor(0.02)).not.toBe(feelingColor(0.02));
    expect(channels(valenceDotColor(0.02))).not.toEqual([190, 198, 205]);
  });

  it("tints negative rose and positive sage", () => {
    // ROSE and SAGE share a blue channel, so red and green carry the contrast.
    const [negR, negG] = channels(valenceDotColor(-0.8));
    const [posR, posG] = channels(valenceDotColor(0.8));
    expect(negR).toBeGreaterThan(posR);
    expect(negG).toBeLessThan(posG);
  });

  it("darkens the label so it stays readable on the field", () => {
    const dot = channels(valenceDotColor(0.48));
    const text = channels(valenceTextColor(0.48));
    text.forEach((value, index) => {
      expect(value).toBeLessThan(dot[index]);
    });
  });
});
