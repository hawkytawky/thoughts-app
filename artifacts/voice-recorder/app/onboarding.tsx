import React, { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import type { Gender } from "@/lib/auth/api";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF_ITALIC,
} from "@/components/NoteUI";

const GENDERS: { value: Gender; label: string }[] = [
  { value: "female", label: "Weiblich" },
  { value: "male", label: "Männlich" },
  { value: "diverse", label: "Divers" },
  { value: "prefer_not_to_say", label: "Keine Angabe" },
];

function buildIsoDate(
  day: string,
  month: string,
  year: string,
): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) {
    return null;
  }
  if (y < 1900 || m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }

  const now = new Date();
  if (date.getTime() > now.getTime()) return null;

  let age = now.getUTCFullYear() - y;
  const hadBirthday =
    now.getUTCMonth() > m - 1 ||
    (now.getUTCMonth() === m - 1 && now.getUTCDate() >= d);
  if (!hadBirthday) age -= 1;
  if (age < 13 || age > 120) return null;

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}`;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { saveProfile, user } = useAuth();

  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const greetingName = user?.given_name ?? user?.display_name ?? null;

  const handleSave = async () => {
    Keyboard.dismiss();
    const isoDate = buildIsoDate(day, month, year);
    if (!isoDate) {
      setError(
        "Bitte gib ein gültiges Geburtsdatum ein – du musst mindestens 13 Jahre alt sein.",
      );
      return;
    }
    if (!gender) {
      setError("Bitte wähle eine Angabe zum Geschlecht.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveProfile({ date_of_birth: isoDate, gender });
      router.replace("/");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Speichern fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <LinearGradient
      colors={["#FDFEFE", "#EEF6FB", "#DCEBF6"]}
      locations={[0, 0.52, 1]}
      style={[
        styles.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 22 },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>
          {greetingName ? `Willkommen, ${greetingName}.` : "Willkommen."}
        </Text>
        <Text style={styles.body}>
          Erzähl uns noch kurz etwas über dich, damit thoughts besser zu dir
          passt.
        </Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Geburtsdatum</Text>
        <View style={styles.dateRow}>
          <TextInput
            style={[styles.input, styles.dateInput]}
            placeholder="TT"
            placeholderTextColor={C.ink40}
            keyboardType="number-pad"
            maxLength={2}
            value={day}
            onChangeText={setDay}
            accessibilityLabel="Tag"
          />
          <TextInput
            style={[styles.input, styles.dateInput]}
            placeholder="MM"
            placeholderTextColor={C.ink40}
            keyboardType="number-pad"
            maxLength={2}
            value={month}
            onChangeText={setMonth}
            accessibilityLabel="Monat"
          />
          <TextInput
            style={[styles.input, styles.yearInput]}
            placeholder="JJJJ"
            placeholderTextColor={C.ink40}
            keyboardType="number-pad"
            maxLength={4}
            value={year}
            onChangeText={setYear}
            accessibilityLabel="Jahr"
          />
        </View>

        <Text style={[styles.label, styles.labelSpacing]}>Geschlecht</Text>
        <View style={styles.genderGrid}>
          {GENDERS.map((option) => {
            const selected = gender === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setGender(option.value)}
                style={[styles.pill, selected && styles.pillSelected]}
              >
                <Text
                  style={[
                    styles.pillText,
                    selected && styles.pillTextSelected,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Weiter"
        disabled={saving}
        onPress={() => void handleSave()}
        style={({ pressed }) => [
          styles.saveButton,
          pressed && styles.saveButtonPressed,
          saving && styles.saveButtonDisabled,
        ]}
      >
        {saving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.saveButtonText}>Weiter</Text>
        )}
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  header: {
    gap: 12,
    paddingTop: 8,
  },
  title: {
    fontFamily: NOTE_SERIF_ITALIC,
    fontSize: 36,
    lineHeight: 40,
    color: C.ink,
  },
  body: {
    maxWidth: 320,
    fontFamily: NOTE_SANS,
    fontSize: 16,
    lineHeight: 24,
    color: C.ink60,
  },
  form: {
    flex: 1,
    justifyContent: "center",
    gap: 12,
  },
  label: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 15,
    color: C.ink70,
  },
  labelSpacing: {
    marginTop: 24,
  },
  dateRow: {
    flexDirection: "row",
    gap: 12,
  },
  input: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 16,
    fontFamily: NOTE_SANS,
    fontSize: 18,
    color: C.ink,
    textAlign: "center",
  },
  dateInput: {
    flex: 1,
  },
  yearInput: {
    flex: 1.6,
  },
  genderGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  pill: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  pillSelected: {
    borderColor: C.skyDeep,
    backgroundColor: C.skyLight,
  },
  pillText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 15,
    color: C.ink70,
  },
  pillTextSelected: {
    color: C.skyDeep,
  },
  error: {
    marginTop: 8,
    fontFamily: NOTE_SANS,
    fontSize: 14,
    lineHeight: 20,
    color: "#9B5260",
  },
  saveButton: {
    minHeight: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.skyDeep,
  },
  saveButtonPressed: {
    opacity: 0.9,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 17,
    color: "#FFFFFF",
  },
});
