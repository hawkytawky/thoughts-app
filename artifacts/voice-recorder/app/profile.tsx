import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomTabBar } from "@/components/BottomTabBar";
import {
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SCREEN_TOP_OFFSET,
  NOTE_SERIF,
} from "@/components/NoteUI";
import { useActiveRecording } from "@/lib/active-recording";
import { type Gender, useAuth } from "@/lib/auth";

const COLORS = {
  ink: "#1D3B4F",
  inkSoft: "#6E8A9C",
  inkFaint: "#9FB2BD",
  deep: "#2E5E8C",
  hair: "#DDE5E9",
  card: "#FFFFFF",
  danger: "#9B5F5A",
};

function providerLabel(provider: string | undefined): string {
  const labels: Record<string, string> = {
    apple: "Apple",
    google: "Google",
  };
  if (!provider) return "Nicht verfügbar";
  return labels[provider.toLocaleLowerCase()] ?? provider;
}

function genderLabel(gender: Gender | null | undefined): string {
  const labels: Record<Gender, string> = {
    female: "weiblich",
    male: "männlich",
    diverse: "divers",
    prefer_not_to_say: "keine Angabe",
  };
  return gender ? labels[gender] : "Nicht hinterlegt";
}

function birthDateLabel(value: string | null | undefined): string {
  if (!value) return "Nicht hinterlegt";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "Nicht hinterlegt";
  return new Intl.DateTimeFormat("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function displayName(
  user: {
    display_name: string | null;
    given_name: string | null;
    family_name: string | null;
  } | null,
): string {
  if (!user) return "Dein Account";
  const fullName = [user.given_name, user.family_name]
    .filter(Boolean)
    .join(" ")
    .trim();
  return fullName || user.display_name || "Dein Account";
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.infoRow, !last && styles.rowDivider]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const recording = useActiveRecording();
  const { deleteAccount, signOut, user } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  const performDeletion = async () => {
    setError(null);
    setIsDeleting(true);
    try {
      await deleteAccount();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Der Account konnte nicht gelöscht werden.",
      );
      setIsDeleting(false);
    }
  };

  const confirmDeletion = () => {
    if (recording.active) {
      Alert.alert(
        "Aufnahme läuft",
        "Beende oder verwirf zuerst die laufende Aufnahme, bevor du deinen Account löschst.",
        [{ text: "Verstanden" }],
      );
      return;
    }

    Alert.alert(
      "Account endgültig löschen?",
      "Alle thoughts, Aufnahmen, Transkripte und Zusammenfassungen werden dauerhaft gelöscht. Das kann nicht rückgängig gemacht werden.",
      [
        { text: "Abbrechen", style: "cancel" },
        {
          text: "Alles löschen",
          style: "destructive",
          onPress: () => void performDeletion(),
        },
      ],
    );
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#DBE3E8", "#E7EBEC", "#EAEDED"]}
        locations={[0, 0.46, 1]}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: 170,
            paddingTop: Math.max(insets.top + NOTE_SCREEN_TOP_OFFSET, 0),
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.appBar}>
          <Text style={styles.brand}>thoughts</Text>
          <Text style={styles.pageLabel}>account</Text>
        </View>

        <View style={styles.identity}>
          <Text numberOfLines={2} style={styles.name}>
            {displayName(user)}
          </Text>
          <Text numberOfLines={1} style={styles.email}>
            {user?.email || "Keine E-Mail-Adresse hinterlegt"}
          </Text>
        </View>

        <SectionLabel>PERSÖNLICH</SectionLabel>
        <View style={styles.card}>
          <InfoRow
            label="Geburtsdatum"
            value={birthDateLabel(user?.date_of_birth)}
          />
          <InfoRow label="Angabe" value={genderLabel(user?.gender)} last />
        </View>

        <SectionLabel>ANMELDUNG</SectionLabel>
        <View style={styles.card}>
          <InfoRow
            label="Verbunden mit"
            value={providerLabel(user?.auth_provider)}
          />
          <Pressable
            accessibilityRole="button"
            disabled={isDeleting || isSigningOut}
            onPress={() => void performSignOut()}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.actionLabel}>Abmelden</Text>
            {isSigningOut ? (
              <ActivityIndicator size="small" color={COLORS.inkSoft} />
            ) : (
              <Ionicons
                name="arrow-forward"
                size={17}
                color={COLORS.inkFaint}
              />
            )}
          </Pressable>
        </View>

        <SectionLabel>DATEN</SectionLabel>
        <View style={styles.card}>
          <Pressable
            accessibilityRole="button"
            disabled={isDeleting || isSigningOut}
            onPress={confirmDeletion}
            style={({ pressed }) => [
              styles.actionRow,
              pressed && styles.dangerPressed,
            ]}
          >
            <View style={styles.dangerCopy}>
              <Text style={styles.dangerTitle}>Account und Daten löschen</Text>
              <Text style={styles.dangerHint}>
                Dauerhaft und unwiderruflich
              </Text>
            </View>
            {isDeleting ? (
              <ActivityIndicator size="small" color={COLORS.danger} />
            ) : (
              <Ionicons
                name="arrow-forward"
                size={17}
                color="rgba(155,95,90,0.62)"
              />
            )}
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <BottomTabBar active="account" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#E7EBEC" },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  appBar: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 18,
    letterSpacing: 0.1,
    color: COLORS.ink,
  },
  pageLabel: {
    fontFamily: NOTE_SERIF,
    fontSize: 13.5,
    color: COLORS.inkSoft,
  },
  identity: {
    paddingTop: 42,
    paddingBottom: 38,
  },
  name: {
    maxWidth: 330,
    fontFamily: NOTE_SERIF,
    fontSize: 31,
    lineHeight: 36,
    color: COLORS.ink,
  },
  email: {
    marginTop: 7,
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.inkSoft,
  },
  sectionLabel: {
    marginTop: 20,
    marginBottom: 7,
    marginLeft: 3,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 9.5,
    letterSpacing: 1.35,
    color: COLORS.inkFaint,
  },
  card: {
    paddingHorizontal: 17,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    shadowColor: COLORS.ink,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  infoRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hair,
  },
  infoLabel: {
    flex: 1,
    fontFamily: NOTE_SANS,
    fontSize: 12.5,
    color: COLORS.inkSoft,
  },
  infoValue: {
    maxWidth: "58%",
    fontFamily: NOTE_SANS,
    fontSize: 12.5,
    color: COLORS.ink,
    textAlign: "right",
  },
  actionRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  actionLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    color: COLORS.ink,
  },
  dangerCopy: { flex: 1, paddingVertical: 12 },
  dangerTitle: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    color: COLORS.danger,
  },
  dangerHint: {
    marginTop: 3,
    fontFamily: NOTE_SANS,
    fontSize: 10.5,
    color: "rgba(155,95,90,0.68)",
  },
  error: {
    marginTop: 10,
    paddingHorizontal: 4,
    fontFamily: NOTE_SANS,
    fontSize: 12,
    lineHeight: 18,
    color: COLORS.danger,
  },
  pressed: { opacity: 0.55 },
  dangerPressed: { opacity: 0.58 },
});
