const API_URL = process.env.EXPO_PUBLIC_THOUGHTS_UPLOAD_URL?.replace(
  /\/+$/,
  "",
);

export type NoteLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  capturedAt: string;
  city?: string | null;
  suburb?: string | null;
};

export type NoteTranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type FeaturedNote = {
  id: string;
  relativePath: string;
  type: string;
  title: string;
  subtitle: string;
  tags: string[];
  summary: string;
  keyPoints: string[];
  openQuestions: string[];
  decisions: string[];
  nextSteps: string[];
  people: string[];
  projects: string[];
  mentionedLocations: string[];
  recordedAt: string;
  locationStatus: "captured" | "disabled" | "unavailable";
  location: NoteLocation | null;
  locationLabel: string;
  durationSeconds: number;
  wordCount: number;
  audioBytes: number;
  transcript: {
    text: string;
    language: string;
    segments: NoteTranscriptSegment[];
  };
};

export type ThoughtCard = Pick<
  FeaturedNote,
  | "id"
  | "relativePath"
  | "type"
  | "title"
  | "subtitle"
  | "tags"
  | "recordedAt"
  | "locationStatus"
  | "locationLabel"
  | "durationSeconds"
>;

type NoteStatusResponse = {
  ok: boolean;
  status?: "processing" | "ready" | "failed";
  note?: FeaturedNote;
  error?: string;
};

export type NoteProcessingState =
  | { status: "processing" }
  | { status: "failed"; error: string }
  | { status: "ready"; note: FeaturedNote };

type NotesForDateResponse = {
  ok: boolean;
  date?: string;
  notes?: ThoughtCard[];
  processingCount?: number;
  error?: string;
};

type ThoughtDaysResponse = {
  ok: boolean;
  month?: string;
  days?: { date: string; count: number }[];
  error?: string;
};

export async function fetchNoteProcessingState(
  relativePath: string,
): Promise<NoteProcessingState> {
  if (!API_URL) throw new Error("thought API URL is not configured");
  const response = await fetch(
    `${API_URL}/notes/status?path=${encodeURIComponent(relativePath)}`,
    { headers: { Accept: "application/json" } },
  );
  const body = (await response.json()) as NoteStatusResponse;
  if (!response.ok || !body.ok) {
    throw new Error(
      body.error ?? `thought status request failed (${response.status})`,
    );
  }
  if (body.status === "ready" && body.note) {
    return { status: "ready", note: body.note };
  }
  if (body.status === "failed") {
    return {
      status: "failed",
      error: body.error ?? "Die Verarbeitung ist fehlgeschlagen.",
    };
  }
  return { status: "processing" };
}

export async function fetchNoteStatus(
  relativePath: string,
): Promise<FeaturedNote | null> {
  const state = await fetchNoteProcessingState(relativePath);
  return state.status === "ready" ? state.note : null;
}

export async function retryNoteProcessing(
  relativePath: string,
): Promise<void> {
  if (!API_URL) throw new Error("thought API URL is not configured");
  const response = await fetch(
    `${API_URL}/notes/retry?path=${encodeURIComponent(relativePath)}`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  );
  const body = (await response.json()) as NoteStatusResponse;
  if (!response.ok || !body.ok) {
    throw new Error(
      body.error ?? `thought retry request failed (${response.status})`,
    );
  }
}

export async function fetchNotesForDate(
  date: string,
): Promise<{ notes: ThoughtCard[]; processingCount: number }> {
  if (!API_URL) throw new Error("thought API URL is not configured");
  const response = await fetch(
    `${API_URL}/notes?date=${encodeURIComponent(date)}`,
    { headers: { Accept: "application/json" } },
  );
  const body = (await response.json()) as NotesForDateResponse;
  if (!response.ok || !body.ok || !body.notes) {
    throw new Error(body.error ?? `thoughts request failed (${response.status})`);
  }
  return {
    notes: body.notes,
    processingCount: body.processingCount ?? 0,
  };
}

export async function fetchThoughtDays(month: string): Promise<Set<string>> {
  if (!API_URL) throw new Error("thought API URL is not configured");
  const response = await fetch(
    `${API_URL}/notes/days?month=${encodeURIComponent(month)}`,
    { headers: { Accept: "application/json" } },
  );
  const body = (await response.json()) as ThoughtDaysResponse;
  if (!response.ok || !body.ok || !body.days) {
    throw new Error(
      body.error ?? `thought days request failed (${response.status})`,
    );
  }
  return new Set(
    body.days.filter(({ count }) => count > 0).map(({ date }) => date),
  );
}

export function formatApiDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function formatTimestamp(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function formatNoteDate(isoDate: string, includeYear = false): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
    ...(includeYear ? { year: "numeric" as const } : {}),
  }).format(new Date(isoDate));
}

export function formatNoteDay(isoDate: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(isoDate));
}
