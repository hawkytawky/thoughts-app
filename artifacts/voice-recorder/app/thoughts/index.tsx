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
  fetchThoughtFeedPage,
  formatApiDate,
  formatDuration,
  parseApiTimestamp,
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

const FEED_PAGE_SIZE = 30;

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
    };

type TimelineSection = {
  date: string;
  data: TimelineEntry[];
};

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

function topDate(dateKey: string): string {
  const date = dayKeyToDate(dateKey);
  const formatted = new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
  }).format(date);
  if (isToday(date)) return `Heute, ${formatted}`;
  return `${dayHeading(dateKey)}, ${formatted}`;
}

function buildSections(
  notes: ThoughtCard[],
  pendingThoughts: PendingThought[],
  includePending: boolean,
): TimelineSection[] {
  const entries: TimelineEntry[] = notes.map((note) => ({
    id: note.relativePath,
    kind: "note",
    recordedAt: note.recordedAt,
    note,
  }));
  if (includePending) {
    const remoteIds = new Set(notes.map(({ relativePath }) => relativePath));
    for (const pending of pendingThoughts) {
      if (pending.remotePath && remoteIds.has(pending.remotePath)) continue;
      entries.push({
        id: `pending-${pending.id}`,
        kind: "pending",
        recordedAt: pending.createdAt,
        pending,
      });
    }
  }
  entries.sort((left, right) =>
    right.recordedAt.localeCompare(left.recordedAt),
  );

  const grouped = new Map<string, TimelineEntry[]>();
  for (const entry of entries) {
    const key = formatApiDate(parseApiTimestamp(entry.recordedAt));
    const group = grouped.get(key) ?? [];
    group.push(entry);
    grouped.set(key, group);
  }
  return [...grouped].map(([date, data]) => ({ date, data }));
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

export default function ThoughtsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const listRef = useRef<SectionListType<TimelineEntry, TimelineSection>>(null);
  const [notes, setNotes] = useState<ThoughtCard[]>([]);
  const [pendingThoughts, setPendingThoughts] = useState<PendingThought[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState<string | null>(null);
  const [visibleDate, setVisibleDate] = useState(formatApiDate(new Date()));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sections = useMemo(
    () => buildSections(notes, pendingThoughts, anchorDate === null),
    [anchorDate, notes, pendingThoughts],
  );

  const replacePage = useCallback(async (nextAnchor?: string) => {
    const page = await fetchThoughtFeedPage({
      anchorDate: nextAnchor,
      limit: FEED_PAGE_SIZE,
    });
    setNotes(page.notes);
    setNextCursor(page.nextCursor);
    setAnchorDate(nextAnchor ?? null);
    if (nextAnchor) setVisibleDate(nextAnchor);
  }, []);

  const loadInitial = useCallback(async () => {
    setInitialLoading(true);
    setError(null);
    try {
      await replacePage();
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unbekannter Fehler",
      );
    } finally {
      setInitialLoading(false);
    }
  }, [replacePage]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchThoughtFeedPage({
        cursor: nextCursor,
        limit: FEED_PAGE_SIZE,
      });
      setNotes((current) => {
        const known = new Set(current.map(({ relativePath }) => relativePath));
        return [
          ...current,
          ...page.notes.filter(({ relativePath }) => !known.has(relativePath)),
        ];
      });
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await replacePage(anchorDate ?? undefined);
    } finally {
      setRefreshing(false);
    }
  }, [anchorDate, replacePage]);

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
          if (completedNotes.length > 0 && anchorDate === null) {
            setNotes((current) => {
              const completedPaths = new Set(
                completedNotes.map(({ relativePath }) => relativePath),
              );
              return [...completedNotes, ...current].filter(
                (note, index, all) =>
                  completedPaths.has(note.relativePath)
                    ? all.findIndex(
                        ({ relativePath }) =>
                          relativePath === note.relativePath,
                      ) === index
                    : true,
              );
            });
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
    }, [anchorDate, pendingThoughts.length]),
  );

  const selectDate = useCallback(
    async (date: Date) => {
      const selected = formatApiDate(date);
      setDatePickerOpen(false);
      setInitialLoading(true);
      setError(null);
      try {
        await replacePage(selected);
        requestAnimationFrame(() =>
          listRef.current?.scrollToLocation({
            animated: false,
            itemIndex: 0,
            sectionIndex: 0,
          }),
        );
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unbekannter Fehler",
        );
      } finally {
        setInitialLoading(false);
      }
    },
    [replacePage],
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
    minimumViewTime: 80,
  }).current;
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: { item: TimelineEntry }[] }) => {
      const first = viewableItems[0]?.item;
      if (first) setVisibleDate(formatApiDate(parseApiTimestamp(first.recordedAt)));
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

  if (error && notes.length === 0) {
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
          <Pressable
            accessibilityLabel={`Datum auswählen. Angezeigt wird ${topDate(visibleDate)}`}
            accessibilityRole="button"
            onPress={() => setDatePickerOpen(true)}
            style={({ pressed }) => [
              styles.dateButton,
              pressed && styles.controlPressed,
            ]}
          >
            <Text style={styles.topDate}>{topDate(visibleDate)}</Text>
            <Ionicons name="chevron-down" size={11} color={C.ink60} />
          </Pressable>
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
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.45}
          onRefresh={() => void refresh()}
          onViewableItemsChanged={onViewableItemsChanged}
          refreshing={refreshing}
          renderItem={({ item }) =>
            item.kind === "note" ? (
              <ThoughtCardRow
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
          renderSectionFooter={() => <View style={styles.sectionFooter} />}
          renderSectionHeader={({ section }) => (
            <View
              accessibilityRole="header"
              style={styles.dayHeader}
            >
              <Text style={styles.dayName}>{dayHeading(section.date)}</Text>
              <Text style={styles.dayDate}>{dayDate(section.date)}</Text>
            </View>
          )}
          sections={sections}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Noch keine thoughts</Text>
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
  dateButton: {
    minHeight: 40,
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
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
