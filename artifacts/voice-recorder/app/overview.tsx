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
import { OverviewGraph } from "@/components/overview/OverviewGraph";

type OverviewView = "base" | "all" | "time";

const VIEWS: { id: OverviewView; label: string }[] = [
  { id: "base", label: "base" },
  { id: "all", label: "network" },
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
            paddingBottom: 0,
            paddingTop: Math.max(insets.top - 3, 8),
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
          <Text style={styles.overviewLabel}>Overview</Text>
        </View>

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

        <View style={styles.body}>
          {activeView === "all" ? (
            <OverviewGraph />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderText}>
                {activeView === "base"
                  ? "Base-Statistiken folgen."
                  : "Gedankenfluss über Zeit folgt."}
              </Text>
            </View>
          )}
        </View>
      </View>

      <AppSidebar
        active="overview"
        insets={insets}
        onClose={() => setSidebarOpen(false)}
        onOpen={() => setSidebarOpen(true)}
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
    minHeight: 40,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandGroup: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  menuButton: {
    width: 24,
    height: 40,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  brand: {
    fontFamily: NOTE_SERIF,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: 0.15,
    color: C.ink,
  },
  overviewLabel: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    lineHeight: 16,
    color: C.ink60,
  },
  toggle: {
    marginTop: 0,
    marginHorizontal: -20,
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(191,217,236,0.45)",
  },
  toggleItem: {
    flex: 1,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleItemActive: {
    borderBottomWidth: 2,
    borderBottomColor: C.ink,
    marginBottom: -StyleSheet.hairlineWidth,
  },
  toggleLabel: {
    fontFamily: NOTE_SANS,
    fontSize: 13.5,
    color: C.ink40,
  },
  toggleLabelActive: {
    fontFamily: NOTE_SANS_MEDIUM,
    color: C.ink,
  },
  pressed: { opacity: 0.55 },
  body: {
    flex: 1,
    marginTop: 20,
    marginHorizontal: -20, // graph goes edge-to-edge
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    fontFamily: NOTE_SANS,
    fontSize: 14,
    color: C.ink40,
  },
});
