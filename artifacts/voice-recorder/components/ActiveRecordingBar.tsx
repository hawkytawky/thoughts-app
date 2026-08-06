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
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  requestStopRecording,
  useActiveRecording,
} from "@/lib/active-recording";

// Matches the recorder screen so the bar reads as the same surface.
const RECORDER_BLUE = "#2E5E8C";

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
      // Clears the tab bar so navigating to another tab stays possible.
      style={[styles.container, { bottom: insets.bottom + 68 }]}
    >
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Aufnahme läuft, ${formatTime(durationMs)}. Aufnahme öffnen`}
          onPress={() => router.dismissTo("/record" as Href)}
          style={({ pressed }) => [styles.open, pressed && styles.pressed]}
        >
          <RecordingDot />
          <Text style={styles.timer}>{formatTime(durationMs)}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aufnahme beenden"
          hitSlop={8}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            requestStopRecording();
          }}
          style={({ pressed }) => [styles.stop, pressed && styles.stopPressed]}
        >
          <View style={styles.stopSquare} />
        </Pressable>
      </View>
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
    paddingLeft: 20,
    paddingRight: 8,
    borderRadius: 29,
    backgroundColor: RECORDER_BLUE,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#132A38",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 8,
  },
  open: {
    flex: 1,
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#D96C63",
  },
  timer: {
    fontFamily: "System",
    fontSize: 17,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
    color: "rgba(255,255,255,0.94)",
  },
  stop: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.52)",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  stopSquare: {
    width: 15,
    height: 15,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  stopPressed: { opacity: 0.78, transform: [{ scale: 0.95 }] },
  pressed: { opacity: 0.78 },
});
