import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { GlassView } from "expo-glass-effect";
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

const FILTER_OPTIONS = [
  { label: "Ideen", type: "IDEA" },
  { label: "Fragen", type: "QUESTION" },
  { label: "Reflexionen", type: "REFLECTION" },
  { label: "Entscheidungen", type: "DECISION" },
] as const;

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

function shiftDay(date: Date, offset: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + offset,
    12,
  );
}

function buildDayRange(): Date[] {
  const dates: Date[] = [];
  const today = shiftDay(new Date(), 0);
  const cursor = new Date(2000, 0, 1, 12);
  while (cursor <= today) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

type DayPageProps = {
  activeFilters: string[];
  date: Date;
  insets: { bottom: number; top: number };
  notes: ThoughtCard[] | undefined;
  onClearFilters: () => void;
  onOpenDatePicker: () => void;
  onOpenFilters: () => void;
  onOpenThought: (note: ThoughtCard) => void;
  onRetryProcessing: (thought: PendingThought) => void;
  pendingThoughts: PendingThought[];
  width: number;
};

const DayPage = React.memo(function DayPage({
  activeFilters,
  date,
  insets,
  notes,
  onClearFilters,
  onOpenDatePicker,
  onOpenFilters,
  onOpenThought,
  onRetryProcessing,
  pendingThoughts,
  width,
}: DayPageProps) {
  const dateKey = formatApiDate(date);
  const filteredNotes = activeFilters.length
    ? (notes ?? []).filter((note) => activeFilters.includes(note.type))
    : (notes ?? []);
  const visiblePendingThoughts = activeFilters.length
    ? []
    : pendingThoughts.filter(
        (thought) => formatApiDate(new Date(thought.createdAt)) === dateKey,
      );
  const empty =
    notes !== undefined &&
    filteredNotes.length === 0 &&
    visiblePendingThoughts.length === 0;

  return (
    <View style={[styles.dayPage, { width }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 7,
            paddingBottom: insets.bottom + 120,
          },
        ]}
        directionalLockEnabled
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.appBar}>
          <Text style={styles.brand}>thoughts</Text>
          <Pressable
            accessibilityLabel={`Datum auswählen. Angezeigt wird ${feedDateLabel(date)}`}
            accessibilityRole="button"
            onPress={onOpenDatePicker}
            style={({ pressed }) => [
              styles.dayButton,
              pressed && styles.dayButtonPressed,
            ]}
          >
            <Text style={styles.day}>{feedDateLabel(date)}</Text>
            <Ionicons name="chevron-down" size={12} color={C.ink30} />
          </Pressable>
        </View>

        <View style={styles.filters} accessibilityRole="tablist">
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeFilters.length === 0 }}
            onPress={onClearFilters}
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
            onPress={onOpenFilters}
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
                <Text style={styles.processingKind}>
                  {pending.processingStatus === "failed"
                    ? "Verarbeitung fehlgeschlagen"
                    : pending.remotePath
                      ? "wird verarbeitet…"
                      : "wird übertragen…"}
                </Text>
                <Text style={styles.compactDuration}>
                  {formatDuration(pending.durationSeconds)} min
                </Text>
              </View>
              <Text style={styles.title}>neuer thought</Text>
              {pending.processingStatus === "failed" && (
                <View style={styles.processingFailure}>
                  <Text numberOfLines={2} style={styles.processingError}>
                    {pending.processingError}
                  </Text>
                  <View style={styles.processingActions}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Verarbeitung erneut versuchen"
                      onPress={() => onRetryProcessing(pending)}
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
                  </View>
                </View>
              )}
            </View>
          </View>
        ))}

        {notes === undefined && (
          <View style={styles.pageLoading}>
            <ActivityIndicator color={C.sky} size="small" />
          </View>
        )}

        {empty && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {activeFilters.length
                ? "Keine thoughts für diese Filter"
                : isToday(date)
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
            onPress={() => onOpenThought(cardNote)}
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
    </View>
  );
});

export default function ThoughtsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const activeRecording = useActiveRecording();
  const dayDates = useMemo(buildDayRange, []);
  const dayIndexByKey = useMemo(
    () =>
      new Map(
        dayDates.map((date, index) => [formatApiDate(date), index] as const),
      ),
    [dayDates],
  );
  const initialDayIndex = dayDates.length - 1;
  const [feedDate, setFeedDate] = useState(dayDates[initialDayIndex]);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [notesByDate, setNotesByDate] = useState<Record<string, ThoughtCard[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [pendingThoughts, setPendingThoughts] = useState<PendingThought[]>([]);
  const [error, setError] = useState<string | null>(null);
  const notesByDateRef = useRef(new Map<string, ThoughtCard[]>());
  const dateFetchesRef = useRef(new Map<string, Promise<ThoughtCard[]>>());
  const pagerRef = useRef<FlatList<Date>>(null);
  const currentDayIndexRef = useRef(initialDayIndex);
  const initialLoadRef = useRef(true);
  const activeDateKeyRef = useRef(formatApiDate(feedDate));
  activeDateKeyRef.current = formatApiDate(feedDate);

  const loadDate = useCallback(
    async (date: Date, refresh = false): Promise<ThoughtCard[]> => {
      const key = formatApiDate(date);
      const cached = notesByDateRef.current.get(key);
      if (cached && !refresh) return cached;

      const activeFetch = dateFetchesRef.current.get(key);
      if (activeFetch) return activeFetch;

      const request = fetchNotesForDate(key)
        .then(({ notes }) => {
          notesByDateRef.current.set(key, notes);
          setNotesByDate((current) => ({ ...current, [key]: notes }));
          return notes;
        })
        .finally(() => {
          dateFetchesRef.current.delete(key);
        });
      dateFetchesRef.current.set(key, request);
      return request;
    },
    [],
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

  useEffect(() => {
    const currentKey = formatApiDate(feedDate);
    const isInitialLoad = initialLoadRef.current;
    setError(null);

    void loadDate(feedDate, notesByDateRef.current.has(currentKey))
      .catch((loadError) => {
        if (activeDateKeyRef.current !== currentKey) return;
        setError(
          loadError instanceof Error ? loadError.message : "Unbekannter Fehler",
        );
      })
      .finally(() => {
        if (!isInitialLoad) return;
        initialLoadRef.current = false;
        setLoading(false);
      });

    for (const offset of [-2, -1, 1, 2]) {
      const adjacent = shiftDay(feedDate, offset);
      if (!dayIndexByKey.has(formatApiDate(adjacent))) continue;
      void loadDate(adjacent).catch(() => {});
    }
  }, [dayIndexByKey, feedDate, loadDate]);

  useEffect(() => {
    pagerRef.current?.scrollToOffset({
      animated: false,
      offset: currentDayIndexRef.current * width,
    });
  }, [width]);

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
          const completedNotes: ThoughtCard[] = [];
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
              completedNotes.push(processingState.note);
              completedIds.push(thought.id);
            } catch {
              stillPending.push(thought);
            }
          }

          if (!active) return;
          if (completedNotes.length > 0) {
            setNotesByDate((current) => {
              const next = { ...current };
              for (const completedNote of completedNotes) {
                const key = formatApiDate(new Date(completedNote.recordedAt));
                const existing = notesByDateRef.current.get(key) ?? [];
                const merged = [
                  completedNote,
                  ...existing.filter(
                    (note) => note.relativePath !== completedNote.relativePath,
                  ),
                ].sort((left, right) =>
                  right.recordedAt.localeCompare(left.recordedAt),
                );
                notesByDateRef.current.set(key, merged);
                next[key] = merged;
              }
              return next;
            });
          }
          setPendingThoughts(stillPending);
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
    }, []),
  );

  const handlePageSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = Math.max(
        0,
        Math.min(
          dayDates.length - 1,
          Math.round(event.nativeEvent.contentOffset.x / width),
        ),
      );
      if (nextIndex === currentDayIndexRef.current) return;
      currentDayIndexRef.current = nextIndex;
      setFeedDate(dayDates[nextIndex]);
      void Haptics.selectionAsync();
    },
    [dayDates, width],
  );

  const selectFeedDate = useCallback(
    (date: Date) => {
      const normalized = shiftDay(date, 0);
      const nextIndex = dayIndexByKey.get(formatApiDate(normalized));
      if (nextIndex === undefined) return;
      currentDayIndexRef.current = nextIndex;
      setFeedDate(dayDates[nextIndex]);
      pagerRef.current?.scrollToIndex({ animated: false, index: nextIndex });
      setDatePickerOpen(false);
    },
    [dayDates, dayIndexByKey],
  );

  const openThought = useCallback(
    (note: ThoughtCard) => {
      router.push(
        `/thoughts/detail?path=${encodeURIComponent(note.relativePath)}` as Href,
      );
    },
    [router],
  );

  if (error) {
    return (
      <NoteError
        message={error}
        onRetry={() => {
          setError(null);
          setLoading(true);
          void loadDate(feedDate, true)
            .catch((loadError) =>
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unbekannter Fehler",
              ),
            )
            .finally(() => setLoading(false));
        }}
        onRecord={() =>
          activeRecording.active
            ? router.dismissTo("/record" as Href)
            : router.push("/record" as Href)
        }
      />
    );
  }
  if (loading) return <NoteLoading />;

  const currentNotes = notesByDate[formatApiDate(feedDate)] ?? [];

  return (
    <View style={styles.root}>
      <FlatList
        ref={pagerRef}
        data={dayDates}
        decelerationRate="fast"
        directionalLockEnabled
        disableIntervalMomentum
        extraData={{ activeFilters, notesByDate, pendingThoughts, width }}
        getItemLayout={(_, index) => ({
          index,
          length: width,
          offset: width * index,
        })}
        horizontal
        initialNumToRender={3}
        initialScrollIndex={initialDayIndex}
        keyExtractor={formatApiDate}
        maxToRenderPerBatch={3}
        onMomentumScrollEnd={handlePageSettled}
        onScrollToIndexFailed={({ index }) => {
          pagerRef.current?.scrollToOffset({
            animated: false,
            offset: index * width,
          });
        }}
        pagingEnabled
        removeClippedSubviews={false}
        renderItem={({ item }) => {
          const key = formatApiDate(item);
          return (
            <DayPage
              activeFilters={activeFilters}
              date={item}
              insets={insets}
              notes={notesByDate[key]}
              onClearFilters={() => setActiveFilters([])}
              onOpenDatePicker={() => setDatePickerOpen(true)}
              onOpenFilters={() => setFilterPickerOpen(true)}
              onOpenThought={openThought}
              onRetryProcessing={(thought) => void retryProcessing(thought)}
              pendingThoughts={pendingThoughts}
              width={width}
            />
          );
        }}
        showsHorizontalScrollIndicator={false}
        style={styles.pager}
        windowSize={3}
      />

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
          <GlassView
            colorScheme="light"
            glassEffectStyle="regular"
            isInteractive
            style={styles.recordButtonGlass}
            tintColor="rgba(127,176,214,0.22)"
          >
            <Ionicons name="mic" size={24} color={C.skyDeep} />
          </GlassView>
        </Pressable>
      )}

      <DayPicker
        onChange={selectFeedDate}
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
          count: currentNotes.filter((note) => note.type === option.type)
            .length,
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
  dayPage: { flex: 1, backgroundColor: C.paper },
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
    marginBottom: 11,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.08,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardPressed: { opacity: 0.72, transform: [{ scale: 0.995 }] },
  pageLoading: { alignItems: "center", paddingVertical: 58 },
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
  title: {
    fontFamily: NOTE_SANS,
    color: C.ink,
    fontSize: 16,
    lineHeight: 22,
  },
  compactDuration: {
    fontFamily: NOTE_SANS_ITALIC,
    fontSize: 11,
    color: C.ink30,
  },
  processingCard: { opacity: 0.82 },
  processingKind: {
    fontFamily: NOTE_SANS_SEMIBOLD,
    color: C.slate,
    fontSize: 10,
    letterSpacing: 2.1,
    textTransform: "uppercase",
  },
  processingFailure: { marginTop: 9, gap: 5 },
  processingError: {
    fontFamily: NOTE_SANS,
    fontSize: 11.5,
    lineHeight: 17,
    color: C.ink40,
  },
  processingActions: { flexDirection: "row" },
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
    marginLeft: -37,
    width: 74,
    height: 74,
    borderRadius: 37,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  recordButtonGlass: {
    flex: 1,
    borderRadius: 37,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  recordButtonPressed: { transform: [{ scale: 0.96 }], opacity: 0.86 },
});
