import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  let value: string | null = null;
  return {
    getItem: vi.fn(async () => value),
    setItem: vi.fn(async (_key: string, next: string) => {
      value = next;
    }),
    reset() {
      value = null;
      this.getItem.mockClear();
      this.setItem.mockClear();
    },
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: storage.getItem,
    setItem: storage.setItem,
  },
}));

describe("pending thoughts", () => {
  beforeEach(() => {
    vi.resetModules();
    storage.reset();
  });

  it("serializes concurrent additions without losing a thought", async () => {
    const { addPendingThought, getPendingThoughts } =
      await import("./pending-thoughts");

    await Promise.all([
      addPendingThought({
        id: "first",
        createdAt: "2026-09-04T08:00:00Z",
        durationSeconds: 12,
        locationLabel: "Berlin",
      }),
      addPendingThought({
        id: "second",
        createdAt: "2026-09-04T09:00:00Z",
        durationSeconds: 20,
        locationLabel: "Hamburg",
      }),
    ]);

    expect((await getPendingThoughts()).map(({ id }) => id)).toEqual([
      "second",
      "first",
    ]);
  });

  it("marks an uploaded thought as processing", async () => {
    const {
      addPendingThought,
      getPendingThoughts,
      markPendingThoughtUploaded,
    } = await import("./pending-thoughts");

    await addPendingThought({
      id: "local-file",
      createdAt: "2026-09-04T08:00:00Z",
      durationSeconds: 12,
      locationLabel: "Berlin",
    });
    await markPendingThoughtUploaded("local-file", "recording-id");

    expect(await getPendingThoughts()).toEqual([
      expect.objectContaining({
        id: "local-file",
        remotePath: "recording-id",
        processingStatus: "processing",
      }),
    ]);
  });

  it("recovers safely from malformed local storage", async () => {
    storage.getItem.mockResolvedValueOnce("not-json");
    const { getPendingThoughts } = await import("./pending-thoughts");

    await expect(getPendingThoughts()).resolves.toEqual([]);
  });
});
