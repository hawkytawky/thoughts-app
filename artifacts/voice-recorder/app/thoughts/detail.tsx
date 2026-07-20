import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
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
  NOTE_SANS_MEDIUM,
  NOTE_SANS_SEMIBOLD,
  NOTE_SERIF,
  NOTE_SERIF_ITALIC,
  NoteError,
  NoteLoading,
  NoteTag,
  NOTE_CATEGORY_TEXT_OPACITY,
  noteCategoryColor,
} from "@/components/NoteUI";
import {
  type FeaturedNote,
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

function SummaryView({
  note,
  detailsExpanded,
  onToggleDetails,
}: {
  note: FeaturedNote;
  detailsExpanded: boolean;
  onToggleDetails: () => void;
}) {
  const detailCount = [
    note.openQuestions.length > 0,
    note.decisions.length > 0,
    note.nextSteps.length > 0,
    note.people.length > 0 || note.projects.length > 0,
    note.tags.length > 0,
  ].filter(Boolean).length;

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
      {detailCount > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: detailsExpanded }}
          onPress={onToggleDetails}
          style={({ pressed }) => [
            styles.detailsToggle,
            pressed && styles.detailsTogglePressed,
          ]}
        >
          <Text style={styles.detailsToggleText}>
            Weitere Details · {detailCount}
          </Text>
          <Ionicons
            name={detailsExpanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={C.ink40}
          />
        </Pressable>
      )}
      {detailsExpanded && (
        <View style={styles.detailsContent}>
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
          {note.tags.length > 0 && (
            <Section title="Tags">
              <View style={styles.chips}>
                {note.tags.map((tag, index) => (
                  <NoteTag key={tag} label={tag} index={index} />
                ))}
              </View>
            </Section>
          )}
        </View>
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
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    if (!path) {
      setError("Kein thought ausgewählt");
      return;
    }
    try {
      const readyNote = await fetchNoteStatus(path);
      if (!readyNote) throw new Error("Dieser thought wird noch verarbeitet");
      setNote(readyNote);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unbekannter Fehler");
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <NoteError message={error} onRetry={() => void load()} />;
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
        <Text style={styles.title}>{note.title}</Text>
        <Text style={styles.metaLine}>
          {formatNoteDate(note.recordedAt)} · {formatDuration(note.durationSeconds)} min
        </Text>

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
          <SummaryView
            detailsExpanded={detailsExpanded}
            note={note}
            onToggleDetails={() => {
              LayoutAnimation.configureNext(
                LayoutAnimation.Presets.easeInEaseOut,
              );
              setDetailsExpanded((expanded) => !expanded);
            }}
          />
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
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 13,
    opacity: NOTE_CATEGORY_TEXT_OPACITY,
  },
  title: {
    paddingHorizontal: 6,
    fontFamily: NOTE_SERIF,
    fontSize: 26,
    lineHeight: 33,
    color: C.ink,
    marginBottom: 8,
  },
  metaLine: {
    paddingHorizontal: 6,
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 17,
    color: C.ink40,
    marginBottom: 8,
  },
  segmentedControl: {
    marginHorizontal: 6,
    marginTop: 7,
    marginBottom: 20,
    padding: 3,
    borderRadius: 99,
    backgroundColor: C.skyLight,
    flexDirection: "row",
  },
  segment: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 99,
    alignItems: "center",
  },
  segmentActive: {
    backgroundColor: C.card,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.07,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentText: {
    fontFamily: NOTE_SANS_SEMIBOLD,
    fontSize: 10.5,
    letterSpacing: 1.35,
    textTransform: "uppercase",
    color: C.inactive,
  },
  segmentTextActive: { color: C.ink60 },
  detailsToggle: {
    minHeight: 48,
    marginHorizontal: 6,
    marginBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailsTogglePressed: { opacity: 0.55 },
  detailsToggleText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    color: C.ink60,
  },
  detailsContent: { paddingTop: 2 },
  section: { paddingHorizontal: 6, marginBottom: 14 },
  sectionHeading: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
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
    fontFamily: NOTE_SERIF_ITALIC,
    fontSize: 14,
    color: C.ink40,
  },
  subtleLabel: {
    fontFamily: NOTE_SANS_SEMIBOLD,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
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
