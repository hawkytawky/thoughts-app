import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import { NOTE_COLORS as C, NOTE_SANS, NOTE_SERIF } from "@/components/NoteUI";
import { fetchThoughtDays, formatApiDate } from "@/lib/featured-note";

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function monthTitle(date: Date): string {
  const title = new Intl.DateTimeFormat("de-DE", {
    month: "long",
    year: "numeric",
  }).format(date);
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function DayPicker({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: Date;
  onChange: (date: Date) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const today = startOfDay(new Date());
  const [month, setMonth] = useState(() => monthStart(value));
  const [thoughtDays, setThoughtDays] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (visible) setMonth(monthStart(value));
  }, [value, visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const apiMonth = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
    setThoughtDays(new Set());
    void fetchThoughtDays(apiMonth)
      .then((days) => {
        if (!cancelled) setThoughtDays(days);
      })
      .catch(() => {
        if (!cancelled) setThoughtDays(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [month, visible]);

  const days = useMemo(() => {
    const leadingDays = (month.getDay() + 6) % 7;
    return Array.from(
      { length: 42 },
      (_, index) =>
        new Date(
          month.getFullYear(),
          month.getMonth(),
          index - leadingDays + 1,
          12,
        ),
    );
  }, [month]);

  const canGoForward = month < monthStart(today);

  return (
    <BottomSheetModal
      closeLabel="Datumsauswahl schließen"
      onClose={onClose}
      visible={visible}
    >
      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}
      >
        <View style={styles.handle} />
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.eyebrow}>TAG AUSWÄHLEN</Text>
            <Text style={styles.selectedDate}>
              {new Intl.DateTimeFormat("de-DE", {
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(value)}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Heute anzeigen"
            onPress={() => onChange(today)}
            style={({ pressed }) => [
              styles.todayButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.todayText}>Heute</Text>
          </Pressable>
        </View>

        <View style={styles.monthHeader}>
          <Pressable
            accessibilityLabel="Vorheriger Monat"
            hitSlop={10}
            onPress={() =>
              setMonth(
                new Date(month.getFullYear(), month.getMonth() - 1, 1, 12),
              )
            }
            style={({ pressed }) => [
              styles.monthButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="chevron-back" size={18} color={C.ink60} />
          </Pressable>
          <Text style={styles.monthTitle}>{monthTitle(month)}</Text>
          <Pressable
            accessibilityLabel="Nächster Monat"
            disabled={!canGoForward}
            hitSlop={10}
            onPress={() =>
              setMonth(
                new Date(month.getFullYear(), month.getMonth() + 1, 1, 12),
              )
            }
            style={({ pressed }) => [
              styles.monthButton,
              !canGoForward && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="chevron-forward" size={18} color={C.ink60} />
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAYS.map((weekday) => (
            <Text key={weekday} style={styles.weekday}>
              {weekday}
            </Text>
          ))}
        </View>
        <View style={styles.daysGrid}>
          {days.map((date) => {
            const key = formatApiDate(date);
            const selected = key === formatApiDate(value);
            const isToday = key === formatApiDate(today);
            const outsideMonth = date.getMonth() !== month.getMonth();
            const future = date > today;
            const hasThoughts = thoughtDays.has(key);
            return (
              <View key={key} style={styles.dayCell}>
                <Pressable
                  accessibilityLabel={new Intl.DateTimeFormat("de-DE", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(date)}
                  accessibilityState={{ disabled: future, selected }}
                  disabled={future}
                  onPress={() => onChange(startOfDay(date))}
                  style={({ pressed }) => [
                    styles.dayButton,
                    selected && styles.daySelected,
                    isToday && !selected && styles.dayToday,
                    future && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      outsideMonth && styles.dayOutside,
                      selected && styles.dayTextSelected,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                  {hasThoughts && (
                    <View
                      style={[
                        styles.thoughtDot,
                        selected && styles.thoughtDotSelected,
                      ]}
                    />
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: C.paper,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    shadowColor: C.ink,
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -5 },
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: "center",
    marginBottom: 18,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  eyebrow: {
    fontFamily: NOTE_SANS,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: C.ink30,
    marginBottom: 5,
  },
  selectedDate: { fontFamily: NOTE_SERIF, fontSize: 19, color: C.ink },
  todayButton: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: C.card,
  },
  todayText: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    fontWeight: "600",
    color: C.plum,
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  monthButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  monthTitle: {
    fontFamily: NOTE_SANS,
    fontSize: 12,
    fontWeight: "600",
    color: C.ink70,
  },
  weekRow: { flexDirection: "row", marginBottom: 6 },
  weekday: {
    width: "14.2857%",
    textAlign: "center",
    fontFamily: NOTE_SANS,
    fontSize: 9,
    fontWeight: "600",
    color: C.ink30,
  },
  daysGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: "14.2857%",
    height: 43,
    alignItems: "center",
    justifyContent: "center",
  },
  dayButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  daySelected: { backgroundColor: C.plum },
  dayToday: { borderWidth: 1, borderColor: C.plum },
  dayText: { fontFamily: NOTE_SANS, fontSize: 12, color: C.ink70 },
  dayOutside: { color: C.ink30 },
  dayTextSelected: { color: C.card, fontWeight: "700" },
  thoughtDot: {
    position: "absolute",
    bottom: 3,
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: C.plum,
  },
  thoughtDotSelected: { backgroundColor: C.card },
  disabled: { opacity: 0.24 },
  pressed: { opacity: 0.55 },
});
