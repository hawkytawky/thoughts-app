import React, { type ComponentProps, useCallback } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { type Href, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NOTE_SANS } from "@/components/NoteUI";
import {
  requestStartNextRecording,
  useActiveRecording,
} from "@/lib/active-recording";

const COLORS = {
  active: "#2E5E8C",
  inactive: "#9FB2BD",
  mic: "#1E3C52",
  recording: "#A45F59",
};

type TabId = "today" | "memory" | "community" | "account";
type IconName = ComponentProps<typeof Ionicons>["name"];

type TabItem = {
  id: TabId;
  label: string;
  icon: IconName;
  href: Href | null;
  disabled?: boolean;
};

const LEFT_TABS: TabItem[] = [
  { id: "today", label: "heute", icon: "home-outline", href: "/" },
  { id: "memory", label: "memory", icon: "time-outline", href: "/overview" },
];

const RIGHT_TABS: TabItem[] = [
  {
    id: "community",
    label: "community",
    icon: "people-outline",
    href: null,
    disabled: true,
  },
  { id: "account", label: "account", icon: "person-outline", href: "/profile" },
];

function NavigationItem({ item, active }: { item: TabItem; active: TabId }) {
  const router = useRouter();
  const selected = item.id === active;
  const color = selected ? COLORS.active : COLORS.inactive;

  return (
    <Pressable
      accessibilityLabel={
        item.disabled ? `${item.label}, bald verfügbar` : item.label
      }
      accessibilityRole="tab"
      accessibilityState={{ disabled: item.disabled, selected }}
      disabled={item.disabled}
      hitSlop={4}
      onPress={() => {
        if (!selected && item.href) router.navigate(item.href);
      }}
      style={({ pressed }) => [
        styles.item,
        item.disabled && styles.itemDisabled,
        pressed && styles.itemPressed,
      ]}
    >
      <Ionicons name={item.icon} size={21} color={color} />
      <Text style={[styles.label, { color }]}>{item.label}</Text>
    </Pressable>
  );
}

export function RecordingActionButton({
  state = "idle",
}: {
  state?: "idle" | "recording";
}) {
  const router = useRouter();
  const activeRecording = useActiveRecording();

  const openRecorder = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (activeRecording.active) {
      router.dismissTo("/record" as Href);
      return;
    }
    // A finished recorder can still sit in the stack. Reuse it instead of
    // pushing a second copy on top.
    if (activeRecording.recorderMounted) {
      router.dismissTo("/record" as Href);
      requestStartNextRecording();
      return;
    }
    router.push("/record" as Href);
  }, [activeRecording.active, activeRecording.recorderMounted, router]);

  const recording = state === "recording";

  return (
    <Pressable
      accessibilityLabel={
        recording ? "Aufnahme beenden" : "Neue Aufnahme starten"
      }
      accessibilityRole="button"
      hitSlop={6}
      onPress={openRecorder}
      style={({ pressed }) => [
        styles.micRing,
        pressed && styles.micPressed,
      ]}
    >
      <View pointerEvents="none" style={styles.micRingGlass}>
        <BlurView intensity={18} tint="light" style={StyleSheet.absoluteFill} />
      </View>
      <View
        style={[
          styles.micCore,
          recording && styles.micCoreRecording,
        ]}
      >
        <Ionicons
          name={recording ? "stop" : "mic-outline"}
          size={24}
          color="#FFFFFF"
        />
      </View>
    </Pressable>
  );
}

export function BottomTabBar({ active }: { active: TabId }) {
  const insets = useSafeAreaInsets();
  // While recording, the recording bar above carries the stop control, so the
  // mic button would be a redundant second entry point.
  const { active: isRecording } = useActiveRecording();

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { bottom: Math.max(insets.bottom - 6, 4) }]}
    >
      <View pointerEvents="none" style={styles.barShadow} />
      <View style={styles.bar}>
        <BlurView intensity={26} tint="light" style={StyleSheet.absoluteFill} />
        <View
          pointerEvents="none"
          style={[
            styles.glassOverlay,
            Platform.OS === "android" && styles.glassOverlayAndroid,
          ]}
        />
        <View pointerEvents="none" style={styles.insetHighlight} />
        <View style={styles.items} accessibilityRole="tablist">
          {LEFT_TABS.map((item) => (
            <NavigationItem key={item.id} active={active} item={item} />
          ))}
          <View pointerEvents="none" style={styles.micGap} />
          {RIGHT_TABS.map((item) => (
            <NavigationItem key={item.id} active={active} item={item} />
          ))}
        </View>
      </View>
      {isRecording ? null : (
        <View pointerEvents="box-none" style={styles.micPosition}>
          <RecordingActionButton state="idle" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 10,
    right: 10,
    height: 62,
    zIndex: 40,
  },
  bar: {
    height: 62,
    borderRadius: 26,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.75)",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  barShadow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.01)",
    shadowColor: "#132A38",
    shadowOpacity: 0.28,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  glassOverlayAndroid: {
    backgroundColor: "rgba(255,255,255,0.60)",
  },
  insetHighlight: {
    position: "absolute",
    top: 1,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.60)",
  },
  items: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  item: {
    minWidth: 44,
    height: 54,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  itemDisabled: { opacity: 0.42 },
  itemPressed: { opacity: 0.58 },
  label: {
    fontFamily: NOTE_SANS,
    fontSize: 9.5,
    lineHeight: 11,
    letterSpacing: 0.03,
  },
  micGap: { width: 70 },
  micPosition: {
    position: "absolute",
    top: -16,
    left: "50%",
    width: 68,
    height: 68,
    marginLeft: -34,
    zIndex: 2,
  },
  micRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  micRingGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 34,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  micCore: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.mic,
    shadowColor: "#132A38",
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  micCoreRecording: { backgroundColor: COLORS.recording },
  micPressed: { opacity: 0.9, transform: [{ scale: 0.96 }] },
});
