import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DayPicker } from "@/components/DayPicker";
import { ThoughtFilterPicker } from "@/components/ThoughtFilterPicker";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SERIF,
  NoteError,
  NoteLoading,
  NoteTag,
  noteUiStyles,
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
import {
  type DailyAnalytics,
  type DailySummary,
  fetchDailyOverview,
  formatDailyDate,
} from "@/lib/daily-summary";

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    PROBLEM: "Problem",
    REFLECTION: "Reflexion",
    QUESTION: "Frage",
    IDEA: "Idee",
    TASK: "Aufgabe",
    DECISION: "Entscheidung",
  };
  return labels[type] ?? type.toLocaleLowerCase("de-DE");
}

function analyticsTypeLabel(type: string, count: number): string {
  const singular: Record<string, string> = {
    IDEA: "Idee",
    REFLECTION: "Reflexion",
    QUESTION: "Frage",
    DECISION: "Entscheidung",
    TASK: "Aufgabe",
    PROBLEM: "Problem",
  };
  const plural: Record<string, string> = {
    IDEA: "Ideen",
    REFLECTION: "Reflexionen",
    QUESTION: "Fragen",
    DECISION: "Entscheidungen",
    TASK: "Aufgaben",
    PROBLEM: "Probleme",
  };
  return `${count} ${(count === 1 ? singular[type] : plural[type]) ?? type.toLocaleLowerCase("de-DE")}`;
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

export default function ThoughtsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const [feedDate, setFeedDate] = useState(() => new Date());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [filterPickerOpen, setFilterPickerOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [notes, setNotes] = useState<ThoughtCard[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [dailyAnalytics, setDailyAnalytics] = useState<DailyAnalytics | null>(
    null,
  );
  const [dailyThoughtsOpen, setDailyThoughtsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pendingThoughts, setPendingThoughts] = useState<PendingThought[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      const [result, overview] = await Promise.all([
        fetchNotesForDate(date),
        fetchDailyOverview(date),
      ]);
      setNotes(result.notes);
      setDailySummary(overview.daily);
      setDailyAnalytics(overview.analytics);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unbekannter Fehler",
      );
    } finally {
      setLoading(false);
    }
  }, [feedDate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setDailyThoughtsOpen(false);
  }, [feedDate]);

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
    !dailySummary &&
    filteredNotes.length === 0 &&
    visiblePendingThoughts.length === 0;

  return (
    <View style={styles.root}>
      <ScrollView
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

        {!dailySummary && (
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
        )}

        {visiblePendingThoughts.map((pending) => (
          <View key={pending.id} style={[styles.card, styles.processingCard]}>
            <View style={styles.cardBody}>
              <View style={styles.kindRow}>
                <Text style={styles.processingKind}>neuer thought</Text>
                <Text numberOfLines={1} style={styles.location}>
                  {pending.locationLabel}
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

        {dailySummary && (
          <View style={styles.dailyGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Tagesrückblick für ${formatDailyDate(dailySummary.date)} öffnen`}
              onPress={() =>
                router.push(
                  `/thoughts/daily?date=${encodeURIComponent(dailySummary.date)}` as Href,
                )
              }
              style={({ pressed }) => [
                styles.dailyCard,
                pressed && styles.dailyCardPressed,
              ]}
            >
              <View style={styles.dailyTopRow}>
                <View style={styles.dailyMark}>
                  <Ionicons name="sparkles" size={13} color={C.plum} />
                </View>
                <Text style={styles.dailyEyebrow}>tagesrückblick</Text>
              </View>
              <Text style={styles.dailyDate}>
                {formatDailyDate(dailySummary.date)}
              </Text>
              <View style={styles.dailyMetrics}>
                <View style={styles.dailyMetric}>
                  <Text style={styles.dailyMetricValue}>
                    {dailyAnalytics?.thought_count ?? notes.length}
                  </Text>
                  <Text style={styles.dailyMetricLabel}>thoughts</Text>
                </View>
                <View style={styles.dailyMetricDivider} />
                <View style={styles.dailyMetric}>
                  <Text style={styles.dailyMetricValue}>
                    {(dailyAnalytics?.word_count ?? 0).toLocaleString("de-DE")}
                  </Text>
                  <Text style={styles.dailyMetricLabel}>Wörter</Text>
                </View>
              </View>

              {dailyAnalytics && (
                <>
                  <View style={styles.dailyTypes}>
                    {Object.entries(dailyAnalytics.thought_types).map(
                      ([type, count]) => (
                        <Text key={type} style={styles.dailyType}>
                          {analyticsTypeLabel(type, count)}
                        </Text>
                      ),
                    )}
                  </View>
                  <View style={styles.dailyTags}>
                    {dailyAnalytics.top_tags.slice(0, 3).map(({ tag }) => (
                      <View key={tag} style={styles.dailyTag}>
                        <Text style={styles.dailyTagText}>{tag}</Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
              <View style={styles.dailyFooter}>
                <View style={styles.dailyOpen}>
                  <Text style={styles.dailyOpenText}>gesamtansicht</Text>
                  <Ionicons name="arrow-forward" size={15} color={C.plum} />
                </View>
              </View>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: dailyThoughtsOpen }}
              onPress={() => setDailyThoughtsOpen((open) => !open)}
              style={({ pressed }) => [
                styles.dailyThoughtsToggle,
                pressed && styles.filterPressed,
              ]}
            >
              <View style={styles.dailyThoughtsToggleText}>
                <Text style={styles.dailyThoughtsLabel}>
                  {notes.length} {notes.length === 1 ? "thought" : "thoughts"}
                </Text>
                <Text style={styles.dailyThoughtsHint}>
                  {dailyThoughtsOpen ? "einklappen" : "dieses Tages anzeigen"}
                </Text>
              </View>
              <Ionicons
                name={dailyThoughtsOpen ? "chevron-up" : "chevron-down"}
                size={17}
                color={C.ink30}
              />
            </Pressable>

            {dailyThoughtsOpen && (
              <View style={styles.dailyThoughtList}>
                {notes.map((cardNote) => (
                  <Pressable
                    key={cardNote.relativePath}
                    accessibilityRole="button"
                    accessibilityLabel={`${typeLabel(cardNote.type)}: ${cardNote.title}`}
                    onPress={() =>
                      router.push(
                        `/thoughts/rec-16-32?path=${encodeURIComponent(
                          cardNote.relativePath,
                        )}` as Href,
                      )
                    }
                    style={({ pressed }) => [
                      styles.card,
                      styles.dailyThoughtCard,
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <View style={styles.cardBody}>
                      <View style={styles.kindRow}>
                        <Text style={styles.kind}>
                          {typeLabel(cardNote.type)}
                        </Text>
                        <Text numberOfLines={1} style={styles.location}>
                          {cardNote.locationLabel}
                        </Text>
                      </View>
                      <Text style={styles.title}>{cardNote.title}</Text>
                      <View style={styles.footer}>
                        <View style={[noteUiStyles.tags, styles.cardTags]}>
                          {cardNote.tags.map((tag, index) => (
                            <NoteTag key={tag} label={tag} index={index} />
                          ))}
                        </View>
                        <Text style={styles.duration}>
                          {new Intl.DateTimeFormat("de-DE", {
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(cardNote.recordedAt))}
                          {" · "}
                          {formatDuration(cardNote.durationSeconds)}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {empty && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>
              {activeFilters.length
                ? "Keine thoughts für diese Filter"
                : isToday(feedDate)
                  ? "Noch keine thoughts heute"
                  : "Keine thoughts an diesem Tag"}
            </Text>
            <Text style={styles.emptyText}>
              Deine Aufnahmen dieses Tages erscheinen hier.
            </Text>
          </View>
        )}

        {!dailySummary &&
          filteredNotes.map((cardNote) => (
            <Pressable
            key={cardNote.relativePath}
            accessibilityRole="button"
            accessibilityLabel={`${typeLabel(cardNote.type)}: ${cardNote.title}`}
            onPress={() =>
              router.push(
                `/thoughts/rec-16-32?path=${encodeURIComponent(
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
                <Text style={styles.kind}>{typeLabel(cardNote.type)}</Text>
                <Text numberOfLines={1} style={styles.location}>
                  {cardNote.locationLabel}
                </Text>
              </View>
              <Text style={styles.title}>{cardNote.title}</Text>
              <View style={styles.footer}>
                <View style={[noteUiStyles.tags, styles.cardTags]}>
                  {cardNote.tags.map((tag, index) => (
                    <NoteTag key={tag} label={tag} index={index} />
                  ))}
                </View>
                <Text style={styles.duration}>
                  {new Intl.DateTimeFormat("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(cardNote.recordedAt))}
                  {" · "}
                  {formatDuration(cardNote.durationSeconds)}
                </Text>
              </View>
            </View>
            </Pressable>
          ))}
      </ScrollView>
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
    fontFamily: NOTE_SANS,
    fontSize: 12,
    fontWeight: "400",
    color: C.ink40,
  },
  day: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
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
    fontFamily: NOTE_SANS,
    fontSize: 10,
    fontWeight: "600",
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
    fontFamily: NOTE_SANS,
    fontSize: 9,
    fontWeight: "700",
    color: C.card,
  },
  filterPressed: { opacity: 0.5 },
  dailyGroup: { marginBottom: 18 },
  dailyCard: {
    minHeight: 236,
    marginBottom: 0,
    paddingHorizontal: 25,
    paddingTop: 23,
    paddingBottom: 20,
    borderRadius: 22,
    backgroundColor: "#E9E0E6",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D8C8D2",
    justifyContent: "space-between",
  },
  dailyCardPressed: { opacity: 0.88, transform: [{ scale: 0.995 }] },
  dailyTopRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  dailyMark: {
    width: 27,
    height: 27,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(110,74,97,0.10)",
  },
  dailyEyebrow: {
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    fontWeight: "600",
    letterSpacing: 1.8,
    color: C.plum,
  },
  dailyDate: {
    marginTop: 21,
    marginBottom: 13,
    fontFamily: NOTE_SERIF,
    fontSize: 25,
    lineHeight: 31,
    color: C.ink,
  },
  dailyMetrics: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
  },
  dailyMetric: { minWidth: 86 },
  dailyMetricValue: {
    fontFamily: NOTE_SERIF,
    fontSize: 25,
    color: C.ink,
  },
  dailyMetricLabel: {
    marginTop: 2,
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    color: C.ink40,
  },
  dailyMetricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 35,
    marginHorizontal: 18,
    backgroundColor: "rgba(110,74,97,0.20)",
  },
  dailyTypes: {
    marginTop: 17,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  dailyType: {
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    color: C.ink60,
  },
  dailyTags: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  dailyTag: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 100,
    backgroundColor: "rgba(110,74,97,0.09)",
  },
  dailyTagText: {
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    color: C.plum,
  },
  dailyFooter: {
    marginTop: 23,
    paddingTop: 15,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(110,74,97,0.16)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  dailyOpen: { flexDirection: "row", alignItems: "center", gap: 7 },
  dailyOpenText: {
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    fontWeight: "600",
    color: C.plum,
  },
  dailyThoughtsToggle: {
    minHeight: 62,
    marginTop: 14,
    marginHorizontal: 7,
    paddingHorizontal: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dailyThoughtsToggleText: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 7,
  },
  dailyThoughtsLabel: {
    fontFamily: NOTE_SERIF,
    fontSize: 14.5,
    color: C.ink60,
  },
  dailyThoughtsHint: {
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    color: C.ink30,
  },
  dailyThoughtList: { paddingTop: 12 },
  dailyThoughtCard: { marginBottom: 11 },
  card: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: C.ink,
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    marginBottom: 16,
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
    marginBottom: 7,
  },
  emptyText: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    color: C.ink30,
  },
  cardBody: { paddingHorizontal: 22, paddingTop: 19, paddingBottom: 15 },
  kindRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  kind: {
    fontFamily: NOTE_SANS,
    color: C.plum,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2.1,
    textTransform: "uppercase",
  },
  location: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    color: C.ink30,
    fontSize: 11.5,
    flexShrink: 1,
    marginLeft: 16,
  },
  title: {
    fontFamily: NOTE_SERIF,
    color: C.ink,
    fontSize: 20,
    lineHeight: 27,
    marginBottom: 16,
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
  cardTags: { flex: 1 },
  duration: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 11.5,
    color: C.ink30,
    paddingBottom: 2,
  },
  processingCard: { opacity: 0.82 },
  processingKind: {
    fontFamily: NOTE_SANS,
    color: C.slate,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2.1,
    textTransform: "uppercase",
  },
  processingTitle: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
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
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    fontWeight: "600",
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
