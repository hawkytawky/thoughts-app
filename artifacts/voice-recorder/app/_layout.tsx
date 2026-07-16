import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  DMSans_300Light,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  useFonts,
} from '@expo-google-fonts/dm-sans';
import { Stack } from 'expo-router';
import { ActiveRecordingBar } from '@/components/ActiveRecordingBar';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_300Light,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });

  // Wait for fonts before rendering — no splash screen logic needed
  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="record" options={{ headerShown: false }} />
            <Stack.Screen name="thoughts/index" options={{ headerShown: false }} />
            <Stack.Screen
              name="thoughts/rec-16-32"
              options={{ headerShown: false }}
            />
          </Stack>
          <ActiveRecordingBar />
        </>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
