import React, { useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  InstrumentSans_400Regular,
  InstrumentSans_400Regular_Italic,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  useFonts,
} from "@expo-google-fonts/instrument-sans";
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
} from "@expo-google-fonts/newsreader";
import {
  type Href,
  Stack,
  useRouter,
  useSegments,
} from "expo-router";
import { ActiveRecordingBar } from "@/components/ActiveRecordingBar";
import { ensureLocationPermission } from "@/lib/location-permission";
import { AuthProvider, useAuth } from "@/lib/auth";

function LocationPermissionBootstrap() {
  useEffect(() => {
    void ensureLocationPermission().then((enabled) => {
      if (enabled) return;
      Alert.alert(
        "Standort aktivieren?",
        "Damit jeder thought automatisch Stadt und Stadtteil erhält, erlaube thoughts den Standortzugriff in den Einstellungen.",
        [
          { text: "Später", style: "cancel" },
          {
            text: "Einstellungen",
            onPress: () => void Linking.openSettings(),
          },
        ],
      );
    });
  }, []);

  return null;
}

function RecordingDeepLinkBootstrap() {
  const router = useRouter();
  const lastHandledUrlRef = useRef<string | null>(null);

  const handleUrl = useCallback(
    (url: string | null) => {
      if (!url || !url.startsWith("thoughts://record")) return;
      if (lastHandledUrlRef.current === url) return;

      lastHandledUrlRef.current = url;
      router.replace("/record" as Href);
    },
    [router],
  );

  useEffect(() => {
    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener("url", ({ url }) => {
      handleUrl(url);
    });

    return () => subscription.remove();
  }, [handleUrl]);

  return null;
}

function AppShell() {
  const { status, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const firstSegment = String(segments[0] ?? "");
  const isSignInRoute = firstSegment === "sign-in";
  const isOnboardingRoute = firstSegment === "onboarding";

  const appIsAvailable = status === "signed-in";
  const needsSignIn =
    status === "signed-out" || status === "configuration-error";
  const needsOnboarding =
    appIsAvailable && user !== null && !user.onboarding_complete;
  const redirecting =
    status === "loading" ||
    (needsSignIn && !isSignInRoute) ||
    (appIsAvailable && needsOnboarding && !isOnboardingRoute) ||
    (appIsAvailable &&
      !needsOnboarding &&
      (isSignInRoute || isOnboardingRoute));

  // Redirect imperatively AFTER the navigator is mounted. Returning a
  // <Redirect> (or a plain <View>) in place of the <Stack> would leave the
  // router without a mounted navigator and render a blank/white screen.
  useEffect(() => {
    if (status === "loading") return;
    if (needsSignIn && !isSignInRoute) {
      router.replace("/sign-in" as Href);
    } else if (appIsAvailable && needsOnboarding && !isOnboardingRoute) {
      router.replace("/onboarding" as Href);
    } else if (
      appIsAvailable &&
      !needsOnboarding &&
      (isSignInRoute || isOnboardingRoute)
    ) {
      router.replace("/" as Href);
    }
  }, [
    status,
    needsSignIn,
    appIsAvailable,
    needsOnboarding,
    isSignInRoute,
    isOnboardingRoute,
    router,
  ]);

  return (
    <>
      {appIsAvailable ? <LocationPermissionBootstrap /> : null}
      {appIsAvailable ? <RecordingDeepLinkBootstrap /> : null}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="record" options={{ headerShown: false }} />
        <Stack.Screen name="overview" options={{ headerShown: false }} />
        <Stack.Screen name="profile" options={{ headerShown: false }} />
        <Stack.Screen name="thoughts/index" options={{ headerShown: false }} />
        <Stack.Screen name="thoughts/detail" options={{ headerShown: false }} />
      </Stack>
      {redirecting ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#7FB0D6" />
        </View>
      ) : null}
      {appIsAvailable ? <ActiveRecordingBar /> : null}
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_400Regular_Italic,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    Newsreader_400Regular,
    Newsreader_400Regular_Italic,
  });

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F9FC",
  },
});
