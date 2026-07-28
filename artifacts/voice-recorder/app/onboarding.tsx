import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import type { Gender } from "@/lib/auth/api";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
  NOTE_SERIF_ITALIC,
} from "@/components/NoteUI";

const KEYBOARD_ACCESSORY_ID = "onboarding-date-accessory";

const GENDERS: {
  value: Gender;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: "female", label: "Weiblich", icon: "female-outline" },
  { value: "male", label: "Männlich", icon: "male-outline" },
  { value: "diverse", label: "Divers", icon: "transgender-outline" },
  {
    value: "prefer_not_to_say",
    label: "Keine Angabe",
    icon: "ellipse-outline",
  },
];

function onlyDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

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

  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);

  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [gender, setGender] = useState<Gender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const greetingName = user?.given_name ?? user?.display_name ?? null;

  const handleDayChange = (value: string) => {
    const next = onlyDigits(value).slice(0, 2);
    setDay(next);
    if (next.length === 2) monthRef.current?.focus();
  };

  const handleMonthChange = (value: string) => {
    const next = onlyDigits(value).slice(0, 2);
    setMonth(next);
    if (next.length === 2) yearRef.current?.focus();
  };

  const handleYearChange = (value: string) => {
    setYear(onlyDigits(value).slice(0, 4));
  };

  const handleSelectGender = (value: Gender) => {
    Keyboard.dismiss();
    setGender(value);
  };

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
        caught instanceof Error ? caught.message : "Speichern fehlgeschlagen.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <LinearGradient
      colors={["#FDFEFE", "#EEF6FB", "#DCEBF6"]}
      locations={[0, 0.52, 1]}
      style={styles.container}
    >
      <View pointerEvents="none" style={styles.atmosphere}>
        <View style={[styles.cloud, styles.cloudOne]} />
        <View style={[styles.cloud, styles.cloudTwo]} />
        <View style={[styles.cloud, styles.cloudThree]} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingTop: insets.top + 28,
              paddingBottom: insets.bottom + 20,
            },
          ]}
        >
          <Text style={styles.brand}>thoughts</Text>

          <View style={styles.header}>
            <Text style={styles.title}>
              {greetingName ? `Willkommen,\n${greetingName}.` : "Willkommen."}
            </Text>
            <Text style={styles.body}>
              Noch zwei kleine Angaben, damit thoughts sich ganz auf dich
              einstellen kann.
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.fieldHeader}>
              <Ionicons name="calendar-outline" size={17} color={C.skyDeep} />
              <Text style={styles.fieldLabel}>Geburtsdatum</Text>
            </View>
            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <TextInput
                  style={styles.input}
                  placeholder="TT"
                  placeholderTextColor={C.ink40}
                  keyboardType="number-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                  maxLength={2}
                  value={day}
                  onChangeText={handleDayChange}
                  returnKeyType="next"
                  accessibilityLabel="Tag"
                />
                <Text style={styles.dateCaption}>Tag</Text>
              </View>
              <View style={styles.dateField}>
                <TextInput
                  ref={monthRef}
                  style={styles.input}
                  placeholder="MM"
                  placeholderTextColor={C.ink40}
                  keyboardType="number-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                  maxLength={2}
                  value={month}
                  onChangeText={handleMonthChange}
                  returnKeyType="next"
                  accessibilityLabel="Monat"
                />
                <Text style={styles.dateCaption}>Monat</Text>
              </View>
              <View style={[styles.dateField, styles.yearField]}>
                <TextInput
                  ref={yearRef}
                  style={styles.input}
                  placeholder="JJJJ"
                  placeholderTextColor={C.ink40}
                  keyboardType="number-pad"
                  inputAccessoryViewID={KEYBOARD_ACCESSORY_ID}
                  maxLength={4}
                  value={year}
                  onChangeText={handleYearChange}
                  returnKeyType="done"
                  accessibilityLabel="Jahr"
                />
                <Text style={styles.dateCaption}>Jahr</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.fieldHeader}>
              <Ionicons name="person-outline" size={17} color={C.skyDeep} />
              <Text style={styles.fieldLabel}>Geschlecht</Text>
            </View>
            <View style={styles.genderGrid}>
              {GENDERS.map((option) => {
                const selected = gender === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => handleSelectGender(option.value)}
                    style={({ pressed }) => [
                      styles.pill,
                      selected && styles.pillSelected,
                      pressed && styles.pillPressed,
                    ]}
                  >
                    <Ionicons
                      name={selected ? "checkmark-circle" : option.icon}
                      size={17}
                      color={selected ? C.skyDeep : C.ink40}
                    />
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
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <Ionicons
                name="information-circle-outline"
                size={17}
                color="#7B5260"
              />
              <Text style={styles.error}>{error}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
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
              <>
                <Text style={styles.saveButtonText}>Los geht’s</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </>
            )}
          </Pressable>
          <Text style={styles.hint}>Privat. Sicher. Nur für dich.</Text>
        </View>
      </KeyboardAvoidingView>

      {Platform.OS === "ios" ? (
        <InputAccessoryView nativeID={KEYBOARD_ACCESSORY_ID}>
          <View style={styles.accessory}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tastatur schließen"
              hitSlop={8}
              onPress={() => Keyboard.dismiss()}
              style={({ pressed }) => [
                styles.accessoryButton,
                pressed && styles.accessoryButtonPressed,
              ]}
            >
              <Text style={styles.accessoryText}>Fertig</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  flex: {
    flex: 1,
  },
  atmosphere: { ...StyleSheet.absoluteFillObject },
  cloud: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.56)",
  },
  cloudOne: {
    width: 320,
    height: 185,
    top: 80,
    right: -150,
    transform: [{ rotate: "-12deg" }],
  },
  cloudTwo: {
    width: 250,
    height: 140,
    top: 260,
    left: -150,
    backgroundColor: "rgba(255,255,255,0.36)",
    transform: [{ rotate: "9deg" }],
  },
  cloudThree: {
    width: 340,
    height: 190,
    bottom: 40,
    right: -200,
    backgroundColor: "rgba(191,217,236,0.22)",
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    gap: 22,
  },
  brand: {
    alignSelf: "flex-start",
    fontFamily: NOTE_SERIF,
    fontSize: 22,
    color: C.ink,
  },
  header: {
    gap: 12,
  },
  title: {
    fontFamily: NOTE_SERIF_ITALIC,
    fontSize: 40,
    lineHeight: 44,
    color: C.ink,
  },
  body: {
    maxWidth: 320,
    fontFamily: NOTE_SANS,
    fontSize: 16,
    lineHeight: 24,
    color: C.ink60,
  },
  card: {
    borderRadius: 26,
    padding: 22,
    backgroundColor: "rgba(255,255,255,0.82)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.1,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 3,
    gap: 16,
  },
  fieldHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fieldLabel: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 15,
    letterSpacing: 0.2,
    color: C.ink70,
  },
  dateRow: {
    flexDirection: "row",
    gap: 12,
  },
  dateField: {
    flex: 1,
    gap: 6,
  },
  yearField: {
    flex: 1.5,
  },
  input: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 14,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 20,
    color: C.ink,
    textAlign: "center",
  },
  dateCaption: {
    textAlign: "center",
    fontFamily: NOTE_SANS,
    fontSize: 12,
    letterSpacing: 0.3,
    color: C.ink40,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.border,
    marginVertical: 2,
  },
  genderGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  pill: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
  },
  pillSelected: {
    borderColor: C.skyDeep,
    backgroundColor: C.skyLight,
  },
  pillPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  pillText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 15,
    color: C.ink70,
  },
  pillTextSelected: {
    color: C.skyDeep,
  },
  errorCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.7)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(123,82,96,0.24)",
  },
  error: {
    flex: 1,
    fontFamily: NOTE_SANS,
    fontSize: 13,
    lineHeight: 19,
    color: "#7B5260",
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 12,
  },
  saveButton: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 18,
    backgroundColor: C.skyDeep,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  saveButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.995 }],
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveButtonText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 17,
    color: "#FFFFFF",
  },
  hint: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    letterSpacing: 0.35,
    color: C.ink30,
    textAlign: "center",
  },
  accessory: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(238,246,251,0.96)",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.border,
  },
  accessoryButton: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: C.skyDeep,
  },
  accessoryButtonPressed: {
    opacity: 0.85,
  },
  accessoryText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 15,
    color: "#FFFFFF",
  },
});
