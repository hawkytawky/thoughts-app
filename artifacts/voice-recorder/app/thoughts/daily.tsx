import React, { useCallback, useEffect, useState } from "react";
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
import { useActiveRecording } from "@/lib/active-recording";

function categoryLabel(category: DailyQuestion["category"]): string {
  const labels: Record<string, string> = {
    decision: "Entscheidung",
    experiment: "Experiment",
    research: "Recherche",
    identity: "Identität",
    action: "Handlung",
  };
  return labels[category] ?? category;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function DailySummaryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const { date } = useLocalSearchParams<{ date?: string }>();
  const [daily, setDaily] = useState<DailySummary | null>(null);
  const [analytics, setAnalytics] = useState<DailyAnalytics | null>(null);
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
      const overview = await fetchDailyOverview(date);
      if (!overview.daily) {
        throw new Error("Für diesen Tag gibt es keinen Rückblick.");
      }
      setDaily(overview.daily);
      setAnalytics(overview.analytics);
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

  if (loading) return <NoteLoading />;
  if (error || !daily) {
    return <NoteError message={error ?? "Nicht gefunden"} onRetry={load} />;
  }

  const shareSummary = () => {
    const ending =
      daily.closing_question ||
      daily.legacy_direction ||
      daily.legacy_continuation;
    return Share.share({
      title: `Tagesrückblick · ${formatDailyDate(daily.date)}`,
      message: [formatDailyDate(daily.date), daily.summary, ending]
        .filter(Boolean)
        .join("\n\n"),
    });
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 12,
            paddingBottom:
              insets.bottom + (activeRecording.active ? 112 : 44),
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
            <Ionicons name="chevron-back" size={24} color={C.ink60} />
          </Pressable>
          <Text style={styles.navTitle}>tagesrückblick</Text>
          <Pressable
            accessibilityLabel="Tagesrückblick teilen"
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => void shareSummary()}
          >
            <Ionicons name="share-outline" size={20} color={C.ink60} />
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroMark}>
            <Ionicons name="sparkles" size={15} color={C.plumBg} />
          </View>
          <Text style={styles.heroDate}>{formatDailyDate(daily.date)}</Text>
          <Text style={styles.heroSummary}>{daily.summary}</Text>
          <View style={styles.heroFooter}>
            <Text style={styles.heroMeta}>
              {analytics?.thought_count ?? 0}{" "}
              {analytics?.thought_count === 1 ? "thought" : "thoughts"}
            </Text>
            <Text style={styles.heroMeta}>{daily.clusters.length} Themen</Text>
          </View>
        </View>

        <Section title="Themen des Tages">
          <View style={styles.clusters}>
            {daily.clusters.map((cluster, index) => (
              <View key={cluster.title} style={styles.cluster}>
                <View style={styles.clusterNumber}>
                  <Text style={styles.clusterNumberText}>{index + 1}</Text>
                </View>
                <View style={styles.clusterBody}>
                  <Text style={styles.clusterTitle}>{cluster.title}</Text>
                  <Text style={styles.bodyText}>{cluster.description}</Text>
                  <Text style={styles.clusterMeta}>
                    {cluster.thought_ids.length}{" "}
                    {cluster.thought_ids.length === 1 ? "thought" : "thoughts"}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Section>

        <Section title="Reflexion">
          <Text style={styles.reflection}>{daily.reflective_comment}</Text>
        </Section>

        {daily.legacy_direction ? (
          <View style={styles.directionCard}>
            <Text style={styles.directionLabel}>mögliche richtung</Text>
            <Text style={styles.directionText}>{daily.legacy_direction}</Text>
          </View>
        ) : null}

        <Section title="Offene Fragen">
          <View style={styles.questions}>
            {daily.open_questions.map((question, index) => (
              <View key={`${question.category}-${index}`} style={styles.question}>
                <Text style={styles.questionIndex}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <View style={styles.questionBody}>
                  <Text style={styles.questionText}>{question.question}</Text>
                  <Text style={styles.questionCategory}>
                    {categoryLabel(question.category)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Section>

        {daily.closing_question || daily.legacy_continuation ? (
          <View style={styles.closingQuestionCard}>
            <View style={styles.closingQuestionIcon}>
              <Ionicons
                name={daily.closing_question ? "help" : "arrow-forward"}
                size={16}
                color={C.plum}
              />
            </View>
            <View style={styles.closingQuestionBody}>
              <Text style={styles.closingQuestionLabel}>
                {daily.closing_question ? "frage zum weiterdenken" : "weiterführen"}
              </Text>
              <Text style={styles.closingQuestionText}>
                {daily.closing_question || daily.legacy_continuation}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  content: { paddingHorizontal: 20 },
  nav: {
    minHeight: 42,
    paddingHorizontal: 4,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navTitle: {
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    fontWeight: "600",
    letterSpacing: 1.7,
    color: C.plum,
  },
  hero: {
    marginBottom: 35,
    paddingHorizontal: 25,
    paddingTop: 24,
    paddingBottom: 21,
    borderRadius: 22,
    backgroundColor: "#5B3C50",
  },
  heroMark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(234,223,230,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  heroDate: {
    fontFamily: NOTE_SERIF,
    fontSize: 26,
    lineHeight: 33,
    color: C.card,
    marginBottom: 16,
  },
  heroSummary: {
    fontFamily: NOTE_SERIF,
    fontSize: 15,
    lineHeight: 24,
    color: "rgba(253,252,248,0.78)",
  },
  heroFooter: {
    marginTop: 21,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(234,223,230,0.18)",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroMeta: {
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    color: "rgba(234,223,230,0.56)",
  },
  section: { paddingHorizontal: 6, marginBottom: 34 },
  sectionTitle: {
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 1.8,
    textTransform: "uppercase",
    color: C.ink40,
    marginBottom: 14,
  },
  clusters: { gap: 11 },
  cluster: {
    padding: 17,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    flexDirection: "row",
    gap: 13,
  },
  clusterNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.plumBg,
    alignItems: "center",
    justifyContent: "center",
  },
  clusterNumberText: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 12,
    color: C.plum,
  },
  clusterBody: { flex: 1 },
  clusterTitle: {
    fontFamily: NOTE_SERIF,
    fontSize: 17,
    lineHeight: 22,
    color: C.ink,
    marginBottom: 7,
  },
  bodyText: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 21,
    color: C.ink70,
  },
  clusterMeta: {
    marginTop: 9,
    fontFamily: NOTE_SANS,
    fontSize: 10,
    color: C.ink30,
  },
  reflection: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 16,
    lineHeight: 26,
    color: C.ink70,
  },
  directionCard: {
    marginHorizontal: 6,
    marginBottom: 35,
    padding: 21,
    borderRadius: 18,
    backgroundColor: C.plumBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(110,74,97,0.18)",
  },
  directionLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.6,
    color: C.plum,
    marginBottom: 10,
  },
  directionText: {
    fontFamily: NOTE_SERIF,
    fontSize: 16,
    lineHeight: 25,
    color: C.ink,
  },
  questions: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.divider },
  question: {
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
    flexDirection: "row",
    gap: 14,
  },
  questionIndex: {
    width: 22,
    paddingTop: 2,
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 11,
    color: C.ink30,
  },
  questionBody: { flex: 1 },
  questionText: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    lineHeight: 21,
    color: C.ink70,
  },
  questionCategory: {
    marginTop: 7,
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    color: C.plum,
  },
  closingQuestionCard: {
    marginHorizontal: 6,
    marginBottom: 34,
    padding: 19,
    borderRadius: 17,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    flexDirection: "row",
    gap: 13,
  },
  closingQuestionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.plumBg,
    alignItems: "center",
    justifyContent: "center",
  },
  closingQuestionBody: { flex: 1 },
  closingQuestionLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: C.plum,
    marginBottom: 7,
  },
  closingQuestionText: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    lineHeight: 21,
    color: C.ink70,
  },
});
