import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export const NOTE_COLORS = {
  paper: "#F4F1E9",
  card: "#FDFCF8",
  border: "#DCD7C9",
  ink: "#1C221A",
  ink70: "rgba(28,34,26,0.70)",
  ink60: "rgba(28,34,26,0.62)",
  ink40: "rgba(28,34,26,0.42)",
  ink30: "rgba(28,34,26,0.32)",
  divider: "#ECE8DC",
  plum: "#6E4A61",
  plumBg: "#EADFE6",
  sage: "#4E6440",
  sageBg: "#E3E9DA",
  slate: "#43616F",
  slateBg: "#DFE6EA",
  terra: "#8C4F35",
  terraBg: "#F0E0D6",
  ochre: "#8A6B2B",
  ochreBg: "#F1E7CF",
  clay: "#6B584A",
  clayBg: "#EAE2DA",
} as const;

export const NOTE_SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, serif",
});

export const NOTE_SANS = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "sans-serif",
});

const TAG_PALETTES = [
  [NOTE_COLORS.plumBg, NOTE_COLORS.plum],
  [NOTE_COLORS.ochreBg, NOTE_COLORS.ochre],
  [NOTE_COLORS.sageBg, NOTE_COLORS.sage],
  [NOTE_COLORS.clayBg, NOTE_COLORS.clay],
] as const;

export function NoteTag({ label, index }: { label: string; index: number }) {
  const [backgroundColor, color] = TAG_PALETTES[index % TAG_PALETTES.length];
  return (
    <View style={[styles.tag, { backgroundColor }]}>
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

export function NoteLoading() {
  return (
    <View style={styles.stateScreen}>
      <ActivityIndicator color={NOTE_COLORS.plum} />
      <Text style={styles.stateText}>Gedanken werden geladen …</Text>
    </View>
  );
}

export function NoteError({
  message,
  onRetry,
  onRecord,
}: {
  message: string;
  onRetry: () => void;
  onRecord?: () => void;
}) {
  return (
    <View style={styles.stateScreen}>
      <Ionicons name="cloud-offline-outline" size={32} color={NOTE_COLORS.ink40} />
      <Text style={styles.stateTitle}>Note gerade nicht erreichbar</Text>
      <Text style={styles.stateText}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryButton}>
        <Text style={styles.retryText}>Noch einmal versuchen</Text>
      </Pressable>
      {onRecord && (
        <Pressable onPress={onRecord} style={styles.recordFallbackButton}>
          <Ionicons name="mic" size={17} color={NOTE_COLORS.card} />
          <Text style={styles.recordFallbackText}>Neue Aufnahme</Text>
        </Pressable>
      )}
    </View>
  );
}

export const noteUiStyles = StyleSheet.create({
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
});

const styles = StyleSheet.create({
  tag: { borderRadius: 100, paddingHorizontal: 9, paddingVertical: 5 },
  tagText: {
    fontFamily: NOTE_SANS,
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.35,
  },
  stateScreen: {
    flex: 1,
    backgroundColor: NOTE_COLORS.paper,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 12,
  },
  stateTitle: {
    fontFamily: NOTE_SERIF,
    color: NOTE_COLORS.ink,
    fontSize: 20,
    textAlign: "center",
  },
  stateText: {
    fontFamily: NOTE_SANS,
    color: NOTE_COLORS.ink40,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: NOTE_COLORS.border,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  retryText: {
    fontFamily: NOTE_SANS,
    fontSize: 12,
    color: NOTE_COLORS.ink70,
  },
  recordFallbackButton: {
    marginTop: 2,
    borderRadius: 22,
    paddingHorizontal: 17,
    paddingVertical: 10,
    backgroundColor: NOTE_COLORS.ink,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  recordFallbackText: {
    fontFamily: NOTE_SANS,
    fontSize: 12,
    color: NOTE_COLORS.card,
  },
});
