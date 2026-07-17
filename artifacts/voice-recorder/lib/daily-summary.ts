const API_URL = process.env.EXPO_PUBLIC_THOUGHTS_UPLOAD_URL?.replace(
  /\/+$/,
  "",
);

export type DailyCluster = {
  title: string;
  description: string;
  thought_ids: string[];
};

export type DailyQuestion = {
  question: string;
  category:
    | "decision"
    | "experiment"
    | "research"
    | "identity"
    | "action"
    | string;
};

export type DailySummary = {
  date: string;
  summary: string;
  clusters: DailyCluster[];
  reflective_comment: string;
  open_questions: DailyQuestion[];
  closing_question: string;
  legacy_direction?: string;
  legacy_continuation?: string;
};

type DailySummaryPayload = Omit<
  DailySummary,
  "closing_question" | "legacy_direction" | "legacy_continuation"
> & {
  closing_question?: string;
  direction?: string;
  continuation?: {
    type: string;
    text: string;
  };
};

export type DailyAnalytics = {
  date: string;
  thought_count: number;
  word_count: number;
  recording_duration_seconds: number;
  thought_types: Record<string, number>;
  top_tags: { tag: string; count: number }[];
  open_questions_count: number;
  decisions_count: number;
};

type DailySummaryResponse = {
  ok: boolean;
  daily?: DailySummaryPayload | null;
  analytics?: DailyAnalytics | null;
  error?: string;
};

function normalizeDailySummary(
  daily: DailySummaryPayload | null | undefined,
): DailySummary | null {
  if (!daily) return null;
  const { direction, continuation, ...current } = daily;
  return {
    ...current,
    closing_question: daily.closing_question?.trim() ?? "",
    ...(direction ? { legacy_direction: direction } : {}),
    ...(continuation?.text
      ? { legacy_continuation: continuation.text }
      : {}),
  };
}

export async function fetchDailyOverview(
  date: string,
): Promise<{
  daily: DailySummary | null;
  analytics: DailyAnalytics | null;
}> {
  if (!API_URL) throw new Error("daily API URL is not configured");
  const response = await fetch(
    `${API_URL}/daily?date=${encodeURIComponent(date)}`,
    { headers: { Accept: "application/json" } },
  );
  const body = (await response.json()) as DailySummaryResponse;
  if (!response.ok || !body.ok) {
    throw new Error(
      body.error ?? `daily summary request failed (${response.status})`,
    );
  }
  return {
    daily: normalizeDailySummary(body.daily),
    analytics: body.analytics ?? null,
  };
}

export async function fetchDailySummary(
  date: string,
): Promise<DailySummary | null> {
  return (await fetchDailyOverview(date)).daily;
}

export function formatDailyDate(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00`));
}
