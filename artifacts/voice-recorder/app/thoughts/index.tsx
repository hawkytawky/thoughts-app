import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  type SectionList as SectionListType,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DayPicker } from "@/components/DayPicker";
import { AppMenuGlyph, AppSidebar } from "@/components/AppSidebar";
import {
  NOTE_CATEGORY_TEXT_OPACITY,
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
  NOTE_SERIF_ITALIC,
  NoteError,
  noteCategoryColor,
} from "@/components/NoteUI";
import {
  type ThoughtCard,
  fetchNoteProcessingState,
  fetchNotesForDate,
  fetchThoughtDayCounts,
  formatApiDate,
  formatDuration,
  retryNoteProcessing,
} from "@/lib/featured-note";
import {
  type PendingThought,
  getPendingThoughts,
  markPendingThoughtProcessing,
  markPendingThoughtProcessingFailed,
  removePendingThought,
} from "@/lib/pending-thoughts";
import { useActiveRecording } from "@/lib/active-recording";

// How many empty months in a row we tolerate before assuming there is no
// older history left to page through.
const MAX_EMPTY_HISTORY_MONTHS = 4;

type TimelineEntry =
  | {
      id: string;
      kind: "note";
      recordedAt: string;
      note: ThoughtCard;
    }
  | {
      id: string;
      kind: "pending";
      recordedAt: string;
      pending: PendingThought;
    }
  | {
      id: string;
      kind: "loading";
      recordedAt: string;
    }
  | {
      id: string;
      kind: "day-row";
      date: string;
      count: number;
      expanded: boolean;
    };

type DaySection = {
  kind: "day";
  date: string;
  count: number;
  expanded: boolean;
  data: TimelineEntry[];
};

type MonthSection = {
  kind: "month";
  month: string;
  count: number;
  data: TimelineEntry[];
};

type TimelineSection = DaySection | MonthSection;

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    PROBLEM: "Problem",
    REFLECTION: "Reflexion",
    QUESTION: "Frage",
    IDEA: "Idee",
    TASK: "Aufgabe",
    DECISION: "Entscheidung",
    OBSERVATION: "Beobachtung",
    PLAN: "Plan",
    MEMORY: "Erinnerung",
  };
  return labels[type] ?? type.toLocaleLowerCase("de-DE");
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function isToday(date: Date): boolean {
  return formatApiDate(date) === formatApiDate(new Date());
}

function isYesterday(date: Date): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return formatApiDate(date) === formatApiDate(yesterday);
}

function dayKeyToDate(dateKey: string): Date {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function dayHeading(dateKey: string): string {
  const date = startOfDay(dayKeyToDate(dateKey));
  if (isToday(date)) return "Heute";
  if (isYesterday(date)) return "Gestern";
  const label = new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(
    date,
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function dayDate(dateKey: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(dayKeyToDate(dateKey));
}

function monthHeading(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1, 1);
  const label = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
  }).format(date);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function topDate(dateKey: string): string {
  const date = dayKeyToDate(dateKey);
  const formatted = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
  }).format(date);
  if (isToday(date)) return `Heute, ${formatted}`;
  return `${dayHeading(dateKey)}, ${formatted}`;
}

function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function previousMonth(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function todayKey(): string {
  return formatApiDate(new Date());
}

function yesterdayKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatApiDate(date);
}

// Merge the two months we always want counts for so `yesterday` is covered
// even when it falls into the previous calendar month.
function initialMonths(): [string, string] {
  const current = monthKey(todayKey());
  return [current, previousMonth(current)];
}

function noteEntries(notes: ThoughtCard[]): TimelineEntry[] {
  return notes.map((note) => ({
    id: note.relativePath,
    kind: "note",
    recordedAt: note.recordedAt,
    note,
  }));
}

function pendingEntries(
  pendingThoughts: PendingThought[],
  knownPaths: Set<string>,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const pending of pendingThoughts) {
    if (pending.remotePath && knownPaths.has(pending.remotePath)) continue;
    entries.push({
      id: `pending-${pending.id}`,
      kind: "pending",
      recordedAt: pending.createdAt,
      pending,
    });
  }
  return entries;
}

function buildSections({
  dayCounts,
  dayNotes,
  expandedDays,
  filterDate,
  loadingDays,
  openMonths,
  pendingThoughts,
}: {
  dayCounts: Map<string, number>;
  dayNotes: Map<string, ThoughtCard[]>;
  expandedDays: Set<string>;
  filterDate: string | null;
  loadingDays: Set<string>;
  openMonths: Set<string>;
  pendingThoughts: PendingThought[];
}): TimelineSection[] {
  const today = todayKey();
  const yesterday = yesterdayKey();
  // Today and yesterday always get their own row; everything older is
  // grouped by month until the user drills into a specific month.
  const pinnedDays = new Set([today, yesterday]);

  // Every day the calendar knows about, plus today/yesterday so they always
  // have a home even before their first thought exists.
  const dayKeys = new Set<string>([today, yesterday, ...dayCounts.keys()]);
  const pendingForToday = pendingThoughts.filter(
    (pending) => formatApiDate(new Date(pending.createdAt)) === today,
  );

  function buildDaySection(date: string): DaySection {
    const notes = dayNotes.get(date) ?? [];
    const expanded = expandedDays.has(date);
    const includePending = date === today && pendingForToday.length > 0;
    const pendingCount = includePending
      ? pendingEntries(
          pendingForToday,
          new Set(notes.map(({ relativePath }) => relativePath)),
        ).length
      : 0;
    const count = Math.max(
      dayCounts.get(date) ?? 0,
      notes.length + pendingCount,
    );

    let data: TimelineEntry[] = [];
    if (expanded) {
      data = noteEntries(notes);
      if (includePending) {
        data = [
          ...data,
          ...pendingEntries(
            pendingForToday,
            new Set(notes.map(({ relativePath }) => relativePath)),
          ),
        ];
      }
      data.sort((left, right) => {
        const leftTime = "recordedAt" in left ? left.recordedAt : "";
        const rightTime = "recordedAt" in right ? right.recordedAt : "";
        return rightTime.localeCompare(leftTime);
      });
      if (data.length === 0 && loadingDays.has(date)) {
        data = [{ id: `loading-${date}`, kind: "loading", recordedAt: date }];
      }
    }

    return { kind: "day", date, count, expanded, data };
  }

  // Date filter narrows the whole feed to the single picked day.
  if (filterDate) return [buildDaySection(filterDate)];

  const pinnedSections = [...pinnedDays]
    .sort((left, right) => right.localeCompare(left))
    .map(buildDaySection)
    .filter(
      (section) =>
        section.count > 0 || section.date === today || section.expanded,
    );

  // Only days with thoughts get a home in a month group; empty calendar
  // days elsewhere don't need to exist as far as the feed is concerned.
  const olderDayKeys = [...dayKeys]
    .filter((date) => !pinnedDays.has(date) && (dayCounts.get(date) ?? 0) > 0)
    .sort((left, right) => right.localeCompare(left));

  const monthGroups = new Map<string, string[]>();
  for (const date of olderDayKeys) {
    const month = monthKey(date);
    const group = monthGroups.get(month) ?? [];
    group.push(date);
    monthGroups.set(month, group);
  }

  const monthSections: MonthSection[] = [...monthGroups.keys()]
    .sort((left, right) => right.localeCompare(left))
    .map((month) => {
      const days = monthGroups.get(month) ?? [];
      const count = days.reduce(
        (sum, date) => sum + (dayCounts.get(date) ?? 0),
        0,
      );
      // An open month lists its days only. Nothing is fetched until a day
      // is tapped — that is what keeps opening a month instant.
      const data: TimelineEntry[] = [];
      if (openMonths.has(month)) {
        for (const date of days) {
          const expanded = expandedDays.has(date);
          data.push({
            id: `day-${date}`,
            kind: "day-row",
            date,
            count: dayCounts.get(date) ?? 0,
            expanded,
          });
          if (!expanded) continue;
          const notes = dayNotes.get(date);
          if (notes) {
            data.push(...noteEntries(notes));
          } else {
            data.push({
              id: `loading-${date}`,
              kind: "loading",
              recordedAt: date,
            });
          }
        }
      }
      return { kind: "month", month, count, data };
    });

  return [...pinnedSections, ...monthSections];
}

function ThoughtCardRow({
  note,
  onPress,
}: {
  note: ThoughtCard;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`${typeLabel(note.type)}: ${note.title}, ${formatDuration(note.durationSeconds)} Minuten`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        <Text
          style={[styles.kind, { color: noteCategoryColor(note.type) }]}
        >
          {typeLabel(note.type)}
        </Text>
        <Text style={styles.duration}>
          {formatDuration(note.durationSeconds)} min
        </Text>
      </View>
      <Text numberOfLines={2} style={styles.cardTitle}>
        {note.title}
      </Text>
    </Pressable>
  );
}

function PendingThoughtRow({
  pending,
  onRetry,
}: {
  pending: PendingThought;
  onRetry: () => void;
}) {
  const failed = pending.processingStatus === "failed";
  return (
    <View style={[styles.card, styles.pendingCard]}>
      <View style={styles.cardTop}>
        <Text style={styles.pendingKind}>
          {failed
            ? "Verarbeitung fehlgeschlagen"
            : pending.remotePath
              ? "wird verarbeitet…"
              : "wird übertragen…"}
        </Text>
        <Text style={styles.duration}>
          {formatDuration(pending.durationSeconds)} min
        </Text>
      </View>
      <Text style={styles.cardTitle}>neuer thought</Text>
      {failed && (
        <View style={styles.pendingFailure}>
          <Text numberOfLines={2} style={styles.pendingError}>
            {pending.processingError}
          </Text>
          <Pressable
            accessibilityLabel="Verarbeitung erneut versuchen"
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons name="refresh" size={13} color={C.plum} />
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// One row shape for every day in the feed — the pinned Today/Yesterday
// sections and the days listed inside an open month both render this.
function DayRow({
  count,
  date,
  expanded,
  nested = false,
  onToggle,
}: {
  count: number;
  date: string;
  expanded: boolean;
  nested?: boolean;
  onToggle: () => void;
}) {
  const countLabel = count === 1 ? "1 thought" : `${count} thoughts`;
  return (
    <Pressable
      accessibilityLabel={`${dayHeading(date)}, ${dayDate(date)}, ${countLabel}. ${expanded ? "Zum Einklappen tippen" : "Zum Aufklappen tippen"}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.dayHeader,
        nested && styles.dayHeaderNested,
        pressed && styles.dayHeaderPressed,
      ]}
    >
      <Ionicons
        name={expanded ? "chevron-down" : "chevron-forward"}
        size={12}
        color={C.ink40}
        style={styles.dayChevron}
      />
      <Text style={styles.dayName}>{dayHeading(date)}</Text>
      <Text style={styles.dayDate}>{dayDate(date)}</Text>
      {count > 0 && <Text style={styles.dayCount}>{countLabel}</Text>}
    </Pressable>
  );
}

function MonthHeader({
  section,
  onToggle,
}: {
  section: MonthSection;
  onToggle: () => void;
}) {
  const countLabel =
    section.count === 1 ? "1 thought" : `${section.count} thoughts`;
  return (
    <Pressable
      accessibilityLabel={`${monthHeading(section.month)}, ${countLabel}. Zum Aufklappen tippen`}
      accessibilityRole="button"
      accessibilityState={{ expanded: false }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.monthHeader,
        pressed && styles.dayHeaderPressed,
      ]}
    >
      <Ionicons
        name="chevron-forward"
        size={12}
        color={C.ink40}
        style={styles.dayChevron}
      />
      <Text style={styles.monthName}>{monthHeading(section.month)}</Text>
      <Text style={styles.dayCount}>{countLabel}</Text>
    </Pressable>
  );
}

export default function ThoughtsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const listRef = useRef<SectionListType<TimelineEntry, TimelineSection>>(null);
  const [dayCounts, setDayCounts] = useState<Map<string, number>>(new Map());
  const [dayNotes, setDayNotes] = useState<Map<string, ThoughtCard[]>>(
    new Map(),
  );
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [openMonths, setOpenMonths] = useState<Set<string>>(new Set());
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [loadingDays, setLoadingDays] = useState<Set<string>>(new Set());
  const [failedDays, setFailedDays] = useState<Set<string>>(new Set());
  const [pendingThoughts, setPendingThoughts] = useState<PendingThought[]>([]);
  const [visibleDate, setVisibleDate] = useState(todayKey());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against duplicate fetches for the same day / month across renders.
  const inFlightDays = useRef(new Set<string>());
  const oldestMonthLoaded = useRef<string | null>(null);
  const emptyHistoryMonths = useRef(0);
  const historyExhausted = useRef(false);
  // Snapshot of loaded notes so the focus effect can dedupe without re-subscribing.
  const dayNotesRef = useRef(dayNotes);
  useEffect(() => {
    dayNotesRef.current = dayNotes;
  }, [dayNotes]);

  const sections = useMemo(
    () =>
      buildSections({
        dayCounts,
        dayNotes,
        expandedDays,
        filterDate,
        loadingDays,
        openMonths,
        pendingThoughts,
      }),
    [
      dayCounts,
      dayNotes,
      expandedDays,
      filterDate,
      loadingDays,
      openMonths,
      pendingThoughts,
    ],
  );

  const loadDay = useCallback(async (date: string) => {
    if (inFlightDays.current.has(date)) return;
    inFlightDays.current.add(date);
    setLoadingDays((current) => new Set(current).add(date));
    setFailedDays((current) => {
      if (!current.has(date)) return current;
      const next = new Set(current);
      next.delete(date);
      return next;
    });
    try {
      const { notes } = await fetchNotesForDate(date);
      setDayNotes((current) => new Map(current).set(date, notes));
      setDayCounts((current) => {
        // Keep the header count honest once we know the real note total.
        if ((current.get(date) ?? 0) >= notes.length) return current;
        return new Map(current).set(date, notes.length);
      });
    } catch {
      // Leave the day unloaded; the placeholder becomes a retry affordance.
      setFailedDays((current) => new Set(current).add(date));
    } finally {
      inFlightDays.current.delete(date);
      setLoadingDays((current) => {
        const next = new Set(current);
        next.delete(date);
        return next;
      });
    }
  }, []);

  const loadInitial = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setInitialLoading(true);
    setError(null);
    const today = todayKey();
    const yesterday = yesterdayKey();
    const [currentMonth, prevMonth] = initialMonths();
    try {
      const [currentCounts, prevCounts, todayNotes, yesterdayNotes] =
        await Promise.all([
          fetchThoughtDayCounts(currentMonth),
          fetchThoughtDayCounts(prevMonth),
          fetchNotesForDate(today),
          fetchNotesForDate(yesterday),
        ]);

      const counts = new Map<string, number>();
      for (const { date, count } of [...currentCounts, ...prevCounts]) {
        counts.set(date, count);
      }
      const notes = new Map<string, ThoughtCard[]>();
      notes.set(today, todayNotes.notes);
      notes.set(yesterday, yesterdayNotes.notes);

      oldestMonthLoaded.current = prevMonth;
      emptyHistoryMonths.current = 0;
      historyExhausted.current = false;
      inFlightDays.current.clear();

      setDayCounts(counts);
      setDayNotes(notes);
      setExpandedDays(new Set([today, yesterday]));
      setLoadingDays(new Set());
      setFailedDays(new Set());
      setVisibleDate(today);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unbekannter Fehler",
      );
    } finally {
      if (!silent) setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMoreHistory = useCallback(async () => {
    if (loadingMore || historyExhausted.current) return;
    const oldest = oldestMonthLoaded.current;
    if (!oldest) return;
    const target = previousMonth(oldest);
    setLoadingMore(true);
    try {
      const monthCounts = await fetchThoughtDayCounts(target);
      oldestMonthLoaded.current = target;
      if (monthCounts.length === 0) {
        emptyHistoryMonths.current += 1;
        if (emptyHistoryMonths.current >= MAX_EMPTY_HISTORY_MONTHS) {
          historyExhausted.current = true;
        }
      } else {
        emptyHistoryMonths.current = 0;
        setDayCounts((current) => {
          const next = new Map(current);
          for (const { date, count } of monthCounts) next.set(date, count);
          return next;
        });
      }
    } catch {
      // Stop paging on error; a pull-to-refresh can recover.
      historyExhausted.current = true;
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadInitial({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadInitial]);

  const toggleDay = useCallback(
    (date: string) => {
      setExpandedDays((current) => {
        const next = new Set(current);
        if (next.has(date)) {
          next.delete(date);
        } else {
          next.add(date);
          if (!dayNotes.has(date)) void loadDay(date);
        }
        return next;
      });
    },
    [dayNotes, loadDay],
  );

  const toggleMonth = useCallback((month: string) => {
    setOpenMonths((current) => {
      const next = new Set(current);
      if (next.has(month)) next.delete(month);
      else next.add(month);
      return next;
    });
  }, []);

  const retryProcessing = useCallback(async (thought: PendingThought) => {
    if (!thought.remotePath) return;
    setPendingThoughts((current) =>
      current.map((item) =>
        item.id === thought.id
          ? {
              ...item,
              processingStatus: "processing",
              processingError: undefined,
            }
          : item,
      ),
    );
    await markPendingThoughtProcessing(thought.id);
    try {
      await retryNoteProcessing(thought.remotePath);
    } catch (retryError) {
      const message =
        retryError instanceof Error
          ? retryError.message
          : "Die Verarbeitung konnte nicht neu gestartet werden.";
      await markPendingThoughtProcessingFailed(thought.id, message);
      setPendingThoughts((current) =>
        current.map((item) =>
          item.id === thought.id
            ? {
                ...item,
                processingStatus: "failed",
                processingError: message,
              }
            : item,
        ),
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let refreshingPending = false;
      let timer: ReturnType<typeof setInterval> | undefined;
      const today = todayKey();

      const refreshProcessing = async () => {
        if (refreshingPending) return;
        refreshingPending = true;
        try {
          const pending = await getPendingThoughts();
          const stillPending: PendingThought[] = [];
          const completedNotes: ThoughtCard[] = [];
          const completedIds: string[] = [];

          for (const thought of pending) {
            if (!thought.remotePath || thought.processingStatus === "failed") {
              stillPending.push(thought);
              continue;
            }
            try {
              const state = await fetchNoteProcessingState(thought.remotePath);
              if (state.status === "processing") {
                stillPending.push(thought);
              } else if (state.status === "failed") {
                const failed = {
                  ...thought,
                  processingStatus: "failed" as const,
                  processingError: state.error,
                };
                stillPending.push(failed);
                await markPendingThoughtProcessingFailed(
                  thought.id,
                  state.error,
                );
              } else {
                completedNotes.push(state.note);
                completedIds.push(thought.id);
              }
            } catch {
              stillPending.push(thought);
            }
          }

          if (!active) return;
          setPendingThoughts(stillPending);
          if (completedNotes.length > 0) {
            // Newly processed thoughts belong to today's (expanded) section.
            const existing = dayNotesRef.current.get(today) ?? [];
            const known = new Set(
              existing.map(({ relativePath }) => relativePath),
            );
            const fresh = completedNotes.filter(
              ({ relativePath }) => !known.has(relativePath),
            );
            if (fresh.length > 0) {
              setDayNotes((current) => {
                const currentNotes = current.get(today) ?? [];
                const currentKnown = new Set(
                  currentNotes.map(({ relativePath }) => relativePath),
                );
                const add = fresh.filter(
                  ({ relativePath }) => !currentKnown.has(relativePath),
                );
                if (add.length === 0) return current;
                return new Map(current).set(today, [...add, ...currentNotes]);
              });
              setDayCounts((current) =>
                new Map(current).set(
                  today,
                  (current.get(today) ?? 0) + fresh.length,
                ),
              );
            }
          }
          for (const id of completedIds) await removePendingThought(id);
        } finally {
          refreshingPending = false;
        }
      };

      void refreshProcessing().then(() => {
        if (active && pendingThoughts.length > 0) {
          timer = setInterval(() => void refreshProcessing(), 2_500);
        }
      });
      return () => {
        active = false;
        if (timer) clearInterval(timer);
      };
    }, [pendingThoughts.length]),
  );

  const selectDate = useCallback(
    async (date: Date) => {
      const selected = formatApiDate(date);
      setDatePickerOpen(false);
      setVisibleDate(selected);
      setFilterDate(selected);
      setExpandedDays((current) => new Set(current).add(selected));
      if (!dayNotesRef.current.has(selected)) await loadDay(selected);
    },
    [loadDay],
  );

  const clearFilter = useCallback(() => {
    setFilterDate(null);
    setVisibleDate(todayKey());
  }, []);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
    minimumViewTime: 80,
  }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { section?: TimelineSection }[] }) => {
      const first = viewableItems.find((entry) => entry.section)?.section;
      if (first?.kind === "day") setVisibleDate(first.date);
    },
  ).current;

  const openThought = useCallback(
    (note: ThoughtCard) => {
      router.push(
        `/thoughts/detail?path=${encodeURIComponent(note.relativePath)}` as Href,
      );
    },
    [router],
  );

  const openRecorder = useCallback(() => {
    if (activeRecording.active) router.dismissTo("/record" as Href);
    else router.push("/record" as Href);
  }, [activeRecording.active, router]);

  if (error && dayNotes.size === 0) {
    return (
      <NoteError
        message={error}
        onRecord={openRecorder}
        onRetry={() => void loadInitial()}
      />
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <View style={styles.brandGroup}>
            <Pressable
              accessibilityLabel="Menü öffnen"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setSidebarOpen(true)}
              style={({ pressed }) => [
                styles.menuButton,
                pressed && styles.controlPressed,
              ]}
            >
              <AppMenuGlyph />
            </Pressable>
            <Text style={styles.brand}>thoughts</Text>
          </View>
          <View style={styles.dateGroup}>
            <Pressable
              accessibilityLabel={`Datum auswählen. Angezeigt wird ${topDate(visibleDate)}`}
              accessibilityRole="button"
              onPress={() => setDatePickerOpen(true)}
              style={({ pressed }) => [
                styles.dateButton,
                filterDate != null && styles.dateButtonActive,
                pressed && styles.controlPressed,
              ]}
            >
              <Text
                style={[
                  styles.topDate,
                  filterDate != null && styles.topDateActive,
                ]}
              >
                {topDate(visibleDate)}
              </Text>
              <Ionicons name="chevron-down" size={11} color={C.ink60} />
            </Pressable>
            {filterDate != null && (
              <Pressable
                accessibilityLabel="Datumsfilter aufheben"
                accessibilityRole="button"
                hitSlop={10}
                onPress={clearFilter}
                style={({ pressed }) => [
                  styles.clearFilter,
                  pressed && styles.controlPressed,
                ]}
              >
                <Ionicons name="close" size={13} color={C.ink60} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {initialLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={C.sky} size="small" />
        </View>
      ) : (
        <SectionList
          ref={listRef}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 92 },
          ]}
          initialNumToRender={12}
          keyExtractor={(item) => item.id}
          onEndReached={() => {
            if (!filterDate) void loadMoreHistory();
          }}
          onEndReachedThreshold={0.5}
          onRefresh={() => void refresh()}
          onScrollToIndexFailed={() => {
            // Section may still be measuring; the next viewability pass recovers.
          }}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshing={refreshing}
          renderItem={({ item }) => {
            if (item.kind === "note") {
              return (
                <ThoughtCardRow
                  note={item.note}
                  onPress={() => openThought(item.note)}
                />
              );
            }
            if (item.kind === "pending") {
              return (
                <PendingThoughtRow
                  pending={item.pending}
                  onRetry={() => void retryProcessing(item.pending)}
                />
              );
            }
            if (item.kind === "day-row") {
              return (
                <DayRow
                  count={item.count}
                  date={item.date}
                  expanded={item.expanded}
                  nested
                  onToggle={() => toggleDay(item.date)}
                />
              );
            }
            const failed = failedDays.has(item.recordedAt);
            return (
              <Pressable
                accessibilityRole="button"
                disabled={!failed}
                onPress={() => void loadDay(item.recordedAt)}
                style={styles.dayLoading}
              >
                {failed ? (
                  <Text style={styles.dayLoadError}>
                    Laden fehlgeschlagen — erneut versuchen
                  </Text>
                ) : (
                  <ActivityIndicator color={C.sky} size="small" />
                )}
              </Pressable>
            );
          }}
          renderSectionFooter={() => <View style={styles.sectionFooter} />}
          renderSectionHeader={({ section }) =>
            section.kind === "month" ? (
              <MonthHeader
                onToggle={() => toggleMonth(section.month)}
                section={section}
              />
            ) : (
              <DayRow
                count={section.count}
                date={section.date}
                expanded={section.expanded}
                onToggle={() => toggleDay(section.date)}
              />
            )
          }
          sections={sections}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>
                {filterDate
                  ? `Keine thoughts am ${dayDate(filterDate)}`
                  : "Noch keine thoughts"}
              </Text>
            </View>
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator
                color={C.sky}
                size="small"
                style={styles.footerLoading}
              />
            ) : null
          }
          viewabilityConfig={viewabilityConfig}
        />
      )}

      <LinearGradient
        pointerEvents="none"
        colors={["rgba(249,249,248,0)", C.paper]}
        style={[styles.bottomFade, { height: insets.bottom + 64 }]}
      />

      {!activeRecording.active && (
        <Pressable
          accessibilityLabel="Neue Aufnahme starten"
          accessibilityRole="button"
          onPress={openRecorder}
          style={({ pressed }) => [
            styles.recordButtonOuter,
            { bottom: insets.bottom + 6 },
            pressed && styles.recordButtonPressed,
          ]}
        >
          <View style={styles.recordButtonGlass}>
            <Ionicons name="mic" size={20} color={C.card} />
          </View>
        </Pressable>
      )}

      <DayPicker
        onChange={(date) => void selectDate(date)}
        onClose={() => setDatePickerOpen(false)}
        value={new Date(`${visibleDate}T12:00:00`)}
        visible={datePickerOpen}
      />
      <AppSidebar
        active="thoughts"
        insets={insets}
        onClose={() => setSidebarOpen(false)}
        onOpen={() => setSidebarOpen(true)}
        visible={sidebarOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  header: { backgroundColor: C.paper, paddingHorizontal: 20 },
  topBar: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandGroup: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  menuButton: {
    width: 20,
    height: 40,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0.08,
    color: C.ink,
  },
  dateGroup: { flexDirection: "row", alignItems: "center", gap: 2 },
  dateButton: {
    minHeight: 40,
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dateButtonActive: {
    paddingLeft: 10,
    paddingRight: 8,
    minHeight: 28,
    borderRadius: 14,
    backgroundColor: C.skyLight,
  },
  topDateActive: { color: C.ink },
  clearFilter: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  topDate: {
    fontFamily: NOTE_SERIF,
    fontSize: 13,
    lineHeight: 17,
    color: C.ink60,
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 20 },
  dayHeader: {
    minHeight: 36,
    marginHorizontal: -3,
    paddingHorizontal: 3,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(249,249,248,0.96)",
  },
  dayHeaderPressed: { opacity: 0.6 },
  dayChevron: { marginRight: -2 },
  dayName: {
    fontFamily: NOTE_SERIF_ITALIC,
    fontSize: 13,
    lineHeight: 17,
    color: C.ink70,
  },
  dayDate: {
    fontFamily: NOTE_SANS,
    fontSize: 10,
    lineHeight: 14,
    color: C.ink30,
  },
  dayCount: {
    marginLeft: "auto",
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.2,
    color: C.ink40,
  },
  dayLoading: { paddingVertical: 14, alignItems: "center" },
  // Days listed inside an open month sit one step in from the month row.
  dayHeaderNested: { paddingLeft: 17, backgroundColor: "transparent" },
  dayLoadError: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    color: C.ink40,
  },
  monthHeader: {
    minHeight: 40,
    marginHorizontal: -3,
    paddingHorizontal: 3,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(249,249,248,0.96)",
  },
  monthName: {
    fontFamily: NOTE_SERIF,
    fontSize: 13,
    lineHeight: 17,
    color: C.ink70,
  },
  sectionFooter: { height: 2 },
  card: {
    marginBottom: 8,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D4E2EC",
    borderRadius: 11,
    backgroundColor: C.card,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.055,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  cardTop: {
    marginBottom: 4,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  kind: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.275,
    opacity: NOTE_CATEGORY_TEXT_OPACITY,
  },
  duration: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 15,
    color: C.ink30,
  },
  cardTitle: {
    fontFamily: NOTE_SANS,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: -0.075,
    color: C.ink,
  },
  pendingCard: { opacity: 0.82 },
  pendingKind: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 10,
    lineHeight: 14,
    color: C.slate,
  },
  pendingFailure: { marginTop: 8, gap: 5 },
  pendingError: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 16,
    color: C.ink40,
  },
  retryButton: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  retryText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 10,
    color: C.plum,
  },
  controlPressed: { opacity: 0.58 },
  emptyState: { alignItems: "center", paddingVertical: 54 },
  emptyTitle: {
    fontFamily: NOTE_SERIF,
    fontSize: 16,
    color: C.ink60,
  },
  footerLoading: { marginVertical: 18 },
  recordButtonOuter: {
    position: "absolute",
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    shadowColor: C.ink,
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  recordButtonGlass: {
    flex: 1,
    borderRadius: 26,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.ink,
  },
  bottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
  },
  recordButtonPressed: { transform: [{ scale: 0.95 }], opacity: 0.86 },
});
