import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { error, signInWithApple } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      await signInWithApple();
      router.replace("/");
    } catch {
      // AuthProvider exposes the user-facing error.
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>thoughts</Text>
        <Text style={styles.title}>Deine Gedanken, nur für dich.</Text>
        <Text style={styles.body}>
          Melde dich an, damit deine Aufnahmen sicher deinem Account zugeordnet
          werden.
        </Text>
      </View>

      <View style={styles.actions}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mit Apple anmelden"
          disabled={isSigningIn}
          onPress={() => void handleSignIn()}
          style={({ pressed }) => [
            styles.appleButton,
            (pressed || isSigningIn) && styles.appleButtonPressed,
          ]}
        >
          {isSigningIn ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="logo-apple" size={22} color="#FFFFFF" />
              <Text style={styles.appleButtonText}>Mit Apple anmelden</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.hint}>
          Die Anmeldung wird sicher über Apple und Microsoft Entra verarbeitet.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 28,
    backgroundColor: "#EBE7DA",
  },
  copy: {
    marginTop: 80,
    gap: 18,
  },
  eyebrow: {
    color: "#5C7048",
    fontFamily: "InstrumentSans_600SemiBold",
    fontSize: 14,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    maxWidth: 340,
    color: "#10180F",
    fontFamily: "Newsreader_400Regular",
    fontSize: 44,
    lineHeight: 48,
  },
  body: {
    maxWidth: 340,
    color: "#26351F",
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 17,
    lineHeight: 25,
  },
  actions: {
    gap: 14,
  },
  appleButton: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    backgroundColor: "#000000",
  },
  appleButtonPressed: {
    opacity: 0.72,
  },
  appleButtonText: {
    color: "#FFFFFF",
    fontFamily: Platform.select({
      ios: "System",
      default: "InstrumentSans_600SemiBold",
    }),
    fontSize: 17,
    fontWeight: "600",
  },
  error: {
    color: "#9B2C2C",
    fontFamily: "InstrumentSans_500Medium",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  hint: {
    paddingHorizontal: 12,
    color: "#5C7048",
    fontFamily: "InstrumentSans_400Regular",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },
});
