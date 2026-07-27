import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
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
      <Ionicons
        name="menu-outline"
        size={19}
        color={C.ink40}
        style={styles.menuGlyphIcon}
      />
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
  visible,
}: {
  active: SidebarDestination;
  insets: { bottom: number; top: number };
  onClose: () => void;
  visible: boolean;
}) {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      duration: visible ? 280 : 220,
      easing: visible
        ? Easing.out(Easing.cubic)
        : Easing.inOut(Easing.cubic),
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  const open = (destination: (typeof DESTINATIONS)[number]) => {
    onClose();
    if (destination.id !== active) router.push(destination.path);
  };

  return (
    <View
      pointerEvents={visible ? "auto" : "none"}
      style={styles.sidebarLayer}
    >
      <Animated.View
        style={[
          styles.sidebarBackdrop,
          {
            opacity: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1],
            }),
          },
        ]}
      >
        <Pressable
          accessibilityLabel="Menü schließen"
          onPress={onClose}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.sidebar,
          {
            paddingBottom: insets.bottom + 24,
            paddingTop: insets.top + 12,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-330, 0],
                }),
              },
            ],
          },
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
                  size={19}
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
          {user?.display_name ? (
            <Text numberOfLines={1} style={styles.accountName}>
              {user.display_name}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onClose();
              void signOut();
            }}
            style={({ pressed }) => [
              styles.signOut,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="log-out-outline" size={18} color={C.ink40} />
            <Text style={styles.signOutText}>abmelden</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  menuGlyph: {
    width: 16,
    height: 19,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  menuGlyphIcon: { marginLeft: -2 },
  sidebarLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  sidebarBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(36,69,95,0.17)",
  },
  sidebar: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: "78%",
    maxWidth: 310,
    paddingHorizontal: 22,
    backgroundColor: "rgba(251,252,253,0.98)",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: C.border,
    shadowColor: C.skyDeep,
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 8, height: 0 },
    elevation: 12,
  },
  sidebarHeader: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sidebarBrand: {
    fontFamily: NOTE_SERIF,
    fontSize: 22,
    color: C.ink,
  },
  sidebarClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  sidebarNavigation: { marginTop: 42, gap: 7 },
  sidebarItem: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  sidebarItemActive: { backgroundColor: "rgba(234,242,248,0.72)" },
  sidebarItemText: {
    flex: 1,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 15,
    color: C.ink60,
  },
  sidebarItemTextActive: { color: C.ink },
  sidebarActiveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.sky,
  },
  account: {
    marginTop: "auto",
    gap: 8,
  },
  accountName: {
    paddingHorizontal: 14,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 12,
    color: C.ink30,
  },
  signOut: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  signOutText: {
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 14,
    color: C.ink60,
  },
  pressed: { opacity: 0.58 },
});
