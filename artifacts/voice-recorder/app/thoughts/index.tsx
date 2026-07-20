import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DayPicker } from "@/components/DayPicker";
import { ThoughtFilterPicker } from "@/components/ThoughtFilterPicker";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_ITALIC,
  NOTE_SANS_MEDIUM,
  NOTE_SANS_SEMIBOLD,
  NOTE_SERIF,
  NOTE_SERIF_ITALIC,
  NoteError,
  NoteLoading,
  NOTE_CATEGORY_TEXT_OPACITY,
  noteCategoryColor,
} from "@/components/NoteUI";
import {
  type ThoughtCard,
  fetchNotesForDate,
  fetchNoteProcessingState,
  formatApiDate,
  formatDuration,
  formatNoteDay,
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

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    PROBLEM: "Problem",
    REFLECTION: "Reflexion",
    QUESTION: "Frage",
    IDEA: "Idee",
    TASK: "Aufgabe",
    DECISION: "Entscheidung",
    OBSERVATION: "Beobachtung",
  };
  return labels[type] ?? type.toLocaleLowerCase("de-DE");
}

const FILTER_OPTIONS = [
  { label: "Ideen", type: "IDEA" },
  { label: "Fragen", type: "QUESTION" },
  { label: "Reflexionen", type: "REFLECTION" },
  { label: "Entscheidungen", type: "DECISION" },
] as const;

function isToday(date: Date): boolean {
  return formatApiDate(date) === formatApiDate(new Date());
}

function feedDateLabel(date: Date): string {
  const formatted = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
  }).format(date);
  return isToday(date)
    ? `Heute, ${formatted}`
    : formatNoteDay(date.toISOString());
}

function cardTimeLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function shiftDay(date: Date, offset: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + offset,
    12,
  );
}

export default function ThoughtsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const [feedDate, setFeedDate] = useState(() => new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [notes, setNotes] = useState<ThoughtCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingThoughts, setPendingThoughts] = useState<PendingThought[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastDaySwipeAt = useRef(0);
  const dayTransitionActiveRef = useRef(false);
  const dayOpacity = useRef(new Animated.Value(1)).current;
  const notesByDateRef = useRef(new Map<string, ThoughtCard[]>());
  const feedScrollRef = useRef<ScrollView>(null);
  const activeDateKeyRef = useRef(formatApiDate(feedDate));
  activeDateKeyRef.current = formatApiDate(feedDate);

  const prefetchAdjacentDays = useCallback((date: Date) => {
    for (const offset of [-1, 1]) {
      const adjacent = shiftDay(date, offset);
      const key = formatApiDate(adjacent);
      if (
        key > formatApiDate(new Date()) ||
        notesByDateRef.current.has(key)
      ) {
        continue;
      }
      void fetchNotesForDate(key)
        .then(({ notes: prefetchedNotes }) => {
          notesByDateRef.current.set(key, prefetchedNotes);
        })
        .catch(() => {});
    }
  }, []);

  const moveFeedDay = useCallback(
    async (direction: -1 | 1) => {
      if (dayTransitionActiveRef.current) return;
      const next = shiftDay(feedDate, direction);
      const nextKey = formatApiDate(next);
      if (nextKey > formatApiDate(new Date())) return;

      dayTransitionActiveRef.current = true;
      void Haptics.selectionAsync();

      try {
        await new Promise<void>((resolve) => {
          Animated.timing(dayOpacity, {
            toValue: 0.42,
            duration: 110,
            useNativeDriver: true,
          }).start(() => resolve());
        });

        let nextNotes = notesByDateRef.current.get(nextKey);
        if (!nextNotes) {
          const result = await fetchNotesForDate(nextKey);
          nextNotes = result.notes;
          notesByDateRef.current.set(nextKey, nextNotes);
        }

        setNotes(nextNotes);
        setPendingThoughts([]);
        setFeedDate(next);
        feedScrollRef.current?.scrollTo({ y: 0, animated: false });
        prefetchAdjacentDays(next);
        dayOpacity.setValue(0.72);
        Animated.timing(dayOpacity, {
          toValue: 1,
          duration: 190,
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) dayTransitionActiveRef.current = false;
        });
      } catch {
        Animated.timing(dayOpacity, {
          toValue: 1,
          duration: 160,
          useNativeDriver: true,
        }).start(() => {
          dayTransitionActiveRef.current = false;
        });
      }
    },
    [dayOpacity, feedDate, prefetchAdjacentDays],
  );

  const canGoToNextDay = !isToday(feedDate);
  const daySwipeResponder = useMemo(
    () =>
      PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        !datePickerOpen &&
        !filterPickerOpen &&
        Math.abs(gesture.dx) > 18 &&
        Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
      onPanResponderRelease: (_, gesture) => {
        const direction: -1 | 1 = gesture.dx < 0 ? 1 : -1;
        const hasIntent =
          Math.abs(gesture.dx) > 70 || Math.abs(gesture.vx) > 0.65;
        const allowed = direction === -1 || canGoToNextDay;
        const now = Date.now();

        if (!hasIntent || !allowed || now - lastDaySwipeAt.current < 420) return;
        lastDaySwipeAt.current = now;
        void moveFeedDay(direction);
      },
    }),
    [
      canGoToNextDay,
      datePickerOpen,
      filterPickerOpen,
      moveFeedDay,
    ],
  );

  const retryProcessing = useCallback(async (thought: PendingThought) => {
    if (!thought.remotePath) return;
    const processingThought = {
      ...thought,
      processingStatus: "processing" as const,
      processingError: undefined,
    };
    setPendingThoughts((current) =>
      current.map((item) =>
        item.id === thought.id ? processingThought : item,
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const date = formatApiDate(feedDate);
      const cachedNotes = notesByDateRef.current.get(date);
      if (cachedNotes) {
        setNotes(cachedNotes);
        setLoading(false);
        prefetchAdjacentDays(feedDate);
        void fetchNotesForDate(date)
          .then(({ notes: refreshedNotes }) => {
            notesByDateRef.current.set(date, refreshedNotes);
            if (activeDateKeyRef.current === date) setNotes(refreshedNotes);
          })
          .catch(() => {});
        return;
      }
      const result = await fetchNotesForDate(date);
      notesByDateRef.current.set(date, result.notes);
      setNotes(result.notes);
      prefetchAdjacentDays(feedDate);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unbekannter Fehler",
      );
    } finally {
      setLoading(false);
    }
  }, [feedDate, prefetchAdjacentDays]);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      let refreshing = false;

      const refreshProcessing = async () => {
        if (refreshing) return;
        refreshing = true;
        try {
          const pending = await getPendingThoughts();
          const stillPending: PendingThought[] = [];
          const completedForFeed: ThoughtCard[] = [];
          const completedIds: string[] = [];

          for (const thought of pending) {
            if (!thought.remotePath) {
              stillPending.push(thought);
              continue;
            }
            if (thought.processingStatus === "failed") {
              stillPending.push(thought);
              continue;
            }
            try {
              const processingState = await fetchNoteProcessingState(
                thought.remotePath,
              );
              if (processingState.status === "processing") {
                stillPending.push(thought);
                continue;
              }
              if (processingState.status === "failed") {
                const failedThought = {
                  ...thought,
                  processingStatus: "failed" as const,
                  processingError: processingState.error,
                };
                stillPending.push(failedThought);
                await markPendingThoughtProcessingFailed(
                  thought.id,
                  processingState.error,
                );
                continue;
              }

              const completedNote = processingState.note;

              if (
                formatApiDate(new Date(completedNote.recordedAt)) ===
                formatApiDate(feedDate)
              ) {
                completedForFeed.push(completedNote);
              }
              completedIds.push(thought.id);
            } catch {
              stillPending.push(thought);
            }
          }

          if (!active) return;
          if (completedForFeed.length > 0) {
            setNotes((current) => {
              const completedPaths = new Set(
                completedForFeed.map((note) => note.relativePath),
              );
              return [
                ...completedForFeed,
                ...current.filter(
                  (note) => !completedPaths.has(note.relativePath),
                ),
              ].sort((left, right) =>
                right.recordedAt.localeCompare(left.recordedAt),
              );
            });
          }
          setPendingThoughts(
            stillPending.filter(
              (thought) =>
                formatApiDate(new Date(thought.createdAt)) ===
              formatApiDate(feedDate),
            ),
          );
          for (const completedId of completedIds) {
            await removePendingThought(completedId);
          }
        } finally {
          refreshing = false;
        }
      };

      void refreshProcessing();
      const interval = setInterval(() => void refreshProcessing(), 2_500);
      return () => {
        active = false;
        clearInterval(interval);
      };
    }, [feedDate]),
  );

  if (error) {
    return (
      <NoteError
        message={error}
        onRetry={() => void load()}
        onRecord={() =>
          activeRecording.active
            ? router.dismissTo("/record" as Href)
            : router.push("/record" as Href)
        }
      />
    );
  }
  if (loading) return <NoteLoading />;

  const filteredNotes = activeFilters.length
    ? notes.filter((note) => activeFilters.includes(note.type))
    : notes;
  const visiblePendingThoughts = activeFilters.length ? [] : pendingThoughts;
  const empty =
    filteredNotes.length === 0 && visiblePendingThoughts.length === 0;

  return (
    <View style={styles.root}>
      <View style={styles.pager} {...daySwipeResponder.panHandlers}>
        <Animated.View style={[styles.dayContent, { opacity: dayOpacity }]}>
          <ScrollView
        ref={feedScrollRef}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 7, paddingBottom: insets.bottom + 120 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.appBar}>
          <Text style={styles.brand}>thoughts</Text>
          <Pressable
            accessibilityLabel={`Datum auswählen. Angezeigt wird ${feedDateLabel(feedDate)}`}
            accessibilityRole="button"
            onPress={() => setDatePickerOpen(true)}
            style={({ pressed }) => [
              styles.dayButton,
              pressed && styles.dayButtonPressed,
            ]}
          >
            <Text style={styles.day}>{feedDateLabel(feedDate)}</Text>
            <Ionicons name="chevron-down" size={12} color={C.ink30} />
          </Pressable>
        </View>

        <View style={styles.filters} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeFilters.length === 0 }}
            onPress={() => setActiveFilters([])}
            style={({ pressed }) => pressed && styles.filterPressed}
          >
            <Text
              style={[
                styles.filter,
                activeFilters.length === 0 && styles.filterActive,
              ]}
            >
              Alle
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`Filtern${activeFilters.length ? `, ${activeFilters.length} aktiv` : ""}`}
            accessibilityRole="button"
            onPress={() => setFilterPickerOpen(true)}
            style={({ pressed }) => [
              styles.filterControl,
              pressed && styles.filterPressed,
            ]}
          >
            <Ionicons
              name="options-outline"
              size={13}
              color={activeFilters.length ? C.plum : C.ink30}
            />
            <Text
              style={[
                styles.filter,
                activeFilters.length > 0 && styles.filterSelected,
              ]}
            >
              Filtern
            </Text>
            {activeFilters.length > 0 && (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>
                  {activeFilters.length}
                </Text>
              </View>
            )}
          </Pressable>
        </View>

        {visiblePendingThoughts.map((pending) => (
          <View key={pending.id} style={[styles.card, styles.processingCard]}>
            <View style={styles.cardBody}>
              <View style={styles.kindRow}>
                <Text style={styles.processingKind}>neuer thought</Text>
                <Text numberOfLines={1} style={styles.location}>
                  {cardTimeLabel(pending.createdAt)} · {pending.locationLabel}
                </Text>
              </View>
              <Text style={styles.processingTitle}>
                {pending.processingStatus === "failed"
                  ? "Verarbeitung fehlgeschlagen"
                  : "wird verarbeitet…"}
              </Text>
              {pending.processingStatus === "failed" && (
                <Text numberOfLines={2} style={styles.processingError}>
                  {pending.processingError}
                </Text>
              )}
              <View style={styles.footer}>
                <View style={styles.processingStatus}>
                  {pending.processingStatus === "failed" ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Verarbeitung erneut versuchen"
                      onPress={() => void retryProcessing(pending)}
                      style={({ pressed }) => [
                        styles.processingRetry,
                        pressed && styles.filterPressed,
                      ]}
                    >
                      <Ionicons name="refresh" size={13} color={C.plum} />
                      <Text style={styles.processingRetryText}>
                        Erneut versuchen
                      </Text>
                    </Pressable>
                  ) : (
                    <>
                      <View style={styles.processingDot} />
                      <Text style={styles.processingText}>
                        {pending.remotePath
                          ? "Mac mini arbeitet"
                          : "wird übertragen"}
                      </Text>
                    </>
                  )}
                </View>
                <Text style={styles.duration}>
                  {new Intl.DateTimeFormat("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(pending.createdAt))}
                  {" · "}
                  {formatDuration(pending.durationSeconds)}
                </Text>
              </View>
            </View>
          </View>
        ))}

        {empty && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {activeFilters.length
                ? "Keine thoughts für diese Filter"
                : isToday(feedDate)
                  ? "Noch keine thoughts heute"
                  : "Keine thoughts an diesem Tag"}
            </Text>
          </View>
        )}

        {filteredNotes.map((cardNote) => (
            <Pressable
            key={cardNote.relativePath}
            accessibilityRole="button"
            accessibilityLabel={`${typeLabel(cardNote.type)}: ${cardNote.title}`}
            onPress={() =>
              router.push(
                `/thoughts/detail?path=${encodeURIComponent(
                  cardNote.relativePath,
                )}` as Href,
              )
            }
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
          >
            <View style={styles.cardBody}>
              <View style={styles.kindRow}>
                <Text
                  style={[
                    styles.kind,
                    { color: noteCategoryColor(cardNote.type) },
                  ]}
                >
                  {typeLabel(cardNote.type)}
                </Text>
                <Text style={styles.compactDuration}>
                  {formatDuration(cardNote.durationSeconds)} min
                </Text>
              </View>
              <Text numberOfLines={2} style={styles.title}>
                {cardNote.title}
              </Text>
            </View>
            </Pressable>
        ))}
          </ScrollView>
        </Animated.View>
      </View>
      {!activeRecording.active && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Neue Aufnahme starten"
          onPress={() => router.push("/record" as Href)}
          style={({ pressed }) => [
            styles.recordButtonOuter,
            { bottom: insets.bottom + 18 },
            pressed && styles.recordButtonPressed,
          ]}
        >
          <View style={styles.recordButtonInner}>
            <Ionicons name="mic" size={25} color={C.card} />
          </View>
        </Pressable>
      )}
      <DayPicker
        onChange={(date) => {
          setFeedDate(date);
          setDatePickerOpen(false);
        }}
        onClose={() => setDatePickerOpen(false)}
        value={feedDate}
        visible={datePickerOpen}
      />
      <ThoughtFilterPicker
        onApply={(types) => {
          setActiveFilters(types);
          setFilterPickerOpen(false);
        }}
        onClose={() => setFilterPickerOpen(false)}
        options={FILTER_OPTIONS.map((option) => ({
          ...option,
          count: notes.filter((note) => note.type === option.type).length,
        }))}
        selected={activeFilters}
        visible={filterPickerOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  pager: { flex: 1 },
  dayContent: { flex: 1 },
  content: { paddingHorizontal: 20, paddingBottom: 130 },
  appBar: {
    minHeight: 38,
    paddingHorizontal: 6,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 12,
    color: C.ink40,
  },
  day: {
    fontFamily: NOTE_SANS_ITALIC,
    fontSize: 13,
    color: C.ink30,
  },
  dayButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 10,
    paddingVertical: 8,
  },
  dayButtonPressed: { opacity: 0.5 },
  filters: {
    paddingHorizontal: 6,
    paddingBottom: 18,
    flexDirection: "row",
    gap: 20,
  },
  filter: {
    fontFamily: NOTE_SANS_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1.25,
    textTransform: "uppercase",
    color: C.ink30,
    paddingBottom: 4,
  },
  filterActive: {
    color: C.ink,
    borderBottomWidth: 1,
    borderBottomColor: C.ink,
  },
  filterSelected: { color: C.plum },
  filterControl: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
  },
  filterBadge: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    marginTop: -3,
    backgroundColor: C.plum,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeText: {
    fontFamily: NOTE_SANS_SEMIBOLD,
    fontSize: 9,
    color: C.card,
  },
  filterPressed: { opacity: 0.5 },
  card: {
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 11,
  },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: 30,
    paddingVertical: 54,
  },
  emptyTitle: {
    fontFamily: NOTE_SERIF,
    fontSize: 20,
    color: C.ink60,
    textAlign: "center",
  },
  cardBody: { paddingHorizontal: 18, paddingVertical: 14 },
  kindRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  kind: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    opacity: NOTE_CATEGORY_TEXT_OPACITY,
  },
  location: {
    fontFamily: NOTE_SANS_ITALIC,
    color: C.ink30,
    fontSize: 11,
    flexShrink: 1,
    marginLeft: 16,
  },
  title: {
    fontFamily: NOTE_SANS,
    color: C.ink,
    fontSize: 16,
    lineHeight: 22,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  compactDuration: {
    fontFamily: NOTE_SANS_ITALIC,
    fontSize: 11,
    color: C.ink30,
  },
  duration: {
    fontFamily: NOTE_SANS_ITALIC,
    fontSize: 11,
    color: C.ink30,
    paddingBottom: 2,
  },
  processingCard: { opacity: 0.82 },
  processingKind: {
    fontFamily: NOTE_SANS_SEMIBOLD,
    color: C.slate,
    fontSize: 10,
    letterSpacing: 2.1,
    textTransform: "uppercase",
  },
  processingTitle: {
    fontFamily: NOTE_SERIF_ITALIC,
    color: C.ink60,
    fontSize: 20,
    lineHeight: 27,
    marginBottom: 16,
  },
  processingError: {
    marginTop: -9,
    marginBottom: 14,
    fontFamily: NOTE_SANS,
    fontSize: 11.5,
    lineHeight: 17,
    color: C.ink40,
  },
  processingStatus: { flexDirection: "row", alignItems: "center", gap: 7 },
  processingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.slate,
    opacity: 0.55,
  },
  processingText: {
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    color: C.ink40,
  },
  processingRetry: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  processingRetryText: {
    fontFamily: NOTE_SANS_SEMIBOLD,
    fontSize: 10.5,
    color: C.plum,
  },
  recordButtonOuter: {
    position: "absolute",
    left: "50%",
    marginLeft: -39,
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: C.border,
    shadowColor: C.ink,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 8,
  },
  recordButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  recordButtonPressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
});
