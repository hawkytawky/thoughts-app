import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NOTE_SANS } from "@/components/NoteUI";
import { MEMORY_FRAME, MEMORY_THEME } from "@/lib/memory-theme";

export type TopRightMenuItem = {
  key: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
  selected?: boolean;
};

export function TopRightMenu({
  closeLabel,
  items,
  onClose,
  visible,
}: {
  closeLabel: string;
  items: TopRightMenuItem[];
  onClose: () => void;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.layer}>
        <Pressable
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View
          entering={FadeInDown.duration(180).easing(Easing.out(Easing.cubic))}
          style={[styles.menu, { top: insets.top + 48 }]}
        >
          {items.map((item, index) => (
            <Pressable
              key={item.key}
              accessibilityRole="button"
              accessibilityState={{
                disabled: item.disabled,
                selected: item.selected,
              }}
              disabled={item.disabled}
              onPress={item.onPress}
              style={({ pressed }) => [
                styles.row,
                index < items.length - 1 && styles.rowDivider,
                item.disabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.label,
                  item.selected && styles.selectedLabel,
                  item.danger && styles.dangerLabel,
                ]}
              >
                {item.label}
              </Text>
              {item.selected ? <View style={styles.selectedDot} /> : null}
            </Pressable>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  menu: {
    position: "absolute",
    right: 16,
    width: 206,
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "rgba(252,252,251,0.98)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.86)",
    shadowColor: MEMORY_THEME.ink,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  row: {
    minHeight: 46,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: "#EDF0F1",
  },
  label: {
    fontFamily: NOTE_SANS,
    fontSize: MEMORY_FRAME.periodFontSize,
    color: "#6E8A9C",
  },
  selectedLabel: { color: MEMORY_THEME.ink },
  dangerLabel: { color: "#A0524D" },
  selectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2E5E8C",
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.58 },
});
