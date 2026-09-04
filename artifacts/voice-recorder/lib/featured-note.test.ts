import { backendFetch } from "@/lib/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteThought, formatNoteDate } from "./featured-note";

vi.mock("@/lib/auth", () => ({
  backendFetch: vi.fn(),
}));

const backendFetchMock = vi.mocked(backendFetch);

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

  it("includes the year in the detail metadata date", () => {
    expect(formatNoteDate("2026-09-04T05:38:00+02:00", true)).toBe(
      "4. September 2026",
    );
  });
});
