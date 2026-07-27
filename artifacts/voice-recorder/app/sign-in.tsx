import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import {
  NOTE_COLORS as C,
  NOTE_SANS,
  NOTE_SANS_MEDIUM,
  NOTE_SERIF,
  NOTE_SERIF_ITALIC,
} from "@/components/NoteUI";

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { error, signInWithApple, signInWithGoogle, status } = useAuth();
  const [activeProvider, setActiveProvider] = useState<
    "apple" | "google" | null
  >(null);
  const unavailable = status === "configuration-error";

  const handleSignIn = async (provider: "apple" | "google") => {
    setActiveProvider(provider);
    try {
      await (provider === "apple" ? signInWithApple() : signInWithGoogle());
      router.replace("/");
    } catch {
      // AuthProvider exposes the user-facing error.
    } finally {
      setActiveProvider(null);
    }
  };

  return (
    <LinearGradient
      colors={["#FDFEFE", "#EEF6FB", "#DCEBF6"]}
      locations={[0, 0.52, 1]}
      style={[
        styles.container,
        {
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 22,
        },
      ]}
    >
      <View pointerEvents="none" style={styles.atmosphere}>
        <View style={[styles.cloud, styles.cloudOne]} />
        <View style={[styles.cloud, styles.cloudTwo]} />
        <View style={[styles.cloud, styles.cloudThree]} />
      </View>

      <Text style={styles.brand}>thoughts</Text>

      <View style={styles.copy}>
        <Text style={styles.title}>Gedanken brauchen Raum.</Text>
        <Text style={styles.body}>
          Ein stiller Ort für alles, was dir durch den Kopf geht.
        </Text>
      </View>

      <View style={styles.actions}>
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons
              name="information-circle-outline"
              size={17}
              color="#7B5260"
            />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mit Apple anmelden"
          disabled={activeProvider !== null || unavailable}
          onPress={() => void handleSignIn("apple")}
          style={({ pressed }) => [
            styles.appleButton,
            pressed && styles.appleButtonPressed,
            (activeProvider !== null || unavailable) &&
              styles.appleButtonDisabled,
          ]}
        >
          {activeProvider === "apple" ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={20} color="#FFFFFF" />
              <Text style={styles.appleButtonText}>Mit Apple fortfahren</Text>
            </>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mit Google anmelden"
          disabled={activeProvider !== null || unavailable}
          onPress={() => void handleSignIn("google")}
          style={({ pressed }) => [
            styles.googleButton,
            pressed && styles.googleButtonPressed,
            (activeProvider !== null || unavailable) &&
              styles.appleButtonDisabled,
          ]}
        >
          {activeProvider === "google" ? (
            <ActivityIndicator color={C.ink} />
          ) : (
            <>
              <Ionicons name="logo-google" size={18} color={C.ink} />
              <Text style={styles.googleButtonText}>
                Mit Google fortfahren
              </Text>
            </>
          )}
        </Pressable>
        <Text style={styles.hint}>Privat. Sicher. Nur für dich.</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    overflow: "hidden",
  },
  atmosphere: { ...StyleSheet.absoluteFillObject },
  cloud: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.56)",
  },
  cloudOne: {
    width: 310,
    height: 180,
    top: 95,
    right: -145,
    transform: [{ rotate: "-12deg" }],
  },
  cloudTwo: {
    width: 260,
    height: 145,
    top: 250,
    left: -160,
    backgroundColor: "rgba(255,255,255,0.38)",
    transform: [{ rotate: "9deg" }],
  },
  cloudThree: {
    width: 350,
    height: 190,
    bottom: 70,
    right: -210,
    backgroundColor: "rgba(191,217,236,0.22)",
  },
  brand: {
    zIndex: 1,
    alignSelf: "flex-start",
    fontFamily: NOTE_SERIF,
    fontSize: 24,
    color: C.ink,
  },
  copy: {
    zIndex: 1,
    flex: 1,
    justifyContent: "center",
    paddingBottom: 42,
    gap: 16,
  },
  title: {
    maxWidth: 330,
    fontFamily: NOTE_SERIF_ITALIC,
    fontSize: 46,
    lineHeight: 49,
    color: C.ink,
  },
  body: {
    maxWidth: 290,
    fontFamily: NOTE_SANS,
    fontSize: 16,
    lineHeight: 24,
    color: C.ink60,
  },
  actions: {
    zIndex: 1,
    gap: 13,
  },
  appleButton: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 18,
    backgroundColor: "#17222A",
    shadowColor: C.skyDeep,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 4,
  },
  appleButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.995 }],
  },
  appleButtonDisabled: { opacity: 0.42 },
  appleButtonText: {
    color: "#FFFFFF",
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 16,
  },
  googleButton: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border,
  },
  googleButtonPressed: {
    backgroundColor: "rgba(255,255,255,0.54)",
    transform: [{ scale: 0.995 }],
  },
  googleButtonText: {
    color: C.ink,
    fontFamily: NOTE_SANS_MEDIUM,
    fontSize: 16,
  },
  errorCard: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.68)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(123,82,96,0.24)",
  },
  error: {
    flex: 1,
    color: "#7B5260",
    fontFamily: NOTE_SANS,
    fontSize: 12,
    lineHeight: 17,
  },
  hint: {
    fontFamily: NOTE_SANS,
    fontSize: 11,
    letterSpacing: 0.35,
    color: C.ink30,
    textAlign: "center",
  },
});
