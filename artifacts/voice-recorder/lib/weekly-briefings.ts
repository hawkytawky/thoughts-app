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

export async function fetchWeeklyBriefings(): Promise<WeeklyBriefingArchive> {
  const response = await backendFetch("/briefings/weekly");
  if (!response.ok) {
    throw new Error(
      `Wochenbriefings konnten nicht geladen werden (${response.status}).`,
    );
  }
  return weeklyBriefingArchiveSchema.parse(await response.json());
}
