import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  NOTE_SANS,
  NOTE_SERIF,
  ThoughtLoading,
} from "@/components/NoteUI";
import { MEMORY_FRAME, MEMORY_THEME } from "@/lib/memory-theme";
import type {
  WeeklyBriefingArchive,
  WeeklyBriefingEntry,
  WeeklyObservation,
} from "@/lib/weekly-briefings";

const MONTHS = [
  "JAN",
  "FEB",
  "MÄR",
  "APR",
  "MAI",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OKT",
  "NOV",
  "DEZ",
] as const;

type Props = {
  archive: WeeklyBriefingArchive | null;
  onRetry: () => void;
  status: "loading" | "error" | "ready";
};

function localDateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

function periodLabel(entry: WeeklyBriefingEntry): string {
  const start = localDateParts(entry.local_start_date);
  const end = localDateParts(entry.local_end_date);
  const startMonth = MONTHS[start.month - 1] ?? "";
  const endMonth = MONTHS[end.month - 1] ?? "";
  const startLabel =
    start.month === end.month
      ? `${start.day}.`
      : `${start.day}. ${startMonth}`;
  return `${startLabel} – ${end.day}. ${endMonth}`;
}

function spokenHours(seconds: number): string {
  if (seconds === 0) return "0";
  return String(Math.max(1, Math.round(seconds / 3600)));
}

function HighlightedObservation({ observation }: { observation: WeeklyObservation }) {
  const { highlight, text } = observation;
  if (!highlight) return <Text style={styles.observation}>{text}</Text>;
  const index = text.indexOf(highlight);
  if (index < 0) return <Text style={styles.observation}>{text}</Text>;
  return (
    <Text style={styles.observation}>
      {text.slice(0, index)}
      <Text style={styles.highlight}>{highlight}</Text>
      {text.slice(index + highlight.length)}
    </Text>
  );
}

function Metrics({ archive }: { archive: WeeklyBriefingArchive }) {
  const { metrics } = archive;
  return (
    <View accessibilityLabel="Gesamtstatistik" style={styles.metrics}>
      <View style={styles.metric}>
        <Text adjustsFontSizeToFit numberOfLines={1} style={styles.metricValue}>
          {metrics.thought_count}
        </Text>
        <Text style={styles.metricLabel}>thoughts</Text>
      </View>
      <View style={styles.metric}>
        <Text adjustsFontSizeToFit numberOfLines={1} style={styles.metricValue}>
          {spokenHours(metrics.spoken_seconds)}
          <Text style={styles.metricUnit}> h</Text>
        </Text>
        <Text style={styles.metricLabel}>gesprochen</Text>
      </View>
      <View style={styles.metric}>
        <Text adjustsFontSizeToFit numberOfLines={1} style={styles.metricValue}>
          {metrics.active_streak_days}
          <Text style={styles.metricUnit}> d</Text>
        </Text>
        <Text style={styles.metricLabel}>am Stück</Text>
      </View>
    </View>
  );
}

function SkippedBriefing({ entry }: { entry: WeeklyBriefingEntry }) {
  return (
    <View style={styles.briefing}>
      <View style={styles.kicker}>
        <Text style={styles.kickerText}>{periodLabel(entry)}</Text>
        <Text style={styles.kickerText}>
          {entry.source_thought_count} THOUGHTS
        </Text>
      </View>
      <Text style={styles.skippedTitle}>Noch kein Briefing für diese Woche.</Text>
      <Text style={styles.skippedText}>
        Für ein aussagekräftiges Briefing braucht es mindestens{" "}
        {entry.minimum_thought_count} Thoughts. Diese Woche waren es{" "}
        {entry.source_thought_count}.
      </Text>
    </View>
  );
}

function CompletedBriefing({ entry }: { entry: WeeklyBriefingEntry }) {
  const content = entry.content;
  if (!content) return null;
  return (
    <View style={styles.briefing}>
      <View style={styles.kicker}>
        <Text style={styles.kickerText}>{periodLabel(entry)}</Text>
        <Text style={styles.kickerText}>
          {entry.source_thought_count} THOUGHTS
        </Text>
      </View>
      <Text style={styles.lead}>{content.lead}</Text>
      {content.observations.map((observation, index) => (
        <HighlightedObservation
          key={`${entry.id}-observation-${index}`}
          observation={observation}
        />
      ))}
      {content.quote ? (
        <View style={styles.quoteBlock}>
          <Text style={styles.sectionLabel}>SATZ DER WOCHE</Text>
          <Text style={styles.quote}>
            <Text style={styles.quoteMark}>„</Text>
            {content.quote.text}“
          </Text>
        </View>
      ) : null}
      <View style={styles.rule} />
      {content.nudge ? (
        <>
          <Text style={styles.sectionLabel}>ANREGUNG</Text>
          <Text style={styles.nudge}>{content.nudge}</Text>
        </>
      ) : null}
      <Text style={styles.sectionLabel}>ZUM NACHDENKEN</Text>
      <Text style={styles.question}>
        <Text style={styles.questionMark}>„{"\n"}</Text>
        {content.question}
      </Text>
    </View>
  );
}

export function MemoryBriefing({ archive, onRetry, status }: Props) {
  if (status === "loading" && !archive) {
    return (
      <View style={styles.centered}>
        <ThoughtLoading compact label="Memory wird für dich geordnet …" />
      </View>
    );
  }
  if (status === "error" && !archive) {
    return (
      <View style={styles.centered}>
        <Text style={styles.stateText}>Briefings konnten nicht geladen werden.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>Erneut versuchen</Text>
        </Pressable>
      </View>
    );
  }
  if (!archive) return null;

  return (
    <ScrollView
      alwaysBounceVertical
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Metrics archive={archive} />
      {archive.entries.length === 0 ? (
        <View style={styles.briefing}>
          <Text style={styles.emptyTitle}>Dein erstes Wochenbriefing</Text>
          <Text style={styles.skippedText}>
            Jeden Sonntag um 18 Uhr erscheint hier, was erst im Vergleich deiner
            Thoughts sichtbar wird.
          </Text>
        </View>
      ) : (
        archive.entries.map((entry) =>
          entry.status === "completed" ? (
            <CompletedBriefing entry={entry} key={entry.id} />
          ) : (
            <SkippedBriefing entry={entry} key={entry.id} />
          ),
        )
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: MEMORY_FRAME.horizontalPadding,
    paddingTop: 24,
    paddingBottom: 136,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
    transform: [{ translateY: -50 }],
  },
  stateText: {
    fontFamily: "Newsreader_300Light_Italic",
    fontSize: 15,
    lineHeight: 22,
    color: "#9FB2BD",
    textAlign: "center",
  },
  retry: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  retryText: { fontFamily: NOTE_SANS, fontSize: 12, color: "#2E5E8C" },
  pressed: { opacity: 0.58 },
  metrics: { flexDirection: "row", alignItems: "flex-start" },
  metric: { flex: 1, alignItems: "center" },
  metricValue: {
    maxWidth: "100%",
    fontFamily: NOTE_SERIF,
    fontSize: 40,
    lineHeight: 43,
    letterSpacing: -1,
    color: MEMORY_THEME.ink,
  },
  metricUnit: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    letterSpacing: 0,
    color: MEMORY_THEME.muted,
  },
  metricLabel: {
    marginTop: 5,
    fontFamily: NOTE_SANS,
    fontSize: 11.5,
    color: MEMORY_THEME.muted,
  },
  briefing: { marginTop: 44 },
  kicker: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  kickerText: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    letterSpacing: 1.32,
    color: MEMORY_THEME.muted,
  },
  lead: {
    marginBottom: 18,
    fontFamily: NOTE_SERIF,
    fontSize: 23,
    lineHeight: 30.4,
    letterSpacing: -0.28,
    color: MEMORY_THEME.ink,
  },
  observation: {
    marginBottom: 14,
    fontFamily: NOTE_SERIF,
    fontSize: 16.5,
    lineHeight: 26.4,
    color: "#3F4D59",
  },
  highlight: {
    color: MEMORY_THEME.ink,
    backgroundColor: "rgba(127, 176, 214, 0.22)",
  },
  quoteBlock: { marginTop: 8 },
  sectionLabel: {
    marginBottom: 9,
    fontFamily: NOTE_SANS,
    fontSize: 11,
    letterSpacing: 1.32,
    color: MEMORY_THEME.muted,
  },
  quote: {
    fontFamily: "Newsreader_300Light_Italic",
    fontSize: 19,
    lineHeight: 27,
    color: MEMORY_THEME.ink,
  },
  quoteMark: { fontFamily: NOTE_SERIF, fontSize: 30, color: "#C9D5DE" },
  rule: { height: 1, marginTop: 26, marginBottom: 22, backgroundColor: "#E3E7EB" },
  nudge: {
    marginBottom: 26,
    fontFamily: NOTE_SERIF,
    fontSize: 17,
    lineHeight: 25.5,
    color: "#3F4D59",
  },
  question: {
    fontFamily: "Newsreader_300Light_Italic",
    fontSize: 21,
    lineHeight: 29.8,
    color: MEMORY_THEME.ink,
  },
  questionMark: { fontFamily: NOTE_SERIF, fontSize: 40, lineHeight: 22, color: "#C9D5DE" },
  skippedTitle: {
    marginBottom: 10,
    fontFamily: NOTE_SERIF,
    fontSize: 23,
    lineHeight: 30.4,
    color: MEMORY_THEME.ink,
  },
  emptyTitle: {
    marginBottom: 10,
    fontFamily: NOTE_SERIF,
    fontSize: 23,
    lineHeight: 30.4,
    color: MEMORY_THEME.ink,
  },
  skippedText: {
    fontFamily: NOTE_SERIF,
    fontSize: 16.5,
    lineHeight: 26.4,
    color: "#3F4D59",
  },
});
