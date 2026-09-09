import { describe, expect, it } from "vitest";
import {
  mergeThoughtDays,
  replaceThoughtMonth,
  thoughtDaysFromCounts,
} from "./thought-calendar";

describe("thought calendar markers", () => {
  it("turns positive bootstrap counts into marked calendar days", () => {
    expect(
      [...
        thoughtDaysFromCounts([
          ["2026-09-02", 1],
          ["2026-09-03", 0],
          ["2026-09-08", 3],
        ]),
      ],
    ).toEqual(["2026-09-02", "2026-09-08"]);
  });

  it("keeps cached markers while a newly visited month is merged", () => {
    const merged = mergeThoughtDays(
      new Set(["2026-09-08"]),
      new Set(["2026-08-11", "2026-08-27"]),
    );

    expect([...merged]).toEqual([
      "2026-09-08",
      "2026-08-11",
      "2026-08-27",
    ]);
  });

  it("ignores malformed date keys", () => {
    expect([...mergeThoughtDays(new Set(), ["September 8", "2026-09-08"])]).toEqual([
      "2026-09-08",
    ]);
  });

  it("replaces one authoritative month without losing other months", () => {
    const replaced = replaceThoughtMonth(
      new Set(["2026-08-27", "2026-09-02", "2026-09-08"]),
      "2026-09",
      new Set(["2026-09-08", "2026-09-14"]),
    );

    expect([...replaced]).toEqual([
      "2026-08-27",
      "2026-09-08",
      "2026-09-14",
    ]);
  });
});