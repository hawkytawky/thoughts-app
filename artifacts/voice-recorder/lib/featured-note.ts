import { backendFetch } from "@/lib/auth";

const API_TIMEZONE = "Europe/Berlin";

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
        : (body.detail?.map(({ msg }) => msg).filter(Boolean).join(", ") ?? "");
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
      (recording.transcript?.trim().split(/\s+/).filter(Boolean).length ?? 0),
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

export async function retryNoteProcessing(
  recordingId: string,
): Promise<void> {
  const response = await backendFetch(
    `/recordings/${recordingId}/retry`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
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
