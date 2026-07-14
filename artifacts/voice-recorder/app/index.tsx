import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Audio, RecordingStatus } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
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

const BAR_COUNT = 48;
const INITIAL_AMPLITUDES = Array(BAR_COUNT).fill(0.02) as number[];

// ─── Blinking record dot ────────────────────────────────────────────────────
function RecordDot() {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.1, { duration: 900, easing: Easing.inOut(Easing.sine) }),
      -1,
      true,
    );
  }, []);
  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.recDot, animStyle]} />;
}

// ─── Single waveform bar ────────────────────────────────────────────────────
const WaveformBar = React.memo(function WaveformBar({
  amplitude,
  isRecording,
  index,
}: {
  amplitude: number;
  isRecording: boolean;
  index: number;
}) {
  const height = useSharedValue(2);
  const opacity = useSharedValue(0.15);

  // bars toward the center are slightly brighter
  const centerBias = 1 - Math.abs((index - BAR_COUNT / 2) / (BAR_COUNT / 2)) * 0.4;

  useEffect(() => {
    const target = isRecording ? Math.max(2, amplitude * 68) : 2;
    const targetOp = isRecording
      ? Math.max(0.12, (amplitude * 0.75 + 0.15) * centerBias)
      : 0.1;
    height.value = withSpring(target, { damping: 20, stiffness: 260 });
    opacity.value = withTiming(targetOp, { duration: 120 });
  }, [amplitude, isRecording]);

  const animStyle = useAnimatedStyle(() => ({
    height: height.value,
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.bar, animStyle]} />;
});

// ─── Main screen ─────────────────────────────────────────────────────────────
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
          const jitter = (Math.random() - 0.5) * 0.06;
          return [...prev.slice(1), Math.max(0, normalized + jitter)];
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
        const filename = `dic-${Date.now()}.m4a`;
        const dest = dir + filename;
        await FileSystem.copyAsync({ from: uri, to: dest });
      }

      setAppState('saved');
      setAmplitudes(INITIAL_AMPLITUDES);
    } catch (e) {
      console.error('Failed to stop recording', e);
      setAppState('recording');
    }
  }, []);

  const recordAgain = useCallback(async () => {
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

  // ── Denied ─────────────────────────────────────────────────────────────────
  if (appState === 'denied') {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.background, paddingTop: insets.top + webTop },
        ]}
      >
        <Ionicons name="mic-off-outline" size={44} color={colors.mutedForeground} />
        <Text style={[styles.deniedTitle, { color: colors.foreground }]}>
          Microphone access needed
        </Text>
        <Text style={[styles.deniedSub, { color: colors.mutedForeground }]}>
          Enable microphone access in Settings to use dic.
        </Text>
      </View>
    );
  }

  // ── Saved ──────────────────────────────────────────────────────────────────
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
          {/* Thin ring check */}
          <View style={[styles.savedRing, { borderColor: colors.primary + '55' }]}>
            <Ionicons name="checkmark" size={36} color={colors.primary} />
          </View>
          <Text style={[styles.savedLabel, { color: colors.mutedForeground }]}>saved</Text>
          <Text style={[styles.savedDuration, { color: colors.foreground }]}>
            {formatTime(durationMs)}
          </Text>
          <Text style={[styles.savedPath, { color: colors.mutedForeground }]}>
            Files → On My iPhone → dic → recordings
          </Text>
        </View>

        <Pressable
          onPress={recordAgain}
          style={({ pressed }) => [
            styles.recordAgainBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.78 : 1 },
          ]}
        >
          <Ionicons name="mic" size={20} color="#fff" />
          <Text style={styles.recordAgainText}>record again</Text>
        </Pressable>
      </View>
    );
  }

  // ── Recording / Requesting / Stopping ──────────────────────────────────────
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
      {/* App name + status */}
      <View style={styles.topRow}>
        <Text style={[styles.appName, { color: colors.foreground }]}>dic</Text>
        <View style={styles.statusRow}>
          {isActive ? (
            <>
              <RecordDot />
              <Text style={[styles.recLabel, { color: colors.primary }]}>rec</Text>
            </>
          ) : (
            <Text style={[styles.recLabel, { color: colors.mutedForeground }]}>
              {isStopping ? 'saving' : '···'}
            </Text>
          )}
        </View>
      </View>

      {/* Timer — hero element */}
      <Text style={[styles.timer, { color: colors.foreground }]}>
        {formatTime(durationMs)}
      </Text>

      {/* Waveform */}
      <View style={styles.waveform}>
        {amplitudes.map((amp, i) => (
          <WaveformBar key={i} amplitude={amp} isRecording={isActive} index={i} />
        ))}
      </View>

      {/* Stop button */}
      <Pressable
        onPress={isActive ? stopRecording : undefined}
        disabled={!isActive}
        style={({ pressed }) => [
          styles.stopBtn,
          {
            borderColor: isActive ? colors.primary : colors.border,
            opacity: isActive ? (pressed ? 0.7 : 1) : 0.35,
            transform: [{ scale: pressed && isActive ? 0.92 : 1 }],
          },
        ]}
      >
        <View
          style={[
            styles.stopSquare,
            { backgroundColor: isActive ? colors.primary : colors.mutedForeground },
          ]}
        />
      </Pressable>

      <Text style={[styles.hint, { color: colors.mutedForeground }]}>tap to stop</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingVertical: 28,
  },
  centered: {
    justifyContent: 'center',
    gap: 14,
  },
  // Top row
  topRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  appName: {
    fontSize: 22,
    fontFamily: 'DMSans_500Medium',
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  recDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ff3b30',
  },
  recLabel: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    letterSpacing: 1.8,
  },
  // Timer
  timer: {
    fontSize: 68,
    fontFamily: 'DMSans_300Light',
    letterSpacing: -3,
    textAlign: 'center',
    includeFontPadding: false,
    marginTop: -8,
  },
  // Waveform
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 72,
    width: '100%',
    justifyContent: 'center',
  },
  bar: {
    width: 3.5,
    borderRadius: 2,
    backgroundColor: '#ff3b30',
  },
  // Stop button — outlined ring style
  stopBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  stopSquare: {
    width: 22,
    height: 22,
    borderRadius: 5,
  },
  hint: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  // Denied
  deniedTitle: {
    fontSize: 19,
    fontFamily: 'DMSans_500Medium',
    textAlign: 'center',
  },
  deniedSub: {
    fontSize: 14,
    fontFamily: 'DMSans_400Regular',
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 24,
  },
  // Saved
  savedContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  savedRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  savedLabel: {
    fontSize: 12,
    fontFamily: 'DMSans_400Regular',
    letterSpacing: 2,
  },
  savedDuration: {
    fontSize: 44,
    fontFamily: 'DMSans_300Light',
    letterSpacing: -2,
    marginTop: 2,
  },
  savedPath: {
    fontSize: 11,
    fontFamily: 'DMSans_400Regular',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 17,
    paddingHorizontal: 24,
    letterSpacing: 0.2,
  },
  recordAgainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 50,
    marginBottom: 12,
  },
  recordAgainText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'DMSans_500Medium',
    letterSpacing: 0.2,
  },
});
