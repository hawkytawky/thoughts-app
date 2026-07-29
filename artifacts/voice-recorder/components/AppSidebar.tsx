import React, { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import {
  NOTE_COLORS as C,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
} from "@/components/NoteUI";
import { useAuth } from "@/lib/auth";

type SidebarDestination = "thoughts" | "overview";

export function AppMenuGlyph() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.menuGlyph}
    >
      <View style={styles.menuGlyphLine} />
      <View style={[styles.menuGlyphLine, styles.menuGlyphLineShort]} />
    </View>
  );
}

const DESTINATIONS: {
  icon: keyof typeof Ionicons.glyphMap;
  id: SidebarDestination;
  label: string;
  path: Href;
}[] = [
  {
    icon: "cloud-outline",
    id: "thoughts",
    label: "thoughts",
    path: "/thoughts",
  },
  {
    icon: "stats-chart-outline",
    id: "overview",
    label: "overview",
    path: "/overview",
  },
];

export function AppSidebar({
  active,
  insets,
  onClose,
  onOpen,
  visible,
}: {
  active: SidebarDestination;
  insets: { bottom: number; top: number };
  onClose: () => void;
  onOpen: () => void;
  visible: boolean;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.78, 310);
  const progress = useSharedValue(visible ? 1 : 0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, {
      duration: reduceMotion ? 0 : visible ? 250 : 210,
      easing: visible
        ? Easing.out(Easing.cubic)
        : Easing.inOut(Easing.cubic),
    });
  }, [progress, reduceMotion, visible]);

  const openFromEdge = Gesture.Pan()
    .activeOffsetX(8)
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      progress.value = Math.max(
        0,
        Math.min(1, event.translationX / drawerWidth),
      );
    })
    .onEnd((event) => {
      const shouldOpen = progress.value >= 0.32 || event.velocityX >= 520;
      progress.value = withTiming(shouldOpen ? 1 : 0, {
        duration: reduceMotion ? 0 : shouldOpen ? 230 : 180,
        easing: Easing.out(Easing.cubic),
      });
      if (shouldOpen) runOnJS(onOpen)();
    });

  const closeWithSwipe = Gesture.Pan()
    .activeOffsetX(-8)
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      progress.value = Math.max(
        0,
        Math.min(1, 1 + event.translationX / drawerWidth),
      );
    })
    .onEnd((event) => {
      const shouldClose = progress.value <= 0.68 || event.velocityX <= -520;
      progress.value = withTiming(shouldClose ? 0 : 1, {
        duration: reduceMotion ? 0 : shouldClose ? 210 : 180,
        easing: Easing.out(Easing.cubic),
      });
      if (shouldClose) runOnJS(onClose)();
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -drawerWidth * (1 - progress.value) }],
  }));

  const open = (destination: (typeof DESTINATIONS)[number]) => {
    onClose();
    if (destination.id !== active) router.replace(destination.path);
  };

  return (
    <>
      {!visible && (
        <GestureDetector gesture={openFromEdge}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.edgeTrigger}
          />
        </GestureDetector>
      )}
      <View
        accessibilityViewIsModal={visible}
        pointerEvents={visible ? "auto" : "box-none"}
        style={styles.sidebarLayer}
      >
        <Animated.View
          pointerEvents={visible ? "auto" : "none"}
          style={[styles.sidebarBackdrop, backdropStyle]}
        >
        <Pressable
          accessibilityLabel="Menü schließen"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

        <GestureDetector gesture={closeWithSwipe}>
          <Animated.View
            style={[
              styles.sidebar,
              {
                paddingBottom: insets.bottom + 6,
                paddingTop: insets.top,
                width: drawerWidth,
              },
              drawerStyle,
            ]}
          >
        <View style={styles.sidebarHeader}>
          <Text style={styles.sidebarBrand}>thoughts</Text>
          <Pressable
            accessibilityLabel="Menü schließen"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [
              styles.sidebarClose,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="close" size={18} color={C.ink40} />
          </Pressable>
        </View>

        <View style={styles.sidebarNavigation}>
          {DESTINATIONS.map((destination) => {
            const selected = destination.id === active;
            return (
              <Pressable
                key={destination.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => open(destination)}
                style={({ pressed }) => [
                  styles.sidebarItem,
                  selected && styles.sidebarItemActive,
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={destination.icon}
                  size={18}
                  color={selected ? C.skyDeep : C.ink40}
                />
                <Text
                  style={[
                    styles.sidebarItemText,
                    selected && styles.sidebarItemTextActive,
                  ]}
                >
                  {destination.label}
                </Text>
                {selected && <View style={styles.sidebarActiveDot} />}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.account}>
          <Pressable
            accessibilityLabel="Profil öffnen"
            accessibilityRole="button"
            onPress={() => {
              onClose();
              router.push("/profile");
            }}
            style={({ pressed }) => [
              styles.profileButton,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.profileIcon}>
              <Ionicons name="person-outline" size={16} color={C.ink40} />
            </View>
            <View style={styles.profileCopy}>
              <Text numberOfLines={1} style={styles.profileName}>
                {user?.display_name || "Profil"}
              </Text>
              <Text style={styles.profileLabel}>Account ansehen</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={C.ink30} />
          </Pressable>
        </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  menuGlyph: {
    width: 18,
    height: 18,
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 5,
  },
  menuGlyphLine: {
    width: 16,
    height: StyleSheet.hairlineWidth,
    borderRadius: 1,
    backgroundColor: C.ink60,
  },
  menuGlyphLineShort: { width: 11 },
  sidebarLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  edgeTrigger: {
    position: "absolute",
    zIndex: 49,
    top: 0,
    bottom: 0,
    left: 0,
    width: 24,
  },
  sidebarBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(36,69,95,0.12)",
  },
  sidebar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    paddingHorizontal: 20,
    backgroundColor: C.warmWhite,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: C.divider,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.07,
    shadowRadius: 26,
    shadowOffset: { width: 6, height: 0 },
    elevation: 10,
  },
  sidebarHeader: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sidebarBrand: {
    fontFamily: NOTE_SERIF,
    fontSize: 19,
    letterSpacing: 0.1,
    color: C.ink,
  },
  sidebarClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarNavigation: { marginTop: 34, gap: 2 },
  sidebarItem: {
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sidebarItemActive: { backgroundColor: "rgba(234,242,248,0.45)" },
  sidebarItemText: {
    flex: 1,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 14.5,
    letterSpacing: 0.1,
    color: C.ink40,
  },
  sidebarItemTextActive: { color: C.ink },
  sidebarActiveDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.skyDeep,
  },
  account: {
    marginTop: "auto",
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.divider,
  },
  profileButton: {
    minHeight: 52,
    paddingHorizontal: 6,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  profileIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  profileCopy: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 14,
    color: C.ink,
  },
  profileLabel: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 10,
    letterSpacing: 0.2,
    color: C.ink40,
  },
  pressed: { opacity: 0.58 },
});
