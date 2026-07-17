import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheetModal } from "@/components/BottomSheetModal";
import { NOTE_COLORS as C, NOTE_SANS, NOTE_SERIF } from "@/components/NoteUI";

export type ThoughtFilterOption = {
  type: string;
  label: string;
  count: number;
};

export function ThoughtFilterPicker({
  visible,
  options,
  selected,
  onApply,
  onClose,
}: {
  visible: boolean;
  options: ThoughtFilterOption[];
  selected: string[];
  onApply: (types: string[]) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<string[]>(selected);

  useEffect(() => {
    if (visible) setDraft(selected);
  }, [selected, visible]);

  const toggle = (type: string) => {
    setDraft((current) =>
      current.includes(type)
        ? current.filter((item) => item !== type)
        : [...current, type],
    );
  };

  return (
    <BottomSheetModal
      closeLabel="Filter schließen"
      onClose={onClose}
      visible={visible}
    >
      <View
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18) }]}
      >
        <View style={styles.handle} />
        <Text style={styles.eyebrow}>thoughts filtern</Text>
        <Text style={styles.title}>Was möchtest du sehen?</Text>

        <View style={styles.options}>
          {options.map((option) => {
            const checked = draft.includes(option.type);
            return (
              <Pressable
                key={option.type}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                onPress={() => toggle(option.type)}
                style={({ pressed }) => [
                  styles.option,
                  checked && styles.optionChecked,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.optionCopy}>
                  <Text
                    style={[
                      styles.optionLabel,
                      checked && styles.optionLabelChecked,
                    ]}
                  >
                    {option.label}
                  </Text>
                  <Text style={styles.optionCount}>
                    {option.count} {option.count === 1 ? "thought" : "thoughts"}
                  </Text>
                </View>
                <View style={[styles.check, checked && styles.checkChecked]}>
                  {checked && (
                    <Ionicons name="checkmark" size={15} color={C.card} />
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setDraft([])}
            style={({ pressed }) => [
              styles.resetButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.resetText}>Zurücksetzen</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onApply(draft)}
            style={({ pressed }) => [
              styles.applyButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.applyText}>
              {draft.length > 0
                ? `Anwenden · ${draft.length}`
                : "Alle anzeigen"}
            </Text>
          </Pressable>
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
  eyebrow: {
    fontFamily: NOTE_SANS,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.8,
    color: C.ink30,
    marginBottom: 6,
  },
  title: {
    fontFamily: NOTE_SERIF,
    fontSize: 22,
    color: C.ink,
    marginBottom: 20,
  },
  options: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
  },
  option: {
    minHeight: 64,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.divider,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  optionChecked: { backgroundColor: "rgba(110,74,97,0.045)" },
  optionCopy: { gap: 3 },
  optionLabel: {
    fontFamily: NOTE_SERIF,
    fontSize: 17,
    color: C.ink70,
  },
  optionLabelChecked: { color: C.plum },
  optionCount: { fontFamily: NOTE_SANS, fontSize: 10, color: C.ink30 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  checkChecked: { borderColor: C.plum, backgroundColor: C.plum },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
  },
  resetButton: {
    minHeight: 46,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  resetText: { fontFamily: NOTE_SANS, fontSize: 12, color: C.ink40 },
  applyButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 23,
    backgroundColor: C.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  applyText: {
    fontFamily: NOTE_SANS,
    fontSize: 12,
    fontWeight: "600",
    color: C.card,
  },
  pressed: { opacity: 0.58 },
});
