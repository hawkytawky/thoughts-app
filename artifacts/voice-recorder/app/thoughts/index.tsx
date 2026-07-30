import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomTabBar } from "@/components/BottomTabBar";
import { DayPicker } from "@/components/DayPicker";
import {
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
} from "@/components/NoteUI";
import {
  type ThoughtCard,
  fetchNoteProcessingState,
  fetchNotesForDate,
  formatApiDate,
  formatDuration,
  retryNoteProcessing,
} from "@/lib/featured-note";
import {
  type FeedBootstrap,
  consumeFeedBootstrapPrefetch,
  loadFeedBootstrap,
  readFeedCache,
  todayKey,
  writeFeedCache,
} from "@/lib/feed-bootstrap";
import {
  type PendingThought,
  getPendingThoughts,
  markPendingThoughtProcessing,
  markPendingThoughtProcessingFailed,
  removePendingThought,
} from "@/lib/pending-thoughts";

const COLORS = {
  ink: "#1D3B4F",
  inkSoft: "#6E8A9C",
  inkFaint: "#9FB2BD",
  card: "#FFFFFF",
};

const TYPE_COLORS: Record<string, string> = {
  REFLEXION: "#8B8FA6",
  REFLECTION: "#8B8FA6",
  IDEE: "#8E9B6F",
  IDEA: "#8E9B6F",
  PROBLEM: "#B5705A",
  PLAN: "#7C918B",
  ENTSCHEIDUNG: "#7E8FA8",
  DECISION: "#7E8FA8",
};

type FeedEntry =
  | { id: string; kind: "note"; recordedAt: string; note: ThoughtCard }
  | {
      id: string;
      kind: "pending";
      recordedAt: string;
      pending: PendingThought;
    };

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    PROBLEM: "Problem",
    REFLECTION: "Reflexion",
    REFLEXION: "Reflexion",
    QUESTION: "Frage",
    IDEA: "Idee",
    IDEE: "Idee",
    TASK: "Aufgabe",
    DECISION: "Entscheidung",
    ENTSCHEIDUNG: "Entscheidung",
    OBSERVATION: "Beobachtung",
    PLAN: "Plan",
    MEMORY: "Erinnerung",
  };
  return labels[type.toUpperCase()] ?? type.toLocaleLowerCase("de-DE");
}

function categoryColor(type: string): string {
  return TYPE_COLORS[type.toUpperCase()] ?? "#8B8FA6";
}

function isTodayKey(dateKey: string): boolean {
  return dateKey === todayKey();
}

function dayKeyToDate(dateKey: string): Date {
  const date = new Date(`${dateKey}T12:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function topDate(dateKey: string): string {
  const date = dayKeyToDate(dateKey);
  const calendarDate = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
  }).format(date);
  if (isTodayKey(dateKey)) return `Heute, ${calendarDate}`;
  const weekday = new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
  }).format(date);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${calendarDate}`;
}

function sortedNotes(notes: ThoughtCard[]): ThoughtCard[] {
  return [...notes].sort((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt),
  );
}

function ThoughtCardRow({
  animateEntrance,
  note,
  onPress,
}: {
  animateEntrance: boolean;
  note: ThoughtCard;
  onPress: () => void;
}) {
  const pressed = useSharedValue(0);
  const animatedPressStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * 0.04,
    transform: [{ scale: 1 - pressed.value * 0.005 }],
  }));

  const open = useCallback(() => {
    void Haptics.selectionAsync();
    onPress();
  }, [onPress]);

  return (
    <Animated.View
      entering={
        animateEntrance
          ? FadeInDown.duration(260)
              .easing(Easing.out(Easing.cubic))
              .withInitialValues({ opacity: 0, transform: [{ translateY: 8 }] })
              .reduceMotion(ReduceMotion.System)
          : undefined
      }
      layout={LinearTransition.duration(260).reduceMotion(ReduceMotion.System)}
      style={animatedPressStyle}
    >
      <Pressable
        accessibilityLabel={`${typeLabel(note.type)}: ${note.title}, ${formatDuration(note.durationSeconds)} Minuten`}
        accessibilityRole="button"
        onPress={open}
        onPressIn={() => {
          pressed.value = withTiming(1, { duration: 120 });
        }}
        onPressOut={() => {
          pressed.value = withTiming(0, { duration: 120 });
        }}
        style={styles.card}
      >
        <View style={styles.cardTop}>
          <Text style={[styles.kind, { color: categoryColor(note.type) }]}>
            {typeLabel(note.type)}
          </Text>
          <Text style={styles.duration}>
            {formatDuration(note.durationSeconds)} min
          </Text>
        </View>
        <Text numberOfLines={3} style={styles.cardTitle}>
          {note.title}
        </Text>
      </Pressable>
    </Animated.View>
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
      <Text numberOfLines={3} style={styles.cardTitle}>
        neuer thought
      </Text>
      {failed ? (
        <View style={styles.pendingFailure}>
          <Text numberOfLines={2} style={styles.pendingError}>
            {pending.processingError}
          </Text>
          <Pressable
            accessibilityLabel="Verarbeitung erneut versuchen"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.controlPressed,
            ]}
          >
            <Ionicons name="refresh" size={14} color="#7E8FA8" />
            <Text style={styles.retryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SkeletonFeed() {
  return (
    <View style={styles.skeletonFeed}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.skeletonCard}>
          <View style={styles.skeletonMeta} />
          <View style={styles.skeletonTitle} />
          <View style={styles.skeletonTitleShort} />
        </View>
      ))}
    </View>
  );
}

export default function ThoughtsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [dayNotes, setDayNotes] = useState<Map<string, ThoughtCard[]>>(
    new Map(),
  );
  const [loadingDays, setLoadingDays] = useState<Set<string>>(new Set());
  const [failedDays, setFailedDays] = useState<Set<string>>(new Set());
  const [pendingThoughts, setPendingThoughts] = useState<PendingThought[]>([]);
  const [newNoteIds, setNewNoteIds] = useState<Set<string>>(new Set());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightDays = useRef(new Set<string>());
  const dayNotesRef = useRef(dayNotes);

  useEffect(() => {
    dayNotesRef.current = dayNotes;
  }, [dayNotes]);

  const applyBootstrap = useCallback((data: FeedBootstrap) => {
    inFlightDays.current.clear();
    setDayNotes(
      new Map(data.notes.map(([date, notes]) => [date, sortedNotes(notes)])),
    );
    setLoadingDays(new Set());
    setFailedDays(new Set());
  }, []);

  const loadInitial = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setInitialLoading(true);
      setError(null);
      try {
        const data = await (consumeFeedBootstrapPrefetch() ??
          loadFeedBootstrap());
        applyBootstrap(data);
        void writeFeedCache(data);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Unbekannter Fehler",
        );
      } finally {
        if (!silent) setInitialLoading(false);
      }
    },
    [applyBootstrap],
  );

  const loadDay = useCallback(async (date: string) => {
    if (inFlightDays.current.has(date)) return;
    inFlightDays.current.add(date);
    setLoadingDays((current) => new Set(current).add(date));
    setFailedDays((current) => {
      const next = new Set(current);
      next.delete(date);
      return next;
    });
    try {
      const { notes } = await fetchNotesForDate(date);
      setDayNotes((current) =>
        new Map(current).set(date, sortedNotes(notes)),
      );
    } catch {
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await readFeedCache();
      if (cancelled) return;
      if (cached) {
        applyBootstrap(cached);
        setInitialLoading(false);
        await loadInitial({ silent: true });
      } else {
        await loadInitial();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyBootstrap, loadInitial]);

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
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
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
              const processing = await fetchNoteProcessingState(
                thought.remotePath,
              );
              if (processing.status === "processing") {
                stillPending.push(thought);
              } else if (processing.status === "failed") {
                const failed = {
                  ...thought,
                  processingStatus: "failed" as const,
                  processingError: processing.error,
                };
                stillPending.push(failed);
                await markPendingThoughtProcessingFailed(
                  thought.id,
                  processing.error,
                );
              } else {
                completedNotes.push(processing.note);
                completedIds.push(thought.id);
              }
            } catch {
              stillPending.push(thought);
            }
          }

          if (!active) return;
          setPendingThoughts(stillPending);
          if (completedNotes.length > 0) {
            const existing = dayNotesRef.current.get(today) ?? [];
            const known = new Set(existing.map(({ relativePath }) => relativePath));
            const fresh = completedNotes.filter(
              ({ relativePath }) => !known.has(relativePath),
            );
            if (fresh.length > 0) {
              setNewNoteIds(
                (current) =>
                  new Set([
                    ...current,
                    ...fresh.map(({ relativePath }) => relativePath),
                  ]),
              );
              setDayNotes((current) => {
                const currentNotes = current.get(today) ?? [];
                const currentKnown = new Set(
                  currentNotes.map(({ relativePath }) => relativePath),
                );
                const additions = fresh.filter(
                  ({ relativePath }) => !currentKnown.has(relativePath),
                );
                if (additions.length === 0) return current;
                return new Map(current).set(
                  today,
                  sortedNotes([...additions, ...currentNotes]),
                );
              });
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

  const entries = useMemo<FeedEntry[]>(() => {
    const notes = dayNotes.get(selectedDate) ?? [];
    const result: FeedEntry[] = notes.map((note) => ({
      id: note.relativePath,
      kind: "note",
      recordedAt: note.recordedAt,
      note,
    }));

    if (isTodayKey(selectedDate)) {
      const knownPaths = new Set(notes.map(({ relativePath }) => relativePath));
      for (const pending of pendingThoughts) {
        if (pending.remotePath && knownPaths.has(pending.remotePath)) continue;
        result.push({
          id: `pending-${pending.id}`,
          kind: "pending",
          recordedAt: pending.createdAt,
          pending,
        });
      }
    }

    return result.sort((left, right) =>
      right.recordedAt.localeCompare(left.recordedAt),
    );
  }, [dayNotes, pendingThoughts, selectedDate]);

  const selectDate = useCallback(
    (date: Date) => {
      const selected = formatApiDate(date);
      setDatePickerOpen(false);
      setSelectedDate(selected);
      if (!dayNotesRef.current.has(selected)) void loadDay(selected);
    },
    [loadDay],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadDay(selectedDate);
    } finally {
      setRefreshing(false);
    }
  }, [loadDay, selectedDate]);

  const openThought = useCallback(
    (note: ThoughtCard) => {
      router.push(
        `/thoughts/detail?path=${encodeURIComponent(note.relativePath)}` as Href,
      );
    },
    [router],
  );

  const selectedLoading =
    initialLoading ||
    (loadingDays.has(selectedDate) && !dayNotes.has(selectedDate));
  const showLoadError =
    !selectedLoading &&
    entries.length === 0 &&
    (failedDays.has(selectedDate) || (error !== null && dayNotes.size === 0));

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#DBE3E8", "#E7EBEC", "#EAEDED"]}
        locations={[0, 0.46, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 2, paddingBottom: 2 },
        ]}
      >
        <Text style={styles.brand}>thoughts</Text>
        <Pressable
          accessibilityLabel={`Datum auswählen. Angezeigt wird ${topDate(selectedDate)}`}
          accessibilityRole="button"
          hitSlop={2}
          onPress={() => setDatePickerOpen(true)}
          style={({ pressed }) => [
            styles.dateButton,
            pressed && styles.controlPressed,
          ]}
        >
          <Text style={styles.topDate}>{topDate(selectedDate)}</Text>
          <Ionicons name="chevron-down" size={12} color={COLORS.inkSoft} />
        </Pressable>
      </View>

      {selectedLoading ? (
        <SkeletonFeed />
      ) : showLoadError ? (
        <View style={styles.errorState}>
          <Text style={styles.errorText}>Der Tag konnte nicht geladen werden.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadDay(selectedDate)}
            style={({ pressed }) => [
              styles.errorRetry,
              pressed && styles.controlPressed,
            ]}
          >
            <Text style={styles.errorRetryText}>Erneut versuchen</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={entries}
          initialNumToRender={12}
          keyExtractor={(item) => item.id}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          renderItem={({ item }) =>
            item.kind === "note" ? (
              <ThoughtCardRow
                animateEntrance={newNoteIds.has(item.id)}
                note={item.note}
                onPress={() => openThought(item.note)}
              />
            ) : (
              <PendingThoughtRow
                pending={item.pending}
                onRetry={() => void retryProcessing(item.pending)}
              />
            )
          }
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {isTodayKey(selectedDate)
                  ? "Noch nichts von heute."
                  : "An diesem Tag nichts aufgenommen."}
              </Text>
            </View>
          }
        />
      )}

      <BottomTabBar active="today" />
      <DayPicker
        onChange={selectDate}
        onClose={() => setDatePickerOpen(false)}
        value={dayKeyToDate(selectedDate)}
        visible={datePickerOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#E7EBEC" },
  header: {
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 18,
    letterSpacing: 0.1,
    color: COLORS.ink,
  },
  dateButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
  },
  topDate: {
    fontFamily: NOTE_SERIF,
    fontSize: 13.5,
    color: COLORS.inkSoft,
  },
  listContent: {
    flexGrow: 1,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 170,
  },
  card: {
    marginBottom: 11,
    paddingTop: 15,
    paddingHorizontal: 17,
    paddingBottom: 17,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    shadowColor: COLORS.ink,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardTop: {
    marginBottom: 5,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  kind: {
    fontFamily: NOTE_SANS,
    fontSize: 12.5,
    fontWeight: "400",
  },
  duration: {
    fontFamily: NOTE_SANS,
    fontSize: 12.5,
    color: COLORS.inkFaint,
  },
  cardTitle: {
    fontFamily: NOTE_SANS,
    fontSize: 16.5,
    fontWeight: "400",
    lineHeight: 22,
    letterSpacing: -0.13,
    color: COLORS.ink,
  },
  pendingCard: { opacity: 0.82 },
  pendingKind: {
    fontFamily: NOTE_SANS,
    fontSize: 12.5,
    color: "#7C918B",
  },
  pendingFailure: { marginTop: 8, gap: 5 },
  pendingError: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 16,
    color: COLORS.inkSoft,
  },
  retryButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  retryText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    color: "#7E8FA8",
  },
  skeletonFeed: {
    flex: 1,
    paddingTop: 18,
    paddingHorizontal: 18,
    paddingBottom: 170,
  },
  skeletonCard: {
    height: 102,
    marginBottom: 11,
    padding: 17,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.50)",
  },
  skeletonMeta: {
    width: "38%",
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(159,178,189,0.18)",
  },
  skeletonTitle: {
    width: "76%",
    height: 13,
    marginTop: 17,
    borderRadius: 6,
    backgroundColor: "rgba(159,178,189,0.16)",
  },
  skeletonTitleShort: {
    width: "48%",
    height: 13,
    marginTop: 7,
    borderRadius: 6,
    backgroundColor: "rgba(159,178,189,0.13)",
  },
  emptyState: {
    flex: 1,
    minHeight: 320,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 50,
  },
  emptyText: {
    fontFamily: "Newsreader_300Light_Italic",
    fontSize: 15,
    fontWeight: "300",
    lineHeight: 22,
    color: COLORS.inkFaint,
    textAlign: "center",
  },
  errorState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingBottom: 80,
  },
  errorText: {
    fontFamily: NOTE_SERIF,
    fontSize: 15,
    color: COLORS.inkSoft,
    textAlign: "center",
  },
  errorRetry: {
    minWidth: 120,
    minHeight: 44,
    marginTop: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  errorRetryText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    color: COLORS.inkSoft,
  },
  controlPressed: { opacity: 0.58 },
});
