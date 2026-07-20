import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export const NOTE_COLORS = {
  warmWhite: "#FBFAF7",
  paper: "#F9F9F8",
  card: "#FFFFFF",
  skyLight: "#EAF2F8",
  border: "#BFD9EC",
  sky: "#7FB0D6",
  skyDeep: "#2E5E8C",
  ink: "#24455F",
  ink70: "#3D5A73",
  ink60: "#5F7E96",
  ink40: "#8AA3B8",
  ink30: "#8AA3B8",
  inactive: "#AFC5D6",
  divider: "#E2EDF6",
  plum: "#2E5E8C",
  plumBg: "#EAF2F8",
  sage: "#3E5546",
  sageBg: "#C0CBC3",
  slate: "#7FB0D6",
  slateBg: "#EAF2F8",
  terra: "#6F4235",
  terraBg: "#E2C2B8",
  ochre: "#655724",
  ochreBg: "#EBDFB8",
  clay: "#48415F",
  clayBg: "#CBC6DA",
} as const;

export const NOTE_CATEGORY_COLORS = {
  IDEA: {
    text: "#9A824F",
    level1: "#C2A25A",
    level2: "#D2B476",
    surface: "#EBDFB8",
  },
  REFLECTION: {
    text: "#777191",
    level1: "#948DB8",
    level2: "#A9A3C6",
    surface: "#CBC6DA",
  },
  DECISION: {
    text: "#A97465",
    level1: "#C68F7E",
    level2: "#D3A392",
    surface: "#E2C2B8",
  },
  QUESTION: {
    text: "#708B75",
    level1: "#8AA98F",
    level2: "#9FB8A4",
    surface: "#C0CBC3",
  },
  OBSERVATION: {
    text: "#6F8FA8",
    level1: "#89AFC6",
    level2: "#A3BED0",
    surface: "#C8DCE8",
  },
} as const;

export const NOTE_CATEGORY_TEXT_OPACITY = 1;

export function noteCategoryColor(type: string): string {
  return (
    NOTE_CATEGORY_COLORS[type as keyof typeof NOTE_CATEGORY_COLORS]?.text ??
    NOTE_COLORS.skyDeep
  );
}

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
  ["rgba(203,198,218,0.45)", NOTE_COLORS.clay],
  ["rgba(192,203,195,0.45)", NOTE_COLORS.sage],
  ["rgba(226,194,184,0.45)", NOTE_COLORS.terra],
  ["rgba(235,223,184,0.45)", NOTE_COLORS.ochre],
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
      <Text style={styles.stateTitle}>thought gerade nicht erreichbar</Text>
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
  tag: { borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    fontWeight: "500",
    opacity: 0.78,
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
