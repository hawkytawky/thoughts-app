import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
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
const WAVE_PROFILE = [
  0.24, 0.34, 0.48, 0.4, 0.62, 0.52, 0.76, 0.66, 0.88, 0.7, 0.8, 0.58,
  0.68, 0.46, 0.52, 0.34, 0.24,
];
const INITIAL_AMPLITUDES = WAVE_PROFILE.map(() => 0);
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

function Header({ noteNumber }: { noteNumber: number }) {
  return (
    <View style={styles.header}>
      <Text style={styles.eyebrow}>thoughts</Text>
      <Text style={[styles.eyebrow, styles.noteNumber]}>Note {noteNumber}</Text>
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

  useEffect(() => {
    const targetScale = isRecording ? 0.04 + amplitude * 0.96 : 0.04;
    const targetOpacity = isRecording ? 0.24 + amplitude * 0.76 : 0.24;

    if (reduceMotion) {
      scale.setValue(targetScale);
      opacity.setValue(targetOpacity);
      return;
    }

    const duration = amplitude > 0.04 ? 150 : 260;
    Animated.parallel([
      Animated.timing(scale, {
        toValue: targetScale,
        duration,
        easing: Easing.out(Easing.quad),
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
      {WAVE_PROFILE.map((_, index) => (
        <WaveformBar
          key={index}
          amplitude={amplitudes[index] ?? 0}
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
  reduceMotion,
}: {
  disabled: boolean;
  onPress: () => void;
  reduceMotion: boolean;
}) {
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    breathe.setValue(0);
    if (reduceMotion || disabled) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [breathe, disabled, reduceMotion]);

  const ringScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });
  const ringOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0.2],
  });

  return (
    <View style={[styles.stopWrap, disabled && styles.disabled]}>
      <Animated.View
        style={[
          styles.outerRing,
          { opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
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
          const amplitude = meteringToAmplitude(status.metering);
          setAmplitudes((previous) =>
            WAVE_PROFILE.map((weight, index) => {
              const current = previous[index] ?? 0;
              const target = amplitude * weight;
              const response = target > current ? 0.52 : 0.18;
              const next = current + (target - current) * response;
              return next < 0.012 ? 0 : next;
            }),
          );
        },
        100,
      );
      recordingRef.current = recording;
      setScreenState("recording");
      void syncPendingRecordings();
    } catch (error) {
      console.error("start error:", error);
    }
  }, []);

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
        <Header noteNumber={noteNumber} />
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
        <Header noteNumber={noteNumber} />
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
              setNoteNumber((current) => current + 1);
              setDurationMs(0);
              setAmplitudes(INITIAL_AMPLITUDES);
              setRemotePath(null);
              setSyncState("idle");
              void startRecording();
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
      <Header noteNumber={noteNumber} />

      <View style={styles.center}>
        <View style={styles.statusRow}>
          {isActive && <PulsingDot reduceMotion={reduceMotion} />}
          <Text style={styles.status}>
            {isActive ? "listening" : isStopping ? "saving" : "preparing"}
          </Text>
        </View>
        <Text style={styles.timer}>{formatTime(durationMs)}</Text>
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
          reduceMotion={reduceMotion}
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
  header: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  eyebrow: {
    fontFamily: SANS,
    fontSize: 10.5,
    fontWeight: "500",
    letterSpacing: 2.7,
    textTransform: "uppercase",
    color: C.ivory60,
  },
  noteNumber: { color: C.ivory35 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
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
    letterSpacing: -2,
    includeFontPadding: false,
  },
  waveform: {
    height: 72,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  waveBar: {
    width: 3,
    height: 64,
    borderRadius: 2,
    backgroundColor: C.sage,
  },
  bottom: { alignItems: "center", gap: 22 },
  stopWrap: {
    width: 100,
    height: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  outerRing: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: C.ivory12,
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
