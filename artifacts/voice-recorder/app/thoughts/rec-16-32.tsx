import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SERIF,
  NoteError,
  NoteLoading,
  NoteTag,
  NOTE_CATEGORY_TEXT_OPACITY,
  noteCategoryColor,
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
import { buildThoughtPdfHtml } from "@/lib/thought-share";

type DetailView = "summary" | "transcript";

function categoryLabel(type: string): string {
  const labels: Record<string, string> = {
    IDEA: "Idee",
    REFLECTION: "Reflexion",
    DECISION: "Entscheidung",
    QUESTION: "Frage",
    TASK: "Aufgabe",
    PROBLEM: "Problem",
    OBSERVATION: "Beobachtung",
  };
  return labels[type] ?? type.toLocaleLowerCase("de-DE");
}

function noteTime(isoDate: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
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
                {note.people.map((person, index) => (
                  <NoteTag key={person} label={person} index={index} />
                ))}
              </View>
            </>
          )}
          {note.projects.length > 0 && (
            <>
              <Text style={styles.subtleLabel}>Bereiche</Text>
              <View style={styles.chips}>
                {note.projects.map((project, index) => (
                  <NoteTag
                    key={project}
                    label={project}
                    index={note.people.length + index}
                  />
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
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async (forceRefresh = false) => {
    setError(null);
    try {
      if (path) {
        const readyNote = await fetchNoteStatus(path);
        if (!readyNote) throw new Error("Dieser thought wird noch verarbeitet");
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

  const shareNote = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const { uri } = await Print.printToFileAsync({
        html: buildThoughtPdfHtml(note),
        width: 390,
        height: 700,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          UTI: "com.adobe.pdf",
          mimeType: "application/pdf",
          dialogTitle: "thought teilen",
        });
      } else {
        await Share.share({
          title: note.title,
          message: `${note.title}\n\n${note.summary}`,
        });
      }
    } catch (shareError) {
      Alert.alert(
        "Teilen nicht möglich",
        shareError instanceof Error
          ? shareError.message
          : "Das thought-Dokument konnte nicht erstellt werden.",
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.stickyHeader, { paddingTop: insets.top + 10 }]}>
        <View style={styles.nav}>
          <View style={styles.navLeft}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zurück"
              hitSlop={12}
              onPress={() => router.back()}
            >
              <Ionicons name="chevron-back" size={24} color={C.ink60} />
            </Pressable>
            <Text
              style={[styles.kind, { color: noteCategoryColor(note.type) }]}
            >
              {categoryLabel(note.type)}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="thought teilen"
            accessibilityState={{ disabled: sharing }}
            disabled={sharing}
            hitSlop={10}
            onPress={() => void shareNote()}
          >
            {sharing ? (
              <ActivityIndicator size="small" color={C.skyDeep} />
            ) : (
              <Ionicons name="share-outline" size={20} color={C.ink60} />
            )}
          </Pressable>
        </View>
        <LinearGradient
          colors={["rgba(249,249,248,0.96)", "rgba(249,249,248,0)"]}
          locations={[0, 1]}
          pointerEvents="none"
          style={styles.headerFade}
        />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: 10,
            paddingBottom:
              insets.bottom + (activeRecording.active ? 112 : 40),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.metaLine}>
          {formatNoteDate(note.recordedAt, true)}, {noteTime(note.recordedAt)} ·{" "}
          {note.locationLabel} · {formatDuration(note.durationSeconds)} min ·{" "}
          {note.wordCount} Wörter
        </Text>
        <Text style={styles.title}>{note.title}</Text>
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
                style={styles.segment}
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
  stickyHeader: {
    paddingHorizontal: 20,
    backgroundColor: C.paper,
    zIndex: 2,
  },
  headerFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -14,
    height: 14,
  },
  nav: {
    minHeight: 38,
    paddingHorizontal: 4,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  kind: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    fontWeight: "500",
    opacity: NOTE_CATEGORY_TEXT_OPACITY,
  },
  title: {
    paddingHorizontal: 6,
    fontFamily: NOTE_SERIF,
    fontSize: 28,
    lineHeight: 35,
    color: C.ink,
    marginBottom: 13,
  },
  metaLine: {
    paddingHorizontal: 6,
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 17,
    color: C.ink40,
    marginBottom: 8,
  },
  headerTags: { paddingHorizontal: 6, marginBottom: 4 },
  segmentedControl: {
    marginHorizontal: 6,
    marginBottom: 18,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
    flexDirection: "row",
  },
  segment: { flex: 1, paddingVertical: 10, alignItems: "center" },
  segmentText: {
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    letterSpacing: 1.35,
    textTransform: "uppercase",
    fontWeight: "600",
    color: C.inactive,
  },
  segmentTextActive: { color: C.ink60 },
  section: { paddingHorizontal: 6, marginBottom: 14 },
  sectionHeading: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "500",
    color: C.ink40,
    marginBottom: 8,
  },
  paragraph: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 21,
    color: C.ink70,
  },
  paragraphGap: { marginTop: 8 },
  pointRow: {
    paddingVertical: 4,
    paddingLeft: 15,
    position: "relative",
  },
  lastRow: {},
  bullet: {
    position: "absolute",
    left: 2,
    top: 12,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.sky,
  },
  pointText: {
    flex: 1,
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 21,
    color: C.ink70,
  },
  stepRow: {
    paddingVertical: 4,
    flexDirection: "row",
    gap: 12,
  },
  stepNumber: {
    width: 16,
    fontFamily: NOTE_SERIF,
    fontStyle: "italic",
    fontSize: 14,
    color: C.ink40,
  },
  subtleLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontWeight: "600",
    color: C.ink40,
    marginTop: 2,
    marginBottom: 8,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  transcriptBlock: { marginBottom: 16 },
  timestamp: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    color: C.ink40,
    marginBottom: 4,
  },
  transcriptText: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 21,
    color: C.ink70,
  },
});
