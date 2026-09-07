import React, { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NOTE_SCREEN_TOP_OFFSET, NOTE_SERIF } from "@/components/NoteUI";
import { MEMORY_FRAME, MEMORY_THEME } from "@/lib/memory-theme";

export function PrimaryScreenHeader({ right }: { right?: ReactNode }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.header,
        {
          paddingTop: Math.max(insets.top + NOTE_SCREEN_TOP_OFFSET, 0),
        },
      ]}
    >
      <Text style={styles.brand}>thoughts</Text>
      {right ?? <View style={styles.controlPlaceholder} />}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingBottom: 2,
    paddingHorizontal: MEMORY_FRAME.horizontalPadding,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: MEMORY_FRAME.titleFontSize,
    letterSpacing: -0.23,
    color: MEMORY_THEME.ink,
  },
  controlPlaceholder: { minHeight: 44 },
});
