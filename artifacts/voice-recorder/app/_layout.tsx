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
  Redirect,
  type Href,
  Stack,
  useRouter,
  useSegments,
} from "expo-router";
import { ActiveRecordingBar } from "@/components/ActiveRecordingBar";
import { ensureLocationPermission } from "@/lib/location-permission";
import { AuthProvider, authConfig, useAuth } from "@/lib/auth";

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
  const { status } = useAuth();
  const segments = useSegments();
  const isSignInRoute = String(segments[0] ?? "") === "sign-in";

  if (authConfig.isAzureMode && status === "loading") {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#7FB0D6" />
      </View>
    );
  }

  if (
    authConfig.isAzureMode &&
    (status === "signed-out" || status === "configuration-error") &&
    !isSignInRoute
  ) {
    return <Redirect href="/sign-in" />;
  }

  if (authConfig.isAzureMode && status === "signed-in" && isSignInRoute) {
    return <Redirect href="/" />;
  }

  const appIsAvailable = !authConfig.isAzureMode || status === "signed-in";

  return (
    <>
      {appIsAvailable ? <LocationPermissionBootstrap /> : null}
      {appIsAvailable ? <RecordingDeepLinkBootstrap /> : null}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="record" options={{ headerShown: false }} />
        <Stack.Screen name="overview" options={{ headerShown: false }} />
        <Stack.Screen name="thoughts/index" options={{ headerShown: false }} />
        <Stack.Screen name="thoughts/detail" options={{ headerShown: false }} />
      </Stack>
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
