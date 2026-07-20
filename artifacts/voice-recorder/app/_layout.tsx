import React, { useCallback, useEffect, useRef } from 'react';
import { Alert, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  InstrumentSans_400Regular,
  InstrumentSans_400Regular_Italic,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  useFonts,
} from '@expo-google-fonts/instrument-sans';
import {
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
} from '@expo-google-fonts/newsreader';
import { type Href, Stack, useRouter } from 'expo-router';
import { ActiveRecordingBar } from '@/components/ActiveRecordingBar';
import { ensureLocationPermission } from '@/lib/location-permission';

function LocationPermissionBootstrap() {
  useEffect(() => {
    void ensureLocationPermission().then((enabled) => {
      if (enabled) return;
      Alert.alert(
        'Standort aktivieren?',
        'Damit jeder thought automatisch Stadt und Stadtteil erhält, erlaube thoughts den Standortzugriff in den Einstellungen.',
        [
          { text: 'Später', style: 'cancel' },
          {
            text: 'Einstellungen',
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
      if (!url || !url.startsWith('thoughts://record')) return;
      if (lastHandledUrlRef.current === url) return;

      lastHandledUrlRef.current = url;
      router.replace('/record' as Href);
    },
    [router],
  );

  useEffect(() => {
    void Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleUrl(url);
    });

    return () => subscription.remove();
  }, [handleUrl]);

  return null;
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
        <>
          <LocationPermissionBootstrap />
          <RecordingDeepLinkBootstrap />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="record" options={{ headerShown: false }} />
            <Stack.Screen name="thoughts/index" options={{ headerShown: false }} />
            <Stack.Screen
              name="thoughts/detail"
              options={{ headerShown: false }}
            />
          </Stack>
          <ActiveRecordingBar />
        </>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
