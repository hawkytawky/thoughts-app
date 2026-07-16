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
  NoteTag,
  noteUiStyles,
} from "@/components/NoteUI";
import {
  type FeaturedNote,
  fetchFeaturedNote,
  fetchNoteStatus,
  formatDuration,
  formatNoteDate,
  formatTimestamp,
} from "@/lib/featured-note";
import { useActiveRecording } from "@/lib/active-recording";

type DetailView = "summary" | "transcript";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>{title}</Text>
      {children}
    </View>
  );
}

function PointList({
  items,
  tone = "plum",
}: {
  items: string[];
  tone?: "plum" | "slate";
}) {
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={`${index}-${item}`}
          style={[styles.pointRow, index === items.length - 1 && styles.lastRow]}
        >
          <View
            style={[
              styles.bullet,
              tone === "slate" && { backgroundColor: C.slate },
            ]}
          />
          <Text style={styles.pointText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function StepList({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={`${index}-${item}`}
          style={[styles.stepRow, index === items.length - 1 && styles.lastRow]}
        >
          <Text style={styles.stepNumber}>{index + 1}</Text>
          <Text style={styles.pointText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function SummaryView({ note }: { note: FeaturedNote }) {
  return (
    <>
      <Section title="Zusammenfassung">
        {note.summary.split(/\n\s*\n/).map((paragraph, index) => (
          <Text key={paragraph} style={[styles.paragraph, index > 0 && styles.paragraphGap]}>
            {paragraph}
          </Text>
        ))}
      </Section>
      {note.keyPoints.length > 0 && (
        <Section title="Kerngedanken">
          <PointList items={note.keyPoints} />
        </Section>
      )}
      {note.openQuestions.length > 0 && (
        <Section title="Offene Fragen">
          <PointList items={note.openQuestions} tone="slate" />
        </Section>
      )}
      {note.decisions.length > 0 && (
        <Section title="Entscheidungen">
          <PointList items={note.decisions} />
        </Section>
      )}
      {note.nextSteps.length > 0 && (
        <Section title="Mögliche nächste Schritte">
          <StepList items={note.nextSteps} />
        </Section>
      )}
      {(note.people.length > 0 || note.projects.length > 0) && (
        <Section title="Personen & Bereiche">
          {note.people.length > 0 && (
            <>
              <Text style={styles.subtleLabel}>Personen</Text>
              <View style={styles.chips}>
                {note.people.map((person) => (
                  <View key={person} style={styles.chip}>
                    <Text style={styles.chipText}>{person}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
          {note.projects.length > 0 && (
            <>
              <Text style={styles.subtleLabel}>Bereiche</Text>
              <View style={styles.chips}>
                {note.projects.map((project) => (
                  <View key={project} style={styles.chip}>
                    <Text style={styles.chipText}>{project}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </Section>
      )}
    </>
  );
}

function TranscriptView({ note }: { note: FeaturedNote }) {
  return (
    <Section title="Transkript">
      {note.transcript.segments.map((segment, index) => (
        <View key={`${segment.start}-${index}`} style={styles.transcriptBlock}>
          <Text style={styles.timestamp}>{formatTimestamp(segment.start)}</Text>
          <Text style={styles.transcriptText}>{segment.text}</Text>
        </View>
      ))}
    </Section>
  );
}

export default function ThoughtDetailScreen() {
  const router = useRouter();
  const { path } = useLocalSearchParams<{ path?: string }>();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const [note, setNote] = useState<FeaturedNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<DetailView>("summary");

  const load = useCallback(async (forceRefresh = false) => {
    setError(null);
    try {
      if (path) {
        const readyNote = await fetchNoteStatus(path);
        if (!readyNote) throw new Error("Diese Note wird noch verarbeitet");
        setNote(readyNote);
      } else {
        setNote(await fetchFeaturedNote(forceRefresh));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unbekannter Fehler");
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <NoteError message={error} onRetry={() => void load(true)} />;
  if (!note) return <NoteLoading />;

  const shareNote = () =>
    Share.share({
      title: note.title,
      message: `${note.title}\n\n${note.summary}`,
    });

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 18,
            paddingBottom:
              insets.bottom + (activeRecording.active ? 112 : 40),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zurück"
            hitSlop={12}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={24} color={C.ink60} />
          </Pressable>
          <Text style={styles.kind}>
            {note.type === "PROBLEM" ? "Problem" : note.type.toLocaleLowerCase("de-DE")}
          </Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Note teilen"
              hitSlop={10}
              onPress={() => void shareNote()}
            >
              <Ionicons name="share-outline" size={20} color={C.ink60} />
            </Pressable>
            <Ionicons name="ellipsis-horizontal" size={20} color={C.ink30} />
          </View>
        </View>

        <Text style={styles.title}>{note.title}</Text>
        <Text style={styles.metaLine}>
          {formatNoteDate(note.recordedAt, true)} · {note.locationLabel} ·{" "}
          {formatDuration(note.durationSeconds)} · {note.wordCount} Wörter
        </Text>
        <View style={[noteUiStyles.tags, styles.headerTags]}>
          {note.tags.map((tag, index) => (
            <NoteTag key={tag} label={tag} index={index} />
          ))}
        </View>

        <View style={styles.segmentedControl}>
          {(["summary", "transcript"] as const).map((view) => {
            const active = detailView === view;
            return (
              <Pressable
                key={view}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setDetailView(view)}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {view === "summary" ? "Summary" : "Transkript"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {detailView === "summary" ? (
          <SummaryView note={note} />
        ) : (
          <TranscriptView note={note} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  content: { paddingHorizontal: 20 },
  nav: {
    minHeight: 38,
    paddingHorizontal: 4,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kind: {
    fontFamily: NOTE_SANS,
    color: C.plum,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2.25,
    textTransform: "uppercase",
  },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  title: {
    paddingHorizontal: 6,
    fontFamily: NOTE_SERIF,
    fontSize: 28,
    lineHeight: 35,
    color: C.ink,
    marginBottom: 12,
  },
  metaLine: {
    paddingHorizontal: 6,
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 12.5,
    lineHeight: 18,
    color: C.ink30,
    marginBottom: 14,
  },
  headerTags: { paddingHorizontal: 6, marginBottom: 10 },
  segmentedControl: {
    marginHorizontal: 6,
    marginTop: 16,
    marginBottom: 26,
    padding: 3,
    borderRadius: 100,
    flexDirection: "row",
    backgroundColor: C.divider,
  },
  segment: { flex: 1, borderRadius: 100, paddingVertical: 9, alignItems: "center" },
  segmentActive: {
    backgroundColor: C.card,
    shadowColor: C.ink,
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentText: {
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    letterSpacing: 1.35,
    textTransform: "uppercase",
    fontWeight: "600",
    color: C.ink40,
  },
  segmentTextActive: { color: C.ink },
  section: { paddingHorizontal: 6, marginBottom: 27 },
  sectionHeading: {
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    fontWeight: "700",
    color: C.ink40,
    marginBottom: 12,
  },
  paragraph: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    lineHeight: 23,
    color: C.ink70,
  },
  paragraphGap: { marginTop: 10 },
  pointRow: {
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
    paddingVertical: 9,
    paddingLeft: 18,
    position: "relative",
  },
  lastRow: { borderBottomWidth: 0 },
  bullet: {
    position: "absolute",
    left: 2,
    top: 17,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.plum,
    opacity: 0.6,
  },
  pointText: {
    flex: 1,
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    lineHeight: 22,
    color: C.ink70,
  },
  stepRow: {
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
    paddingVertical: 9,
    flexDirection: "row",
    gap: 18,
  },
  stepNumber: {
    width: 16,
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 14,
    color: C.ink30,
  },
  subtleLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 9,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontWeight: "600",
    color: C.ink30,
    marginTop: 2,
    marginBottom: 8,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: {
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    borderRadius: 100,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  chipText: { fontFamily: NOTE_SANS, fontSize: 11.5, color: C.ink70 },
  transcriptBlock: { marginBottom: 16 },
  timestamp: {
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 11,
    color: C.ink30,
    marginBottom: 4,
  },
  transcriptText: {
    fontFamily: NOTE_SANS,
    fontSize: 14,
    lineHeight: 24,
    color: C.ink70,
  },
});
