import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SERIF,
  NoteError,
  NoteLoading,
} from "@/components/NoteUI";
import {
  type DailyAnalytics,
  type DailyQuestion,
  type DailySummary,
  fetchDailyOverview,
  formatDailyDate,
} from "@/lib/daily-summary";
import {
  type ThoughtCard,
  fetchNotesForDate,
} from "@/lib/featured-note";
import { useActiveRecording } from "@/lib/active-recording";

const TYPE_COLORS: Record<string, string> = {
  IDEA: "#D9B44A",
  REFLECTION: "#A97E97",
  QUESTION: "#7E99A6",
  DECISION: "#4E6440",
  TASK: "#C98B6E",
  WISH: "#93A67E",
  PROBLEM: "#8C4F35",
};

const QUESTION_TONES: Record<string, { color: string; borderColor: string }> = {
  decision: { color: "#4E6440", borderColor: "rgba(78,100,64,0.45)" },
  experiment: { color: "#C98B6E", borderColor: "rgba(201,139,110,0.55)" },
  identity: { color: "#A97E97", borderColor: "rgba(169,126,151,0.50)" },
  research: { color: "#7E99A6", borderColor: "rgba(126,153,166,0.55)" },
  action: { color: "#A8862F", borderColor: "rgba(217,180,74,0.60)" },
};

function capitalize(value: string): string {
  return value ? `${value[0].toLocaleUpperCase("de-DE")}${value.slice(1)}` : value;
}

function categoryLabel(category: DailyQuestion["category"]): string {
  const labels: Record<string, string> = {
    decision: "Entscheidung",
    experiment: "Experiment",
    research: "Research",
    identity: "Identität",
    action: "Handlung",
  };
  return labels[category] ?? category;
}

function continuationLabel(category: DailyQuestion["category"]): string {
  const labels: Record<string, string> = {
    decision: "Kriterien & Zeitraum festlegen",
    experiment: "Als kleines Experiment formulieren",
    research: "Als Research Card erkunden",
    identity: "Gedanken dazu weiterführen",
    action: "Kleinste Handlung festhalten",
  };
  return labels[category] ?? "Gedanken dazu weiterführen";
}

function timeRange(notes: ThoughtCard[]): string | null {
  const timestamps = notes
    .map(({ recordedAt }) => new Date(recordedAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  if (!timestamps.length) return null;
  const formatter = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const first = formatter.format(timestamps[0]);
  const last = formatter.format(timestamps[timestamps.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionHeading}>{children}</Text>;
}

export default function DailySummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [analytics, setAnalytics] = useState<DailyAnalytics | null>(null);
  const [notes, setNotes] = useState<ThoughtCard[]>([]);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!date) {
      setError("Kein Datum ausgewählt.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [overview, noteResult] = await Promise.all([
        fetchDailyOverview(date),
        fetchNotesForDate(date).catch(() => ({ notes: [], processingCount: 0 })),
      ]);
      if (!overview.daily) {
        throw new Error("Für diesen Tag gibt es keinen Rückblick.");
      }
      setDaily(overview.daily);
      setAnalytics(overview.analytics);
      setNotes(noteResult.notes);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Unbekannter Fehler",
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const stripTypes = useMemo(() => {
    if (notes.length) {
      return [...notes]
        .sort(
          (a, b) =>
            new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
        )
        .map(({ type }) => type);
    }
    return Object.entries(analytics?.thought_types ?? {}).flatMap(([type, count]) =>
      Array.from({ length: count }, () => type),
    );
  }, [analytics?.thought_types, notes]);

  if (loading) return <NoteLoading />;
  if (error || !daily) {
    return <NoteError message={error ?? "Nicht gefunden"} onRetry={load} />;
  }

  const recordedRange = timeRange(notes);
  const thoughtCount = analytics?.thought_count ?? notes.length;
  const visibleQuestions = questionsExpanded
    ? daily.open_questions
    : daily.open_questions.slice(0, 3);
  const hiddenQuestionCount = Math.max(
    0,
    daily.open_questions.length - visibleQuestions.length,
  );
  const closingQuestion = daily.closing_question || daily.legacy_continuation;
  const reflection = daily.reflective_comment || daily.legacy_direction;

  const shareSummary = () =>
    Share.share({
      title: `Tagesrückblick · ${formatDailyDate(daily.date)}`,
      message: [formatDailyDate(daily.date), daily.summary, closingQuestion]
        .filter(Boolean)
        .join("\n\n"),
    });

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 8,
            paddingBottom:
              insets.bottom + (activeRecording.active ? 112 : 52),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.nav}>
          <Pressable
            accessibilityLabel="Zurück"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={23} color={C.ink60} />
          </Pressable>
          <Pressable
            accessibilityLabel="Tagesrückblick teilen"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => void shareSummary()}
          >
            <Ionicons name="share-outline" size={19} color={C.ink60} />
          </Pressable>
        </View>

        <View style={styles.dayHead}>
          <Text style={styles.kicker}>dein tag</Text>
          <Text style={styles.dayTitle}>
            {capitalize(formatDailyDate(daily.date))}
          </Text>
          <Text style={styles.dayStats}>
            <Text style={styles.dayStatsStrong}>
              {thoughtCount} {thoughtCount === 1 ? "thought" : "thoughts"}
            </Text>
            {analytics ? ` · ${analytics.word_count.toLocaleString("de-DE")} Wörter` : ""}
            {recordedRange ? ` · ${recordedRange}` : ""}
          </Text>
          <View style={styles.typeStrip}>
            {stripTypes.map((type, index) => (
              <View
                key={`${type}-${index}`}
                style={[
                  styles.typeStripItem,
                  { backgroundColor: TYPE_COLORS[type] ?? C.ink30 },
                ]}
              />
            ))}
          </View>
        </View>

        <Text style={styles.summary}>{daily.summary}</Text>

        {reflection ? (
          <View style={styles.reflectionCard}>
            <SectionHeading>ein zweiter blick</SectionHeading>
            <Text style={styles.reflectionText}>{reflection}</Text>
          </View>
        ) : null}

        <SectionHeading>was zusammenhängt</SectionHeading>
        <View style={styles.clusters}>
          {daily.clusters.map((cluster) => (
            <View key={cluster.title} style={styles.cluster}>
              <View style={styles.clusterTopRow}>
                <Text style={styles.clusterTitle}>{cluster.title}</Text>
                <View style={styles.clusterDots}>
                  {cluster.thought_ids.map((id) => (
                    <View key={id} style={styles.clusterDot} />
                  ))}
                </View>
              </View>
              <Text style={styles.clusterDescription}>{cluster.description}</Text>
            </View>
          ))}
        </View>

        <SectionHeading>offene fäden</SectionHeading>
        <View style={styles.threads}>
          {visibleQuestions.map((question, index) => {
            const tone = QUESTION_TONES[question.category] ?? {
              color: C.ink60,
              borderColor: C.border,
            };
            return (
              <View key={`${question.category}-${index}`} style={styles.thread}>
                <View style={[styles.badge, { borderColor: tone.borderColor }]}>
                  <Text style={[styles.badgeText, { color: tone.color }]}>
                    {categoryLabel(question.category)}
                  </Text>
                </View>
                <Text style={styles.threadQuestion}>{question.question}</Text>
                <Text style={styles.continueText}>
                  {continuationLabel(question.category)} ›
                </Text>
              </View>
            );
          })}
        </View>

        {hiddenQuestionCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: questionsExpanded }}
            onPress={() => setQuestionsExpanded(true)}
            style={styles.moreThreads}
          >
            <Text style={styles.moreThreadsText}>
              {hiddenQuestionCount} weitere Fäden⌄
            </Text>
          </Pressable>
        ) : questionsExpanded && daily.open_questions.length > 3 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: true }}
            onPress={() => setQuestionsExpanded(false)}
            style={styles.moreThreads}
          >
            <Text style={styles.moreThreadsText}>weniger anzeigen⌃</Text>
          </Pressable>
        ) : null}

        {closingQuestion ? (
          <View style={styles.closing}>
            <SectionHeading>eine frage zum mitnehmen</SectionHeading>
            <Text style={styles.closingText}>{closingQuestion}</Text>
            <View style={styles.closingMark} />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  content: { paddingHorizontal: 22 },
  nav: {
    minHeight: 38,
    marginBottom: 8,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dayHead: { paddingHorizontal: 4, paddingTop: 4 },
  kicker: {
    marginBottom: 10,
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    fontWeight: "600",
    letterSpacing: 2.25,
    textTransform: "uppercase",
    color: C.ink40,
  },
  dayTitle: {
    marginBottom: 10,
    fontFamily: NOTE_SERIF,
    fontSize: 27,
    lineHeight: 31,
    color: C.ink,
  },
  dayStats: {
    marginBottom: 12,
    fontFamily: NOTE_SANS,
    fontSize: 12,
    color: C.ink40,
  },
  dayStatsStrong: { fontWeight: "600", color: C.ink70 },
  typeStrip: { marginBottom: 22, flexDirection: "row", gap: 3 },
  typeStripItem: { width: 14, height: 10, borderRadius: 3 },
  summary: {
    marginBottom: 30,
    paddingHorizontal: 4,
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    lineHeight: 23,
    color: C.ink70,
  },
  sectionHeading: {
    marginHorizontal: 4,
    marginBottom: 14,
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 2.15,
    textTransform: "uppercase",
    color: C.ink40,
  },
  reflectionCard: {
    marginBottom: 32,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
    borderRadius: 16,
    backgroundColor: "#F0EDE2",
  },
  reflectionText: {
    fontFamily: NOTE_SERIF,
    fontSize: 15,
    lineHeight: 25,
    color: C.ink,
  },
  clusters: { marginHorizontal: 4, marginBottom: 32 },
  cluster: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
  },
  clusterTopRow: {
    marginBottom: 5,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  clusterTitle: {
    flex: 1,
    fontFamily: NOTE_SERIF,
    fontSize: 16.5,
    lineHeight: 22,
    color: C.ink,
  },
  clusterDots: { paddingTop: 7, flexDirection: "row", gap: 3 },
  clusterDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.ink30,
  },
  clusterDescription: {
    fontFamily: NOTE_SANS,
    fontSize: 12.5,
    lineHeight: 20,
    color: C.ink60,
  },
  threads: { marginHorizontal: 4 },
  thread: {
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
  },
  badge: {
    alignSelf: "flex-start",
    marginBottom: 7,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 100,
  },
  badgeText: {
    fontFamily: NOTE_SANS,
    fontSize: 8.5,
    fontWeight: "700",
    letterSpacing: 1.45,
    textTransform: "uppercase",
  },
  threadQuestion: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    lineHeight: 21,
    color: C.ink70,
  },
  continueText: {
    marginTop: 7,
    fontFamily: NOTE_SANS,
    fontSize: 11,
    fontWeight: "600",
    color: C.ink60,
  },
  moreThreads: {
    alignSelf: "flex-start",
    marginTop: 6,
    marginLeft: 4,
    marginBottom: 32,
    paddingVertical: 6,
    paddingRight: 12,
  },
  moreThreadsText: {
    fontFamily: NOTE_SANS,
    fontSize: 11.5,
    fontWeight: "500",
    color: C.ink40,
  },
  closing: {
    paddingHorizontal: 14,
    paddingTop: 38,
    paddingBottom: 30,
    alignItems: "center",
  },
  closingText: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 19,
    lineHeight: 29,
    textAlign: "center",
    color: C.ink,
  },
  closingMark: {
    width: 26,
    height: StyleSheet.hairlineWidth,
    marginTop: 26,
    backgroundColor: C.ink30,
  },
});
