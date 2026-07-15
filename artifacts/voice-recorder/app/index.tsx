import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Audio, InterruptionModeIOS } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

const C = {
  ink: "#10180F",
  ink2: "#152113",
  moss: "#26351F",
  sage: "#93A67E",
  sageSoft: "#5C7048",
  ivory: "#EBE7DA",
  ivory60: "rgba(235,231,218,0.60)",
  ivory35: "rgba(235,231,218,0.35)",
  ivory30: "rgba(235,231,218,0.30)",
  ivory14: "rgba(235,231,218,0.14)",
  ivory12: "rgba(235,231,218,0.12)",
} as const;

const SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, serif",
});
const SANS = Platform.select({
  ios: "System",
  android: "sans-serif",
  default: "sans-serif",
});
const WAVE_HISTORY_POINTS = 14;
const WAVE_POINT_COUNT = WAVE_HISTORY_POINTS * 2 - 1;
const INITIAL_AMPLITUDES = Array.from({ length: WAVE_POINT_COUNT }, () => 0);
const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings/`;
const NOTE_NUMBER_KEY = "@thoughts/next-note-number";
const RECORDING_UPLOAD_URL =
  process.env.EXPO_PUBLIC_THOUGHTS_UPLOAD_URL?.replace(/\/+$/, "");

type UploadResponse = { relativePath?: string; error?: string };
type SyncState = "idle" | "uploading" | "uploaded" | "pending";

async function uploadRecording(localUri: string): Promise<string> {
  if (!RECORDING_UPLOAD_URL) throw new Error("Upload URL is not configured");

  const response = await FileSystem.uploadAsync(
    `${RECORDING_UPLOAD_URL}/recordings`,
    localUri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { "Content-Type": "audio/mp4" },
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    },
  );
  const body = JSON.parse(response.body || "{}") as UploadResponse;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      body.error ?? `Upload failed with status ${response.status}`,
    );
  }
  if (!body.relativePath) throw new Error("Receiver returned no file path");

  await FileSystem.deleteAsync(localUri, { idempotent: true });
  return body.relativePath;
}

async function syncPendingRecordings(): Promise<void> {
  if (!RECORDING_UPLOAD_URL) return;

  let fileNames: string[];
  try {
    fileNames = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
  } catch {
    return;
  }

  for (const fileName of fileNames.filter((name) => name.endsWith(".m4a"))) {
    try {
      await uploadRecording(`${RECORDINGS_DIR}${fileName}`);
    } catch {
      // Keep the local file; a later launch or recording will retry it.
    }
  }
}

function meteringToAmplitude(decibels: number | undefined): number {
  if (decibels === undefined || !Number.isFinite(decibels)) return 0;

  // Keep ambient room noise still while preserving a soft onset for speech.
  const silenceFloor = -40;
  const loudSpeech = -10;
  if (decibels <= silenceFloor) return 0;

  const normalized = Math.min(
    1,
    (decibels - silenceFloor) / (loudSpeech - silenceFloor),
  );
  const eased = normalized * normalized * (3 - 2 * normalized);
  return Math.pow(eased, 1.18);
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function Timer({ durationMs }: { durationMs: number }) {
  const time = formatTime(durationMs);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Aufnahmedauer ${time}`}
      style={styles.timerRow}
    >
      {time.split("").map((character, index) => (
        <Text
          accessibilityElementsHidden
          key={`${index}-${character}`}
          style={[
            styles.timer,
            character === ":" ? styles.timerSeparator : styles.timerDigit,
          ]}
        >
          {character}
        </Text>
      ))}
    </View>
  );
}

function OrganicBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="base" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.ink} />
            <Stop offset="1" stopColor={C.ink2} />
          </LinearGradient>
          <RadialGradient id="b1" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={C.sageSoft} stopOpacity="0.35" />
            <Stop offset="1" stopColor={C.sageSoft} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="b2" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={C.moss} stopOpacity="0.85" />
            <Stop offset="1" stopColor={C.moss} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="b3" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={C.sage} stopOpacity="0.18" />
            <Stop offset="1" stopColor={C.sage} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="b4" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={C.sageSoft} stopOpacity="0.22" />
            <Stop offset="1" stopColor={C.sageSoft} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#base)" />
        <Circle cx="10%" cy="8%" r="45%" fill="url(#b1)" />
        <Circle cx="95%" cy="42%" r="40%" fill="url(#b2)" />
        <Circle cx="15%" cy="95%" r="42%" fill="url(#b3)" />
        <Circle cx="90%" cy="78%" r="30%" fill="url(#b4)" />
      </Svg>
    </View>
  );
}

function PulsingDot({ reduceMotion }: { reduceMotion: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    opacity.setValue(1);
    if (reduceMotion) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.35,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);

  return <Animated.View style={[styles.dot, { opacity }]} />;
}

const WaveformBar = React.memo(function WaveformBar({
  amplitude,
  isRecording,
  reduceMotion,
}: {
  amplitude: number;
  isRecording: boolean;
  reduceMotion: boolean;
}) {
  const scale = useRef(new Animated.Value(0.04)).current;
  const opacity = useRef(new Animated.Value(0.24)).current;
  const previousAmplitude = useRef(amplitude);

  useEffect(() => {
    const targetScale = isRecording ? 0.045 + amplitude * 0.955 : 0.045;
    const targetOpacity = isRecording
      ? 0.22 + Math.min(1, amplitude * 1.3) * 0.72
      : 0.22;
    const isRising = amplitude > previousAmplitude.current;
    previousAmplitude.current = amplitude;

    if (reduceMotion) {
      scale.setValue(targetScale);
      opacity.setValue(targetOpacity);
      return;
    }

    const duration = isRising ? 70 : 180;
    Animated.parallel([
      Animated.timing(scale, {
        toValue: targetScale,
        duration,
        easing: isRising
          ? Easing.out(Easing.cubic)
          : Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: targetOpacity,
        duration,
        useNativeDriver: true,
      }),
    ]).start();
  }, [amplitude, isRecording, opacity, reduceMotion, scale]);

  return (
    <Animated.View
      style={[styles.waveBar, { opacity, transform: [{ scaleY: scale }] }]}
    />
  );
});

function Waveform({
  amplitudes,
  isRecording,
  reduceMotion,
}: {
  amplitudes: number[];
  isRecording: boolean;
  reduceMotion: boolean;
}) {
  return (
    <View style={styles.waveform} accessibilityElementsHidden>
      <View style={styles.waveBaseline} />
      {amplitudes.map((amplitude, index) => (
        <WaveformBar
          key={index}
          amplitude={amplitude}
          isRecording={isRecording}
          reduceMotion={reduceMotion}
        />
      ))}
    </View>
  );
}

function StopButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <View style={[styles.stopWrap, disabled && styles.disabled]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Aufnahme stoppen"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.stopRing, pressed && styles.pressed]}
      >
        <View style={styles.stopSquare} />
      </Pressable>
    </View>
  );
}

type ScreenState = "requesting" | "denied" | "recording" | "stopping" | "saved";

export default function RecorderScreen() {
  const insets = useSafeAreaInsets();
  const [screenState, setScreenState] = useState<ScreenState>("requesting");
  const [amplitudes, setAmplitudes] = useState<number[]>(INITIAL_AMPLITUDES);
  const [durationMs, setDurationMs] = useState(0);
  const [savedDurationMs, setSavedDurationMs] = useState(0);
  const [noteNumber, setNoteNumber] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [remotePath, setRemotePath] = useState<string | null>(null);
  const [pendingUploadUri, setPendingUploadUri] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startingRef = useRef(false);
  const screenStateRef = useRef<ScreenState>("requesting");
  const smoothedLevelRef = useRef(0);
  const levelHistoryRef = useRef<number[]>(
    Array.from({ length: WAVE_HISTORY_POINTS }, () => 0),
  );

  const attemptUpload = useCallback(async (localUri: string) => {
    setPendingUploadUri(localUri);
    if (!RECORDING_UPLOAD_URL) {
      setSyncState("pending");
      return;
    }

    setSyncState("uploading");
    try {
      const path = await uploadRecording(localUri);
      setRemotePath(path);
      setPendingUploadUri(null);
      setSyncState("uploaded");
    } catch (error) {
      console.error("upload error:", error);
      setSyncState("pending");
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      });
      const { recording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        },
        (status) => {
          if (!status.isRecording) return;
          setDurationMs(status.durationMillis ?? 0);
          const target = meteringToAmplitude(status.metering);
          const current = smoothedLevelRef.current;
          const response = target > current ? 0.82 : 0.26;
          const nextLevel = current + (target - current) * response;
          const settledLevel = nextLevel < 0.012 ? 0 : nextLevel;
          smoothedLevelRef.current = settledLevel;

          const history = [
            settledLevel,
            ...levelHistoryRef.current.slice(0, WAVE_HISTORY_POINTS - 1),
          ];
          levelHistoryRef.current = history;

          const mirrored = [
            ...history.slice(1).reverse(),
            history[0],
            ...history.slice(1),
          ];
          const center = (mirrored.length - 1) / 2;
          setAmplitudes(
            mirrored.map((sample, index) => {
              const distance = Math.abs(index - center) / center;
              const envelope =
                0.28 + 0.72 * (1 - Math.pow(distance, 1.45));
              return sample * envelope;
            }),
          );
        },
        65,
      );
      recordingRef.current = recording;
      setScreenState("recording");
      void syncPendingRecordings();
    } catch (error) {
      console.error("start error:", error);
    } finally {
      startingRef.current = false;
    }
  }, []);

  const startNextRecording = useCallback(() => {
    if (
      screenStateRef.current === "recording" ||
      screenStateRef.current === "stopping"
    ) {
      return;
    }

    setNoteNumber((current) => current + 1);
    setDurationMs(0);
    smoothedLevelRef.current = 0;
    levelHistoryRef.current = Array.from(
      { length: WAVE_HISTORY_POINTS },
      () => 0,
    );
    setAmplitudes(INITIAL_AMPLITUDES);
    setRemotePath(null);
    setSyncState("idle");
    void startRecording();
  }, [startRecording]);

  const stopRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    setScreenState("stopping");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      setSavedDurationMs(durationMs);
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      recordingRef.current = null;
      if (uri) {
        await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, {
          intermediates: true,
        });
        const localUri = `${RECORDINGS_DIR}thoughts-${Date.now()}.m4a`;
        await FileSystem.copyAsync({
          from: uri,
          to: localUri,
        });
        setPendingUploadUri(localUri);
        setSyncState(RECORDING_UPLOAD_URL ? "uploading" : "pending");
        void attemptUpload(localUri);
      }
      await AsyncStorage.setItem(NOTE_NUMBER_KEY, String(noteNumber + 1));
      setAmplitudes(INITIAL_AMPLITUDES);
      setScreenState("saved");
    } catch (error) {
      console.error("stop error:", error);
      setScreenState("recording");
    }
  }, [attemptUpload, durationMs, noteNumber]);

  useEffect(() => {
    screenStateRef.current = screenState;
  }, [screenState]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        const isReturning =
          nextState === "active" &&
          (previousState === "background" || previousState === "inactive");
        previousState = nextState;
        if (isReturning && screenStateRef.current === "saved") {
          startNextRecording();
        }
      },
    );
    const urlSubscription = Linking.addEventListener("url", ({ url }) => {
      if (url.startsWith("thoughts://record")) startNextRecording();
    });

    return () => {
      appStateSubscription.remove();
      urlSubscription.remove();
    };
  }, [startNextRecording]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const storedNumber = Number(
          await AsyncStorage.getItem(NOTE_NUMBER_KEY),
        );
        if (Number.isInteger(storedNumber) && storedNumber > 0) {
          setNoteNumber(storedNumber);
        } else {
          const recordings =
            await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
          const initialNumber =
            recordings.filter((name) => name.endsWith(".m4a")).length + 1;
          setNoteNumber(initialNumber);
          await AsyncStorage.setItem(NOTE_NUMBER_KEY, String(initialNumber));
        }
      } catch {
        setNoteNumber(1);
      }

      void syncPendingRecordings();

      const { status } = await Audio.requestPermissionsAsync();
      if (status === "granted") await startRecording();
      else setScreenState("denied");
    })();

    return () => {
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, [startRecording]);

  const isActive = screenState === "recording";
  const isStopping = screenState === "stopping";
  const paddingTop = insets.top + (Platform.OS === "web" ? 52 : 24);
  const paddingBottom = insets.bottom + (Platform.OS === "web" ? 30 : 28);

  const shellStyle = [styles.root, { paddingTop, paddingBottom }];

  if (screenState === "denied") {
    return (
      <View style={shellStyle}>
        <OrganicBackground />
        <View style={styles.messageContent}>
          <Ionicons name="mic-off-outline" size={42} color={C.sage} />
          <Text style={styles.messageTitle}>microphone access needed</Text>
          <Text style={styles.messageBody}>
            Enable microphone access in Settings to use thoughts.
          </Text>
        </View>
        <View style={styles.bottomSpacer} />
      </View>
    );
  }

  if (screenState === "saved") {
    return (
      <View style={shellStyle}>
        <OrganicBackground />
        <View style={styles.messageContent}>
          <View style={styles.savedRing}>
            <Ionicons name="checkmark" size={34} color={C.sage} />
          </View>
          <Text style={styles.status}>
            {syncState === "uploaded"
              ? "sent to Mac"
              : syncState === "uploading"
                ? "sending to Mac"
                : syncState === "pending"
                  ? "saved locally"
                  : "saved"}
          </Text>
          <Text style={styles.savedDuration}>
            {formatTime(savedDurationMs)}
          </Text>
          <Text style={styles.savedPath}>
            {syncState === "uploaded" && remotePath
              ? remotePath
              : syncState === "uploading"
                ? "Uploading privately through Tailscale"
                : RECORDING_UPLOAD_URL
                  ? "Mac unavailable · kept safely on iPhone"
                  : "Upload URL not configured · kept safely on iPhone"}
          </Text>
        </View>
        <View style={styles.savedActions}>
          {pendingUploadUri && RECORDING_UPLOAD_URL && (
            <Pressable
              accessibilityRole="button"
              disabled={syncState === "uploading"}
              onPress={() => void attemptUpload(pendingUploadUri)}
              style={({ pressed }) => [
                styles.retryButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name="cloud-upload-outline"
                size={17}
                color={C.ivory60}
              />
              <Text style={styles.retryText}>
                {syncState === "uploading" ? "sending" : "retry upload"}
              </Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              startNextRecording();
            }}
            style={({ pressed }) => [
              styles.recordAgainButton,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="mic-outline" size={18} color={C.ivory} />
            <Text style={styles.recordAgainText}>record again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={shellStyle}>
      <OrganicBackground />

      <View style={styles.center}>
        <View style={styles.statusRow}>
          {isActive && <PulsingDot reduceMotion={reduceMotion} />}
          <Text style={styles.status}>
            {isActive ? "listening" : isStopping ? "saving" : "preparing"}
          </Text>
        </View>
        <Timer durationMs={durationMs} />
        <Waveform
          amplitudes={amplitudes}
          isRecording={isActive}
          reduceMotion={reduceMotion}
        />
      </View>

      <View style={styles.bottom}>
        <StopButton
          disabled={!isActive}
          onPress={stopRecording}
        />
        <Text style={styles.hint}>
          {isStopping ? "saving your thought" : "tap to stop"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: C.ink,
    paddingHorizontal: 30,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    transform: [{ translateY: -16 }],
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.sage },
  status: {
    fontFamily: SERIF,
    fontStyle: "italic",
    fontSize: 17,
    color: C.ivory60,
  },
  timer: {
    fontFamily: SERIF,
    fontSize: 76,
    fontWeight: "400",
    color: C.ivory,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
    textAlign: "center",
  },
  timerRow: { flexDirection: "row", alignItems: "baseline" },
  timerDigit: { width: 45 },
  timerSeparator: { width: 20 },
  waveform: {
    height: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3.6,
    position: "relative",
  },
  waveBaseline: {
    position: "absolute",
    width: 174,
    height: StyleSheet.hairlineWidth,
    backgroundColor: C.ivory12,
  },
  waveBar: {
    width: 2.4,
    height: 68,
    borderRadius: 2,
    backgroundColor: C.sage,
  },
  bottom: { alignItems: "center", gap: 22 },
  stopWrap: {
    width: 86,
    height: 86,
    alignItems: "center",
    justifyContent: "center",
  },
  stopRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 1,
    borderColor: C.ivory30,
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: C.ivory,
  },
  hint: {
    fontFamily: SERIF,
    fontStyle: "italic",
    fontSize: 15,
    color: C.ivory60,
  },
  disabled: { opacity: 0.42 },
  pressed: { opacity: 0.68 },
  messageContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 18,
  },
  messageTitle: {
    marginTop: 10,
    fontFamily: SERIF,
    fontStyle: "italic",
    fontSize: 22,
    color: C.ivory,
    textAlign: "center",
  },
  messageBody: {
    maxWidth: 280,
    fontFamily: SERIF,
    fontSize: 15,
    lineHeight: 22,
    color: C.ivory60,
    textAlign: "center",
  },
  savedRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1,
    borderColor: C.ivory30,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  savedDuration: {
    fontFamily: SERIF,
    fontSize: 48,
    color: C.ivory,
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  savedPath: {
    maxWidth: 300,
    marginTop: 14,
    fontFamily: SANS,
    fontSize: 10.5,
    lineHeight: 17,
    letterSpacing: 0.8,
    color: C.ivory35,
    textAlign: "center",
  },
  savedActions: { alignItems: "center", gap: 12 },
  retryButton: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  retryText: {
    fontFamily: SANS,
    fontSize: 10.5,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: C.ivory60,
  },
  recordAgainButton: {
    height: 52,
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 24,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.ivory30,
  },
  recordAgainText: {
    fontFamily: SERIF,
    fontStyle: "italic",
    fontSize: 16,
    color: C.ivory,
  },
  bottomSpacer: { height: 52 },
});
