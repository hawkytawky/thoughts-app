import { backendFetch } from "@/lib/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteThought,
  fetchNotesForDate,
  fetchThoughtDayCounts,
  formatApiDate,
  formatNoteDate,
  updateThoughtCard,
} from "./featured-note";

vi.mock("@/lib/auth", () => ({
  backendFetch: vi.fn(),
}));

const backendFetchMock = vi.mocked(backendFetch);

const completedRecording = {
  recording_id: "recording/id",
  status: "completed",
  captured_at: "2026-09-04T05:38:00+02:00",
  city: null,
  suburb: null,
  transcript: "Ein Test schafft Klarheit.",
  transcript_locale: "de-DE",
  duration_ms: 1000,
  word_count: 4,
  transcript_segments: [],
  thought_card: {
    type: "REFLECTION",
    title: "Ein Test schafft Klarheit",
    subtitle: "Ein begrenzter Versuch reduziert Unsicherheit.",
    tags: ["Produkt", "Lernen", "Fokus"],
    summary: "Eigene Zusammenfassung.",
    key_points: ["Erster Punkt."],
    open_questions: [],
    decisions: [],
    next_steps: [],
    people: [],
    projects: [],
    mentioned_locations: [],
  },
};

describe("thought actions", () => {
  beforeEach(() => {
    backendFetchMock.mockReset();
  });

  it("deletes a thought through the authenticated recordings API", async () => {
    backendFetchMock.mockResolvedValue({ ok: true, status: 204 } as Response);

    await deleteThought("recording/id");

    expect(backendFetchMock).toHaveBeenCalledWith(
      "/recordings/recording%2Fid",
      { method: "DELETE" },
    );
  });

  it("surfaces the backend error when deletion fails", async () => {
    backendFetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Recording not found" }),
    } as Response);

    await expect(deleteThought("missing")).rejects.toThrow(
      "Recording not found",
    );
  });

  it("sends manual card edits as a snake_case patch", async () => {
    backendFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => completedRecording,
    } as Response);

    const note = await updateThoughtCard("recording/id", {
      summary: "Eigene Zusammenfassung.",
      keyPoints: ["Erster Punkt."],
    });

    expect(backendFetchMock).toHaveBeenCalledWith(
      "/recordings/recording%2Fid/thought-card",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          summary: "Eigene Zusammenfassung.",
          key_points: ["Erster Punkt."],
        }),
      }),
    );
    expect(note.summary).toBe("Eigene Zusammenfassung.");
    expect(note.keyPoints).toEqual(["Erster Punkt."]);
  });

  it("omits fields the editor did not touch", async () => {
    backendFetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => completedRecording,
    } as Response);

    await updateThoughtCard("id", { keyPoints: [] });

    expect(backendFetchMock.mock.calls[0][1]?.body).toBe(
      JSON.stringify({ key_points: [] }),
    );
  });

  it("surfaces the backend error when an edit is rejected", async () => {
    backendFetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ detail: "Recording has no Thought Card yet" }),
    } as Response);

    await expect(
      updateThoughtCard("id", { summary: "Zu früh." }),
    ).rejects.toThrow("Recording has no Thought Card yet");
  });

  it("uses the device timezone for day and calendar requests", async () => {
    backendFetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ days: [] }),
      } as Response);

    await fetchNotesForDate("2026-09-04", "America/Los_Angeles");
    await fetchThoughtDayCounts("2026-09", "America/Los_Angeles");

    expect(backendFetchMock).toHaveBeenNthCalledWith(
      1,
      "/recordings?date=2026-09-04&timezone=America%2FLos_Angeles",
      { headers: { Accept: "application/json" } },
    );
    expect(backendFetchMock).toHaveBeenNthCalledWith(
      2,
      "/recordings/calendar?month=2026-09&timezone=America%2FLos_Angeles",
      { headers: { Accept: "application/json" } },
    );
  });

  it("creates calendar keys in the device timezone", () => {
    const timestamp = new Date("2026-09-04T00:30:00Z");

    expect(formatApiDate(timestamp, "America/Los_Angeles")).toBe("2026-09-03");
    expect(formatApiDate(timestamp, "Asia/Tokyo")).toBe("2026-09-04");
  });

  it("includes the year in the detail metadata date", () => {
    expect(formatNoteDate("2026-09-04T05:38:00+02:00", true)).toBe(
      "4. September 2026",
    );
  });
});
