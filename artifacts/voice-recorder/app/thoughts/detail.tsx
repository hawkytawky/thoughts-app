import React, { useCallback, useEffect, useRef, useState } from "react";
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
import * as Clipboard from "expo-clipboard";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SCREEN_CONTENT_TOP_GAP,
  NOTE_SCREEN_TOP_OFFSET,
  NOTE_SANS_SEMIBOLD,
  NOTE_SERIF,
  NOTE_SERIF_ITALIC,
  NoteError,
  NoteLoading,
  NoteTag,
} from "@/components/NoteUI";
import {
  type FeaturedNote,
  deleteThought,
  fetchNoteStatus,
  formatDuration,
  formatNoteDate,
  formatTimestamp,
} from "@/lib/featured-note";
import { useActiveRecording } from "@/lib/active-recording";
import { clearFeedCache } from "@/lib/feed-bootstrap";
import { removePendingThoughtByRemotePath } from "@/lib/pending-thoughts";
import { buildThoughtPdfHtml } from "@/lib/thought-share";

type DetailView = "summary" | "transcript";
const DELETE_COLOR = "#A0524D";

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
          style={[
            styles.pointRow,
            index === items.length - 1 && styles.lastRow,
          ]}
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
          <Text
            key={paragraph}
            style={[styles.paragraph, index > 0 && styles.paragraphGap]}
          >
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

function TranscriptView({
  copied,
  note,
  onCopy,
}: {
  copied: boolean;
  note: FeaturedNote;
  onCopy: () => void;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.transcriptHeader}>
        <Text style={[styles.sectionHeading, styles.transcriptHeading]}>
          Transkript
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            copied ? "Transkript kopiert" : "Transkript kopieren"
          }
          hitSlop={8}
          onPress={onCopy}
          style={({ pressed }) => [
            styles.copyButton,
            pressed && styles.copyButtonPressed,
          ]}
        >
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={17}
            color={copied ? C.skyDeep : C.ink40}
          />
        </Pressable>
      </View>
      {note.transcript.segments.map((segment, index) => (
        <View key={`${segment.start}-${index}`} style={styles.transcriptBlock}>
          <Text style={styles.timestamp}>{formatTimestamp(segment.start)}</Text>
          <Text style={styles.transcriptText}>{segment.text}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ThoughtDetailScreen() {
  const router = useRouter();
  const { path, theme } = useLocalSearchParams<{
    path?: string;
    theme?: string;
  }>();
  const insets = useSafeAreaInsets();
  const activeRecording = useActiveRecording();
  const [note, setNote] = useState<FeaturedNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailView, setDetailView] = useState<DetailView>("summary");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
      setError(
        loadError instanceof Error ? loadError.message : "Unbekannter Fehler",
      );
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
    },
    [],
  );

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

  const performDeletion = async () => {
    if (deleting) return;
    setActionMenuOpen(false);
    setDeleting(true);
    try {
      await deleteThought(note.id);
      await Promise.allSettled([
        clearFeedCache(),
        removePendingThoughtByRemotePath(note.relativePath),
      ]);
      router.back();
    } catch (deleteError) {
      Alert.alert(
        "Löschen nicht möglich",
        deleteError instanceof Error
          ? deleteError.message
          : "Der thought konnte nicht gelöscht werden.",
      );
    } finally {
      setDeleting(false);
    }
  };

  const confirmDeletion = () => {
    Alert.alert(
      "Thought löschen?",
      "Der Thought und seine Aufnahme werden dauerhaft gelöscht. Das kann nicht rückgängig gemacht werden.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Löschen",
          style: "destructive",
          onPress: () => void performDeletion(),
        },
      ],
    );
  };

  const copyTranscript = async () => {
    const transcript =
      note.transcript.text.trim() ||
      note.transcript.segments
        .map(({ text }) => text.trim())
        .filter(Boolean)
        .join("\n\n");
    if (!transcript) {
      Alert.alert("Kein Transkript", "Dieser thought enthält kein Transkript.");
      return;
    }

    try {
      await Clipboard.setStringAsync(transcript);
      setTranscriptCopied(true);
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setTranscriptCopied(false);
        copyFeedbackTimeoutRef.current = null;
      }, 1_600);
    } catch {
      Alert.alert(
        "Kopieren nicht möglich",
        "Das Transkript konnte nicht in die Zwischenablage kopiert werden.",
      );
    }
  };

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.stickyHeader,
          {
            paddingTop: Math.max(insets.top + NOTE_SCREEN_TOP_OFFSET, 0),
          },
        ]}
      >
        <View style={styles.nav}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Zurück"
            hitSlop={8}
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.navButton,
              styles.backButton,
              pressed && styles.navButtonPressed,
            ]}
          >
            <Ionicons name="chevron-back" size={24} color={C.ink60} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Weitere Aktionen"
            accessibilityState={{ disabled: deleting || sharing }}
            disabled={deleting || sharing}
            hitSlop={8}
            onPress={() => setActionMenuOpen(true)}
            style={({ pressed }) => [
              styles.navButton,
              styles.menuButton,
              pressed && styles.navButtonPressed,
            ]}
          >
            {deleting || sharing ? (
              <ActivityIndicator size="small" color={C.skyDeep} />
            ) : (
              <Ionicons name="ellipsis-horizontal" size={23} color={C.ink60} />
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
            paddingTop: NOTE_SCREEN_CONTENT_TOP_GAP,
            paddingBottom: insets.bottom + (activeRecording.active ? 112 : 40),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{note.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.metaText}>
            {formatNoteDate(note.recordedAt, true)}
          </Text>
          <Text style={styles.metaText}>
            {formatDuration(note.durationSeconds)} min
          </Text>
        </View>
        {theme ? <Text style={styles.themeLine}>{theme}</Text> : null}

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
                <Text
                  style={[
                    styles.segmentText,
                    active && styles.segmentTextActive,
                  ]}
                >
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
          <TranscriptView
            copied={transcriptCopied}
            note={note}
            onCopy={() => void copyTranscript()}
          />
        )}
      </ScrollView>
      <BottomSheetModal
        closeLabel="Aktionsmenü schließen"
        onClose={() => setActionMenuOpen(false)}
        visible={actionMenuOpen}
      >
        <View
          style={[
            styles.actionSheet,
            { paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setActionMenuOpen(false);
              setTimeout(() => void shareNote(), 200);
            }}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.actionRowPressed,
            ]}
          >
            <Ionicons name="share-outline" size={21} color={C.ink60} />
            <Text style={styles.actionText}>Teilen</Text>
          </Pressable>
          <View style={styles.actionDivider} />
          <Pressable
            accessibilityRole="button"
            onPress={confirmDeletion}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.actionRowPressed,
            ]}
          >
            <Ionicons name="trash-outline" size={21} color={DELETE_COLOR} />
            <Text style={[styles.actionText, styles.actionDanger]}>
              Löschen
            </Text>
          </Pressable>
        </View>
      </BottomSheetModal>
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
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: { marginLeft: -4 },
  menuButton: { marginRight: -4 },
  navButtonPressed: { opacity: 0.5 },
  title: {
    paddingHorizontal: 6,
    fontFamily: NOTE_SERIF,
    fontSize: 26,
    lineHeight: 33,
    color: C.ink,
    marginBottom: 14,
  },
  metaRow: {
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  metaText: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    lineHeight: 17,
    color: C.ink40,
  },
  themeLine: {
    paddingHorizontal: 6,
    marginTop: 8,
    fontFamily: NOTE_SANS,
    fontSize: 13,
    color: C.ink40,
  },
  segmentedControl: {
    marginHorizontal: 6,
    marginTop: 24,
    marginBottom: 28,
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
    minHeight: 54,
    marginHorizontal: 6,
    marginBottom: 24,
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
  detailsContent: { paddingTop: 4 },
  section: { paddingHorizontal: 6, marginBottom: 26 },
  sectionHeading: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: C.ink40,
    marginBottom: 11,
  },
  paragraph: {
    fontFamily: NOTE_SANS,
    fontSize: 15,
    lineHeight: 23,
    color: C.ink70,
  },
  paragraphGap: { marginTop: 12 },
  pointRow: {
    paddingVertical: 6,
    paddingLeft: 15,
    position: "relative",
  },
  lastRow: {},
  bullet: {
    position: "absolute",
    left: 2,
    top: 14,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.sky,
  },
  pointText: {
    flex: 1,
    fontFamily: NOTE_SANS,
    fontSize: 15,
    lineHeight: 23,
    color: C.ink70,
  },
  stepRow: {
    paddingVertical: 6,
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  transcriptHeader: {
    minHeight: 32,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  transcriptHeading: { marginBottom: 0 },
  copyButton: {
    width: 32,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  copyButtonPressed: { opacity: 0.5 },
  transcriptBlock: { marginBottom: 22 },
  timestamp: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    color: C.ink40,
    marginBottom: 6,
  },
  transcriptText: {
    fontFamily: NOTE_SANS,
    fontSize: 15,
    lineHeight: 23,
    color: C.ink70,
  },
  actionSheet: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingTop: 8,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: C.card,
    shadowColor: C.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  actionRow: {
    minHeight: 54,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  actionRowPressed: { opacity: 0.5 },
  actionText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 15,
    color: C.ink,
  },
  actionDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 45,
    backgroundColor: C.divider,
  },
  actionDanger: { color: DELETE_COLOR },
});
