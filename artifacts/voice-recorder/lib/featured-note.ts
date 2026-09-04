import { backendFetch } from "@/lib/auth";

export const API_TIMEZONE = "Europe/Berlin";

const apiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: API_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

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

type RecordingStatus =
  | "awaiting_upload"
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "summarizing"
  | "completed"
  | "transcription_failed"
  | "summary_failed";

type BackendThoughtCard = {
  type: string;
  title: string;
  subtitle: string;
  tags: string[];
  summary: string;
  key_points: string[];
  open_questions: string[];
  decisions: string[];
  next_steps: string[];
  people: string[];
  projects: string[];
  mentioned_locations: string[];
};

type BackendRecording = {
  recording_id: string;
  status: RecordingStatus;
  captured_at: string;
  city: string | null;
  suburb: string | null;
  transcript: string | null;
  transcript_locale: string | null;
  duration_ms: number | null;
  word_count: number | null;
  transcript_segments: {
    start_ms: number;
    end_ms: number;
    text: string;
  }[];
  thought_card: BackendThoughtCard | null;
};

export type NoteProcessingState =
  | { status: "processing" }
  | { status: "failed"; error: string }
  | { status: "ready"; note: FeaturedNote };

type ThoughtDaysResponse = {
  month: string;
  days: { date: string; recording_count: number }[];
};

export type ThoughtDayCount = {
  date: string;
  count: number;
};

async function apiError(response: Response): Promise<Error> {
  let detail = "";
  try {
    const body = (await response.json()) as {
      detail?: string | { msg?: string }[];
    };
    detail =
      typeof body.detail === "string"
        ? body.detail
        : (body.detail
            ?.map(({ msg }) => msg)
            .filter(Boolean)
            .join(", ") ?? "");
  } catch {
    // The HTTP status remains useful when the response has no JSON body.
  }
  return new Error(detail || `thought API request failed (${response.status})`);
}

function locationLabel(recording: BackendRecording): string {
  return (
    [recording.city, recording.suburb].filter(Boolean).join(", ") ||
    "Ohne Standort"
  );
}

function toFeaturedNote(recording: BackendRecording): FeaturedNote | null {
  const card = recording.thought_card;
  if (recording.status !== "completed" || !card) return null;

  return {
    id: recording.recording_id,
    relativePath: recording.recording_id,
    type: card.type,
    title: card.title,
    subtitle: card.subtitle,
    tags: card.tags,
    summary: card.summary,
    keyPoints: card.key_points,
    openQuestions: card.open_questions,
    decisions: card.decisions,
    nextSteps: card.next_steps,
    people: card.people,
    projects: card.projects,
    mentionedLocations: card.mentioned_locations,
    recordedAt: recording.captured_at,
    locationStatus:
      recording.city || recording.suburb ? "captured" : "unavailable",
    location: null,
    locationLabel: locationLabel(recording),
    durationSeconds: Math.max(0, (recording.duration_ms ?? 0) / 1_000),
    wordCount:
      recording.word_count ??
      recording.transcript?.trim().split(/\s+/).filter(Boolean).length ??
      0,
    audioBytes: 0,
    transcript: {
      text: recording.transcript?.trim() ?? "",
      language: recording.transcript_locale ?? "de-DE",
      segments: recording.transcript_segments.map((segment) => ({
        start: segment.start_ms / 1_000,
        end: segment.end_ms / 1_000,
        text: segment.text.trim(),
      })),
    },
  };
}

function toThoughtCard(note: FeaturedNote): ThoughtCard {
  return {
    id: note.id,
    relativePath: note.relativePath,
    type: note.type,
    title: note.title,
    subtitle: note.subtitle,
    tags: note.tags,
    recordedAt: note.recordedAt,
    locationStatus: note.locationStatus,
    locationLabel: note.locationLabel,
    durationSeconds: note.durationSeconds,
  };
}

export async function fetchNoteProcessingState(
  recordingId: string,
): Promise<NoteProcessingState> {
  const response = await backendFetch(`/recordings/${recordingId}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await apiError(response);
  const recording = (await response.json()) as BackendRecording;
  const note = toFeaturedNote(recording);
  if (note) return { status: "ready", note };
  if (
    recording.status === "transcription_failed" ||
    recording.status === "summary_failed"
  ) {
    return {
      status: "failed",
      error:
        recording.status === "transcription_failed"
          ? "Die Transkription ist fehlgeschlagen."
          : "Die Zusammenfassung ist fehlgeschlagen.",
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

export async function retryNoteProcessing(recordingId: string): Promise<void> {
  const response = await backendFetch(`/recordings/${recordingId}/retry`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw await apiError(response);
}

export async function deleteThought(recordingId: string): Promise<void> {
  const response = await backendFetch(
    `/recordings/${encodeURIComponent(recordingId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) throw await apiError(response);
}

export async function fetchNotesForDate(
  date: string,
): Promise<{ notes: ThoughtCard[]; processingCount: number }> {
  const response = await backendFetch(
    `/recordings?date=${encodeURIComponent(date)}&timezone=${encodeURIComponent(API_TIMEZONE)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw await apiError(response);
  const recordings = (await response.json()) as BackendRecording[];
  const notes = recordings
    .map(toFeaturedNote)
    .filter((note): note is FeaturedNote => note !== null)
    .map(toThoughtCard);
  return {
    notes,
    processingCount: recordings.length - notes.length,
  };
}

export async function fetchThoughtDayCounts(
  month: string,
): Promise<ThoughtDayCount[]> {
  const response = await backendFetch(
    `/recordings/calendar?month=${encodeURIComponent(month)}&timezone=${encodeURIComponent(API_TIMEZONE)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw await apiError(response);
  const body = (await response.json()) as ThoughtDaysResponse;
  return body.days
    .filter(({ recording_count }) => recording_count > 0)
    .map(({ date, recording_count }) => ({ date, count: recording_count }));
}

export async function fetchThoughtDays(month: string): Promise<Set<string>> {
  const days = await fetchThoughtDayCounts(month);
  return new Set(days.map(({ date }) => date));
}

// Hermes (React Native's engine) fails to parse ISO timestamps with microsecond
// precision (6 fractional digits) and some timezone-offset forms that the
// backend emits, returning an Invalid Date. Parse the components explicitly so
// it works the same on device and web.
export function parseApiTimestamp(value: string): Date {
  const raw = (value ?? "").trim();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/.exec(
      raw,
    );
  if (!match) return new Date(raw);
  const [, y, mo, d, h, mi, s, frac, zulu, sign, oh, om] = match;
  const ms = frac ? Number(frac.slice(0, 3).padEnd(3, "0")) : 0;
  let epoch = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
    ms,
  );
  if (!zulu && sign) {
    const offsetMinutes =
      (Number(oh) * 60 + Number(om)) * (sign === "-" ? -1 : 1);
    epoch -= offsetMinutes * 60_000;
  }
  return new Date(epoch);
}

export function formatApiDate(date: Date): string {
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const parts = apiDateFormatter.formatToParts(safe);
  const year = parts.find(({ type }) => type === "year")?.value;
  const month = parts.find(({ type }) => type === "month")?.value;
  const day = parts.find(({ type }) => type === "day")?.value;
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

export function apiDateKeyFromTimestamp(value: string): string {
  return formatApiDate(parseApiTimestamp(value));
}

export function shiftApiDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return formatApiDate(new Date());
  const [, year, month, day] = match;
  const shifted = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day) + days, 12),
  );
  return shifted.toISOString().slice(0, 10);
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
  }).format(parseApiTimestamp(isoDate));
}

export function formatNoteDay(isoDate: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(parseApiTimestamp(isoDate));
}
