import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppMenuGlyph, AppSidebar } from "@/components/AppSidebar";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
} from "@/components/NoteUI";

type OverviewView = "base" | "all" | "time";

const VIEWS: { id: OverviewView; label: string }[] = [
  { id: "base", label: "base" },
  { id: "all", label: "all" },
  { id: "time", label: "time" },
];

export default function OverviewScreen() {
  const insets = useSafeAreaInsets();
  const [activeView, setActiveView] = useState<OverviewView>("base");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.content,
          {
            paddingBottom: insets.bottom + 24,
            paddingTop: insets.top + 7,
          },
        ]}
      >
        <View style={styles.appBar}>
          <View style={styles.brandGroup}>
            <Pressable
              accessibilityLabel="Menü öffnen"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setSidebarOpen(true)}
              style={({ pressed }) => [
                styles.menuButton,
                pressed && styles.pressed,
              ]}
            >
              <AppMenuGlyph />
            </Pressable>
            <Text style={styles.brand}>thoughts</Text>
          </View>
        </View>

        <Text style={styles.title}>Overview</Text>

        <View accessibilityRole="tablist" style={styles.toggle}>
          {VIEWS.map((view) => {
            const selected = view.id === activeView;
            return (
              <Pressable
                key={view.id}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setActiveView(view.id)}
                style={({ pressed }) => [
                  styles.toggleItem,
                  selected && styles.toggleItemActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.toggleLabel,
                    selected && styles.toggleLabelActive,
                  ]}
                >
                  {view.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <AppSidebar
        active="overview"
        insets={insets}
        onClose={() => setSidebarOpen(false)}
        visible={sidebarOpen}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.paper },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  appBar: {
    minHeight: 38,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  brandGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  menuButton: {
    width: 28,
    height: 28,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 12,
    color: C.ink40,
  },
  title: {
    marginTop: 14,
    fontFamily: NOTE_SERIF,
    fontSize: 30,
    lineHeight: 36,
    color: C.ink,
  },
  toggle: {
    alignSelf: "flex-start",
    marginTop: 24,
    padding: 3,
    flexDirection: "row",
    borderRadius: 12,
    backgroundColor: "rgba(234,242,248,0.72)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(191,217,236,0.72)",
  },
  toggleItem: {
    minWidth: 72,
    height: 34,
    paddingHorizontal: 17,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleItemActive: {
    backgroundColor: C.card,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  toggleLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 13,
    color: C.ink40,
  },
  toggleLabelActive: {
    fontFamily: NOTE_SANS_MEDIUM,
    color: C.ink,
  },
  pressed: { opacity: 0.55 },
});
