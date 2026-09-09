import { backendFetch } from "@/lib/auth/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchWeeklyBriefings,
  resetWeeklyBriefingCache,
} from "./weekly-briefings";

vi.mock("@/lib/auth/api", () => ({
  backendFetch: vi.fn(),
}));

const backendFetchMock = vi.mocked(backendFetch);

function archivePayload() {
  return {
    metrics: {
      thought_count: 12,
      spoken_seconds: 720,
      active_streak_days: 3,
    },
    entries: [],
  };
}

function successfulResponse(): Response {
  return {
    ok: true,
    json: async () => archivePayload(),
  } as Response;
}

describe("fetchWeeklyBriefings", () => {
  beforeEach(() => {
    backendFetchMock.mockReset();
    resetWeeklyBriefingCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses a fresh in-memory response without another request", async () => {
    backendFetchMock.mockResolvedValue(successfulResponse());

    const first = await fetchWeeklyBriefings();
    const second = await fetchWeeklyBriefings();

    expect(first).toEqual(archivePayload());
    expect(second).toBe(first);
    expect(backendFetchMock).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent requests", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    backendFetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );

    const first = fetchWeeklyBriefings();
    const second = fetchWeeklyBriefings();
    resolveResponse?.(successfulResponse());

    await expect(first).resolves.toEqual(archivePayload());
    await expect(second).resolves.toEqual(archivePayload());
    expect(backendFetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit refresh after cached data was shown", async () => {
    backendFetchMock.mockResolvedValue(successfulResponse());

    await fetchWeeklyBriefings();
    await fetchWeeklyBriefings({ forceRefresh: true });

    expect(backendFetchMock).toHaveBeenCalledTimes(2);
  });

  it("aborts a request that exceeds the Memory latency budget", async () => {
    vi.useFakeTimers();
    backendFetchMock.mockImplementation((_path, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });

    const request = expect(
      fetchWeeklyBriefings({ timeoutMs: 100 }),
    ).rejects.toThrow("Memory hat zu lange zum Laden gebraucht.");
    await vi.advanceTimersByTimeAsync(100);

    await request;
  });
});
