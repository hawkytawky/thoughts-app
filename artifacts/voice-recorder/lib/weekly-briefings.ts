import { z } from "zod";
import { backendFetch } from "./auth/api";

const weeklyObservationSchema = z.object({
  text: z.string().min(1),
  highlight: z.string().min(1).nullable(),
});

const weeklyQuoteSchema = z.object({
  text: z.string().min(1),
  source_thought_id: z.string().min(1),
});

const weeklyBriefingContentSchema = z.object({
  lead: z.string().min(1),
  observations: z.array(weeklyObservationSchema).min(1).max(2),
  quote: weeklyQuoteSchema.nullable(),
  nudge: z.string().min(1).nullable(),
  question: z.string().min(1),
});

const weeklyBriefingEntrySchema = z.object({
  id: z.string().min(1),
  status: z.enum(["completed", "skipped"]),
  period_start_at: z.string(),
  period_end_at: z.string(),
  local_start_date: z.string(),
  local_end_date: z.string(),
  timezone: z.string(),
  source_thought_count: z.number().int().nonnegative(),
  minimum_thought_count: z.number().int().positive(),
  generated_at: z.string().nullable(),
  content: weeklyBriefingContentSchema.nullable(),
});

const weeklyBriefingArchiveSchema = z.object({
  metrics: z.object({
    thought_count: z.number().int().nonnegative(),
    spoken_seconds: z.number().int().nonnegative(),
    active_streak_days: z.number().int().nonnegative(),
  }),
  entries: z.array(weeklyBriefingEntrySchema),
});

export type WeeklyBriefingArchive = z.infer<
  typeof weeklyBriefingArchiveSchema
>;
export type WeeklyBriefingEntry = z.infer<typeof weeklyBriefingEntrySchema>;
export type WeeklyObservation = z.infer<typeof weeklyObservationSchema>;

const MEMORY_CACHE_TTL_MS = 60_000;
const MEMORY_REQUEST_TIMEOUT_MS = 10_000;

type CachedArchive = {
  archive: WeeklyBriefingArchive;
  expiresAt: number;
};

type FetchWeeklyBriefingsOptions = {
  forceRefresh?: boolean;
  timeoutMs?: number;
};

let cachedArchive: CachedArchive | null = null;
let requestInFlight: Promise<WeeklyBriefingArchive> | null = null;

async function requestWeeklyBriefings(
  timeoutMs: number,
): Promise<WeeklyBriefingArchive> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await backendFetch("/briefings/weekly", {
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Memory hat zu lange zum Laden gebraucht.", {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(
      `Wochenbriefings konnten nicht geladen werden (${response.status}).`,
    );
  }
  const archive = weeklyBriefingArchiveSchema.parse(await response.json());
  cachedArchive = {
    archive,
    expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
  };
  return archive;
}

export async function fetchWeeklyBriefings(
  options: FetchWeeklyBriefingsOptions = {},
): Promise<WeeklyBriefingArchive> {
  if (requestInFlight) return requestInFlight;
  if (
    !options.forceRefresh &&
    cachedArchive &&
    cachedArchive.expiresAt > Date.now()
  ) {
    return cachedArchive.archive;
  }

  const request = requestWeeklyBriefings(
    options.timeoutMs ?? MEMORY_REQUEST_TIMEOUT_MS,
  );
  requestInFlight = request;
  try {
    return await request;
  } finally {
    if (requestInFlight === request) requestInFlight = null;
  }
}

export function resetWeeklyBriefingCache(): void {
  cachedArchive = null;
}
