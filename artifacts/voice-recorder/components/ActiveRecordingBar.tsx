import React, { useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { type Href, usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useActiveRecording } from "@/lib/active-recording";

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1_000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function RecordingDot() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation: Animated.CompositeAnimation | undefined;
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!mounted || reduceMotion) return;
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 1_300,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 1_300,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
    });

    return () => {
      mounted = false;
      animation?.stop();
    };
  }, [pulse]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.52, 1],
          }),
          transform: [
            {
              scale: pulse.interpolate({
                inputRange: [0, 1],
                outputRange: [0.9, 1.18],
              }),
            },
          ],
        },
      ]}
    />
  );
}

export function ActiveRecordingBar() {
  const { active, durationMs } = useActiveRecording();
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  if (!active || pathname === "/record") return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.container, { bottom: insets.bottom + 6 }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Aufnahme läuft, ${formatTime(durationMs)}. Aufnahme öffnen`}
        onPress={() => router.dismissTo("/record" as Href)}
        style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
      >
        <View style={styles.state}>
          <RecordingDot />
          <Text style={styles.label}>Aufnahme läuft</Text>
        </View>
        <Text style={styles.timer}>{formatTime(durationMs)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 18,
    right: 18,
  },
  bar: {
    minHeight: 58,
    paddingHorizontal: 20,
    borderRadius: 29,
    backgroundColor: "#5C7048",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(235,231,218,0.28)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#10180F",
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 8,
  },
  state: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#D96C63",
  },
  label: {
    fontFamily: "System",
    fontSize: 13,
    color: "rgba(235,231,218,0.84)",
  },
  timer: {
    minWidth: 48,
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    color: "#EBE7DA",
    textAlign: "right",
  },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
});
