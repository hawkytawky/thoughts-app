import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio, RecordingStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { Ionicons } from '@expo/vector-icons';

const BAR_COUNT = 50;
const INITIAL_AMPLITUDES = Array(BAR_COUNT).fill(0.03) as number[];

// ─── Blinking record dot ───────────────────────────────────────────────────
function RecordDot() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.15, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, []);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.recDot, animStyle]} />;
}

// ─── Single waveform bar ───────────────────────────────────────────────────
const WaveformBar = React.memo(function WaveformBar({
  amplitude,
  isRecording,
}: {
  amplitude: number;
  isRecording: boolean;
}) {
  const height = useSharedValue(3);
  useEffect(() => {
    const target = isRecording ? Math.max(3, amplitude * 72) : 3;
    height.value = withSpring(target, { damping: 18, stiffness: 280 });
  }, [amplitude, isRecording]);
  const animStyle = useAnimatedStyle(() => ({ height: height.value }));
  return <Animated.View style={[styles.bar, animStyle]} />;
});

// ─── Main screen ──────────────────────────────────────────────────────────
type AppState = 'requesting' | 'denied' | 'recording' | 'stopping' | 'saved';

function formatTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const m = Math.floor(totalSecs / 60).toString().padStart(2, '0');
  const s = (totalSecs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function RecorderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [appState, setAppState] = useState<AppState>('requesting');
  const [amplitudes, setAmplitudes] = useState<number[]>(INITIAL_AMPLITUDES);
  const [durationMs, setDurationMs] = useState(0);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });

      rec.setOnRecordingStatusUpdate((status: RecordingStatus) => {
        if (!status.isRecording) return;
        setDurationMs(status.durationMillis ?? 0);
        const raw = status.metering ?? -160;
        const normalized = Math.max(0, Math.min(1, (raw + 60) / 60));
        setAmplitudes(prev => {
          const next = [...prev.slice(1), normalized + Math.random() * 0.08];
          return next;
        });
      });

      rec.setProgressUpdateInterval(80);
      await rec.startAsync();
      recordingRef.current = rec;
      setAppState('recording');
    } catch (e) {
      console.error('Failed to start recording', e);
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    setAppState('stopping');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = rec.getURI();
      recordingRef.current = null;

      if (uri) {
        const dir = FileSystem.documentDirectory + 'recordings/';
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const filename = `recording-${Date.now()}.m4a`;
        const dest = dir + filename;
        await FileSystem.copyAsync({ from: uri, to: dest });
        setSavedPath(dest);
      }

      setAppState('saved');
      setAmplitudes(INITIAL_AMPLITUDES);
    } catch (e) {
      console.error('Failed to stop recording', e);
      setAppState('recording');
    }
  }, []);

  const recordAgain = useCallback(async () => {
    setSavedPath(null);
    setDurationMs(0);
    setAmplitudes(INITIAL_AMPLITUDES);
    await startRecording();
  }, [startRecording]);

  // Request permission and auto-start on mount
  useEffect(() => {
    (async () => {
      const { status } = await Audio.requestPermissionsAsync();
      if (status === 'granted') {
        await startRecording();
      } else {
        setAppState('denied');
      }
    })();
    return () => {
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  const webTop = Platform.OS === 'web' ? 67 : 0;
  const webBottom = Platform.OS === 'web' ? 34 : 0;

  // ── Denied ────────────────────────────────────────────────────────────
  if (appState === 'denied') {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background, paddingTop: insets.top + webTop },
        ]}
      >
        <Ionicons name="mic-off-outline" size={48} color={colors.mutedForeground} />
        <Text style={[styles.deniedTitle, { color: colors.foreground }]}>
          Microphone access needed
        </Text>
        <Text style={[styles.deniedSub, { color: colors.mutedForeground }]}>
          Enable microphone access in Settings to use Voice Recorder.
        </Text>
      </View>
    );
  }

  // ── Saved ─────────────────────────────────────────────────────────────
  if (appState === 'saved') {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top + webTop,
            paddingBottom: insets.bottom + webBottom,
          },
        ]}
      >
        <View style={styles.savedContent}>
          <View style={[styles.savedIcon, { backgroundColor: colors.primary + '22' }]}>
            <Ionicons name="checkmark" size={40} color={colors.primary} />
          </View>
          <Text style={[styles.savedTitle, { color: colors.foreground }]}>Saved</Text>
          <Text style={[styles.savedDuration, { color: colors.mutedForeground }]}>
            {formatTime(durationMs)}
          </Text>
          <Text style={[styles.savedPath, { color: colors.mutedForeground }]}>
            Files app → On My iPhone → Voice Recorder → recordings
          </Text>
        </View>

        <Pressable
          onPress={recordAgain}
          style={({ pressed }) => [
            styles.recordAgainBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Ionicons name="mic" size={22} color="#fff" />
          <Text style={styles.recordAgainText}>Record again</Text>
        </Pressable>
      </View>
    );
  }

  // ── Recording / Requesting / Stopping ─────────────────────────────────
  const isActive = appState === 'recording';
  const isStopping = appState === 'stopping';

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + webTop,
          paddingBottom: insets.bottom + webBottom,
        },
      ]}
    >
      {/* Status row */}
      <View style={styles.statusRow}>
        {isActive ? (
          <>
            <RecordDot />
            <Text style={[styles.recLabel, { color: colors.primary }]}>REC</Text>
          </>
        ) : (
          <Text style={[styles.recLabel, { color: colors.mutedForeground }]}>
            {isStopping ? 'SAVING…' : 'STARTING…'}
          </Text>
        )}
      </View>

      {/* Timer */}
      <Text style={[styles.timer, { color: colors.foreground }]}>
        {formatTime(durationMs)}
      </Text>

      {/* Waveform */}
      <View style={styles.waveform}>
        {amplitudes.map((amp, i) => (
          <WaveformBar key={i} amplitude={amp} isRecording={isActive} />
        ))}
      </View>

      {/* Stop button */}
      <Pressable
        onPress={isActive ? stopRecording : undefined}
        disabled={!isActive}
        style={({ pressed }) => [
          styles.stopBtn,
          {
            backgroundColor: colors.primary,
            opacity: isActive ? (pressed ? 0.75 : 1) : 0.4,
            transform: [{ scale: pressed && isActive ? 0.93 : 1 }],
          },
        ]}
      >
        <View style={styles.stopSquare} />
      </Pressable>

      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        tap to stop
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  // Status
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 32,
    marginTop: 8,
  },
  recDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ff3b30',
  },
  recLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 2.5,
  },
  // Timer
  timer: {
    fontSize: 64,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -2,
    textAlign: 'center',
    includeFontPadding: false,
  },
  // Waveform
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 80,
  },
  bar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: '#ff3b30',
    opacity: 0.85,
  },
  // Stop button
  stopBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  stopSquare: {
    width: 26,
    height: 26,
    borderRadius: 5,
    backgroundColor: '#fff',
  },
  hint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  // Denied
  deniedTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    marginTop: 20,
  },
  deniedSub: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  // Saved
  savedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  savedIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  savedTitle: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.5,
  },
  savedDuration: {
    fontSize: 18,
    fontFamily: 'Inter_400Regular',
  },
  savedPath: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 18,
    paddingHorizontal: 24,
  },
  recordAgainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 50,
    marginBottom: 16,
  },
  recordAgainText: {
    color: '#fff',
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
  },
});
