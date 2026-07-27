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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
} from "@/components/NoteUI";
import { useActiveRecording } from "@/lib/active-recording";
import { useAuth } from "@/lib/auth";

function providerLabel(provider: string | undefined): string {
  return provider === "entra" ? "Microsoft Entra" : provider || "—";
}

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const recording = useActiveRecording();
  const { deleteAccount, signOut, user } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: insets.bottom + 36,
            paddingTop: insets.top + 8,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.appBar}>
          <Pressable
            accessibilityLabel="Zurück"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="chevron-back" size={21} color={C.ink60} />
          </Pressable>
          <Text style={styles.brand}>thoughts</Text>
        </View>

        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Ionicons name="person-outline" size={27} color={C.skyDeep} />
          </View>
          <Text style={styles.title}>{user?.display_name || "Dein Profil"}</Text>
          <Text style={styles.subtitle}>
            Sicher angemeldet und mit deinen thoughts verbunden.
          </Text>
        </View>

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Name</Text>
            <Text numberOfLines={1} style={styles.infoValue}>
              {user?.display_name || "Nicht hinterlegt"}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Anmeldung</Text>
            <Text style={styles.infoValue}>
              {providerLabel(user?.auth_provider)}
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Account-ID</Text>
            <Text numberOfLines={1} style={styles.accountId}>
              {user?.user_id || "—"}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={isDeleting}
          onPress={() => void signOut()}
          style={({ pressed }) => [
            styles.signOutButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="log-out-outline" size={18} color={C.ink60} />
          <Text style={styles.signOutText}>abmelden</Text>
        </Pressable>

        <View style={styles.dangerZone}>
          <Text style={styles.dangerLabel}>Account löschen</Text>
          <Text style={styles.dangerCopy}>
            Entfernt deinen Account und alle damit verbundenen Daten dauerhaft
            aus thoughts.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={isDeleting}
            onPress={confirmDeletion}
            style={({ pressed }) => [
              styles.deleteButton,
              pressed && styles.deleteButtonPressed,
              isDeleting && styles.disabled,
            ]}
          >
            {isDeleting ? (
              <ActivityIndicator color="#9B5F5A" />
            ) : (
              <>
                <Ionicons name="trash-outline" size={17} color="#9B5F5A" />
                <Text style={styles.deleteText}>
                  Account und Daten löschen
                </Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.paper,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  appBar: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  backButton: {
    width: 28,
    height: 28,
    marginLeft: -5,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 12,
    color: C.ink40,
  },
  profileHeader: {
    marginTop: 42,
    alignItems: "center",
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.skyLight,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  title: {
    marginTop: 18,
    fontFamily: NOTE_SERIF,
    fontSize: 29,
    lineHeight: 34,
    color: C.ink,
    textAlign: "center",
  },
  subtitle: {
    maxWidth: 280,
    marginTop: 7,
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 20,
    color: C.ink60,
    textAlign: "center",
  },
  infoCard: {
    marginTop: 36,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  infoRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
  },
  infoLabel: {
    width: 84,
    fontFamily: NOTE_SANS,
    fontSize: 12,
    color: C.ink40,
  },
  infoValue: {
    flex: 1,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 13,
    color: C.ink70,
    textAlign: "right",
  },
  accountId: {
    flex: 1,
    fontFamily: NOTE_SANS,
    fontSize: 11,
    color: C.ink40,
    textAlign: "right",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 102,
    backgroundColor: C.divider,
  },
  signOutButton: {
    minHeight: 50,
    marginTop: 14,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: C.skyLight,
  },
  signOutText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 14,
    color: C.ink60,
  },
  dangerZone: {
    marginTop: "auto",
    paddingTop: 52,
  },
  dangerLabel: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    color: "#9B5F5A",
  },
  dangerCopy: {
    maxWidth: 330,
    marginTop: 7,
    fontFamily: NOTE_SANS,
    fontSize: 12,
    lineHeight: 19,
    color: C.ink40,
  },
  error: {
    marginTop: 10,
    fontFamily: NOTE_SANS,
    fontSize: 12,
    lineHeight: 18,
    color: "#9B5F5A",
  },
  deleteButton: {
    minHeight: 48,
    marginTop: 16,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(155,95,90,0.45)",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  deleteButtonPressed: {
    backgroundColor: "rgba(226,194,184,0.28)",
  },
  deleteText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 13,
    color: "#9B5F5A",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.58,
  },
});
