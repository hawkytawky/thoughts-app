import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { useAuth } from "@/lib/auth";
import {
  NOTE_SANS,
  NOTE_SERIF,
  NOTE_SERIF_LIGHT,
} from "@/components/NoteUI";

const COLORS = {
  ink: "#243542",
  muted: "#8A949C",
} as const;

function GoogleLogo() {
  return (
    <Svg accessibilityElementsHidden height={17} viewBox="0 0 24 24" width={17}>
      <Path
        d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"
        fill="#4285F4"
      />
      <Path
        d="M12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"
        fill="#34A853"
      />
      <Path
        d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z"
        fill="#FBBC05"
      />
      <Path
        d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6.1 12 6.1z"
        fill="#EA4335"
      />
    </Svg>
  );
}

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
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + 18,
          paddingBottom: Math.max(insets.bottom + 2, 12),
        },
      ]}
    >
      <StatusBar style="dark" />

      <Text style={styles.brand}>thoughts</Text>

      <View style={styles.spacer} />
      <Text style={styles.claim}>AI for understanding{"\n"}yourself.</Text>
      <View style={styles.spacer} />

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
        {/* No Apple button until the backend can verify Apple ID tokens; it
            would only ever throw. The provider plumbing below and the
            appleButton styles stay so restoring it is a paste. Note that
            App Store review requires it (guideline 4.8) as soon as this
            ships publicly alongside Google. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
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
            <ActivityIndicator color={COLORS.ink} />
          ) : (
            <>
              <GoogleLogo />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.hint}>Private and encrypted</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 26,
    backgroundColor: "#F4F5F7",
    overflow: "hidden",
  },
  brand: {
    zIndex: 1,
    alignSelf: "flex-start",
    fontFamily: NOTE_SERIF,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.26,
    color: COLORS.ink,
  },
  spacer: {
    zIndex: 1,
    flex: 1,
  },
  claim: {
    zIndex: 1,
    marginVertical: 12,
    fontFamily: NOTE_SERIF_LIGHT,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.68,
    color: COLORS.ink,
  },
  actions: {
    zIndex: 1,
    gap: 10,
  },
  appleButton: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 16,
    backgroundColor: "#1B2530",
  },
  appleButtonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.995 }],
  },
  appleButtonDisabled: { opacity: 0.42 },
  appleButtonText: {
    color: "#FFFFFF",
    fontFamily: NOTE_SANS,
    fontSize: 15.5,
  },
  googleButton: {
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  googleButtonPressed: {
    backgroundColor: "rgba(255,255,255,0.54)",
    transform: [{ scale: 0.995 }],
  },
  googleButtonText: {
    color: COLORS.ink,
    fontFamily: NOTE_SANS,
    fontSize: 15.5,
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
    marginTop: 6,
    fontFamily: NOTE_SANS,
    fontSize: 11.5,
    letterSpacing: 0.23,
    color: COLORS.muted,
    textAlign: "center",
  },
});
