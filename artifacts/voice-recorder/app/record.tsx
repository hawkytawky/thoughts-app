import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
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
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import {
  addPendingThought,
  markPendingThoughtUploaded,
} from "@/lib/pending-thoughts";
import {
  clearActiveRecording,
  publishActiveRecording,
} from "@/lib/active-recording";
import {
  ensureLocationPermission,
  LOCATION_ENABLED_KEY,
} from "@/lib/location-permission";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  NOTE_SERIF as SERIF,
  NOTE_SERIF_ITALIC as SERIF_ITALIC,
} from "@/components/NoteUI";
import { SkyBackground } from "@/components/SkyBackground";

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
type RecordingLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  capturedAt: string;
  city?: string | null;
  suburb?: string | null;
};
type RecordingMetadata = {
  locationStatus: "captured" | "disabled" | "unavailable";
  location: RecordingLocation | null;
};
type StoppedRecording = {
  sourceUri: string;
  durationMs: number;
  location: RecordingLocation | null;
};

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutResult = new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs);
  });
  const result = await Promise.race([promise, timeoutResult]);
  if (timeout) clearTimeout(timeout);
  return result;
}

function metadataUriFor(localUri: string): string {
  return localUri.replace(/\.m4a$/, ".location.json");
}

async function readRecordingMetadata(
  localUri: string,
): Promise<RecordingMetadata | null> {
  try {
    return JSON.parse(
      await FileSystem.readAsStringAsync(metadataUriFor(localUri)),
    ) as RecordingMetadata;
  } catch {
    return null;
  }
}

async function uploadRecording(localUri: string): Promise<string> {
  if (!RECORDING_UPLOAD_URL) throw new Error("Upload URL is not configured");

  const metadata = await readRecordingMetadata(localUri);
  const location = metadata?.location;
  const headers: Record<string, string> = {
    "Content-Type": "audio/mp4",
    "X-Thoughts-Location-Status": metadata?.locationStatus ?? "unavailable",
  };
  if (location) {
    headers["X-Thoughts-Latitude"] = String(location.latitude);
    headers["X-Thoughts-Longitude"] = String(location.longitude);
    headers["X-Thoughts-Location-Captured-At"] = location.capturedAt;
    if (location.city) {
      headers["X-Thoughts-City"] = encodeURIComponent(location.city);
    }
    if (location.suburb) {
      headers["X-Thoughts-Suburb"] = encodeURIComponent(location.suburb);
    }
    if (location.accuracy !== null) {
      headers["X-Thoughts-Location-Accuracy"] = String(location.accuracy);
    }
    if (location.altitude !== null) {
      headers["X-Thoughts-Location-Altitude"] = String(location.altitude);
    }
  }

  const response = await FileSystem.uploadAsync(
    `${RECORDING_UPLOAD_URL}/recordings`,
    localUri,
    {
      httpMethod: "POST",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers,
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
  await FileSystem.deleteAsync(metadataUriFor(localUri), { idempotent: true });
  return body.relativePath;
}

let pendingRecordingSync: Promise<void> | null = null;

async function runPendingRecordingSync(): Promise<void> {
  if (!RECORDING_UPLOAD_URL) return;

  let fileNames: string[];
  try {
    fileNames = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
  } catch {
    return;
  }

  for (const fileName of fileNames.filter((name) => name.endsWith(".m4a"))) {
    const localUri = `${RECORDINGS_DIR}${fileName}`;
    try {
      const path = await uploadRecording(localUri);
      await markPendingThoughtUploaded(localUri, path);
    } catch {
      // Keep the local file; a later launch or recording will retry it.
    }
  }
}

function syncPendingRecordings(): Promise<void> {
  if (!pendingRecordingSync) {
    pendingRecordingSync = runPendingRecordingSync().finally(() => {
      pendingRecordingSync = null;
    });
  }
  return pendingRecordingSync;
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
    <Text
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Aufnahmedauer ${time}`}
      style={styles.timer}
    >
      {time}
    </Text>
  );
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
        easing: isRising ? Easing.out(Easing.cubic) : Easing.inOut(Easing.quad),
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

type ScreenState =
  | "requesting"
  | "denied"
  | "recording"
  | "stopping"
  | "discarding"
  | "saveError"
  | "saved";

function RecorderScreen() {
  const router = useRouter();
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorTitle, setSaveErrorTitle] = useState(
    "Aufnahme noch nicht abgelegt",
  );
  const recordingRef = useRef<Audio.Recording | null>(null);
  const stoppedRecordingRef = useRef<StoppedRecording | null>(null);
  const startingRef = useRef(false);
  const locationEnabledRef = useRef(false);
  const currentLocationRef = useRef<RecordingLocation | null>(null);
  const screenStateRef = useRef<ScreenState>("requesting");
  const smoothedLevelRef = useRef(0);
  const levelHistoryRef = useRef<number[]>(
    Array.from({ length: WAVE_HISTORY_POINTS }, () => 0),
  );

  const captureLocation =
    useCallback(async (): Promise<RecordingLocation | null> => {
      if (!locationEnabledRef.current) return null;

      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== "granted") {
          locationEnabledRef.current = false;
          currentLocationRef.current = null;
          await AsyncStorage.setItem(LOCATION_ENABLED_KEY, "false");
          return null;
        }

        locationEnabledRef.current = true;
        await AsyncStorage.setItem(LOCATION_ENABLED_KEY, "true");
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Highest,
        });
        let city: string | null = null;
        let suburb: string | null = null;
        try {
          const [address] = await Location.reverseGeocodeAsync({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          city = address?.city?.trim() || address?.region?.trim() || null;
          suburb =
            address?.district?.trim() || address?.subregion?.trim() || null;
        } catch (error) {
          console.warn("reverse geocoding error:", error);
        }
        const captured: RecordingLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          capturedAt: new Date(position.timestamp).toISOString(),
          city,
          suburb,
        };
        currentLocationRef.current = captured;
        return captured;
      } catch (error) {
        console.error("location error:", error);
        return currentLocationRef.current;
      }
    }, []);

  const attemptUpload = useCallback(async (localUri: string) => {
    setPendingUploadUri(localUri);
    if (!RECORDING_UPLOAD_URL) {
      setSyncState("pending");
      return;
    }

    setSyncState("uploading");
    try {
      const path = await uploadRecording(localUri);
      await markPendingThoughtUploaded(localUri, path);
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
              const envelope = 0.28 + 0.72 * (1 - Math.pow(distance, 1.45));
              return sample * envelope;
            }),
          );
        },
        65,
      );
      recordingRef.current = recording;
      setScreenState("recording");
      if (locationEnabledRef.current) {
        // Never carry a coordinate from an older note into this recording.
        currentLocationRef.current = null;
        void captureLocation();
      }
      void syncPendingRecordings();
    } catch (error) {
      console.error("start error:", error);
      setSaveErrorTitle("Aufnahme konnte nicht starten");
      setSaveError(
        error instanceof Error
          ? error.message
          : "Die Aufnahme konnte nicht gestartet werden.",
      );
      setScreenState("saveError");
    } finally {
      startingRef.current = false;
    }
  }, [captureLocation]);

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
    setSaveError(null);
    stoppedRecordingRef.current = null;
    void startRecording();
  }, [startRecording]);

  const persistStoppedRecording = useCallback(
    async (stopped: StoppedRecording) => {
      await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, {
        intermediates: true,
      });
      const localUri = `${RECORDINGS_DIR}thoughts-${Date.now()}.m4a`;
      const localMetadataUri = metadataUriFor(localUri);
      try {
        await FileSystem.copyAsync({
          from: stopped.sourceUri,
          to: localUri,
        });
        const metadata: RecordingMetadata = {
          locationStatus: stopped.location
            ? "captured"
            : locationEnabledRef.current
              ? "unavailable"
              : "disabled",
          location: stopped.location,
        };
        await FileSystem.writeAsStringAsync(
          localMetadataUri,
          JSON.stringify(metadata),
        );
        await addPendingThought({
          id: localUri,
          createdAt: new Date().toISOString(),
          durationSeconds: stopped.durationMs / 1000,
          locationLabel: stopped.location
            ? [stopped.location.city, stopped.location.suburb]
                .filter(Boolean)
                .join(", ") || "Standort erfasst"
            : "Ohne Standort",
        });
      } catch (error) {
        await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(
          () => undefined,
        );
        await FileSystem.deleteAsync(localMetadataUri, {
          idempotent: true,
        }).catch(() => undefined);
        throw error;
      }

      setPendingUploadUri(localUri);
      setSyncState(RECORDING_UPLOAD_URL ? "uploading" : "pending");
      void attemptUpload(localUri);
    },
    [attemptUpload],
  );

  const finishStoppedRecording = useCallback(
    async (stopped: StoppedRecording) => {
      setScreenState("stopping");
      setSaveError(null);
      setSaveErrorTitle("Aufnahme noch nicht abgelegt");
      try {
        await persistStoppedRecording(stopped);
        stoppedRecordingRef.current = null;
        await AsyncStorage.setItem(
          NOTE_NUMBER_KEY,
          String(noteNumber + 1),
        ).catch(() => undefined);
        setAmplitudes(INITIAL_AMPLITUDES);
        setScreenState("saved");
      } catch (error) {
        console.error("save error:", error);
        setSaveError(
          error instanceof Error ? error.message : "Unbekannter Speicherfehler",
        );
        setScreenState("saveError");
      }
    },
    [noteNumber, persistStoppedRecording],
  );

  const stopRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    setScreenState("stopping");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const sourceUri = recording.getURI();
    try {
      setSavedDurationMs(durationMs);
      await recording.stopAndUnloadAsync();
      recordingRef.current = null;
    } catch (error) {
      console.error("stop error:", error);
      const status = await recording.getStatusAsync().catch(() => null);
      if (status?.isRecording) {
        setScreenState("recording");
        return;
      }
      recordingRef.current = null;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(
      () => undefined,
    );

    if (!sourceUri) {
      setSaveErrorTitle("Aufnahme noch nicht abgelegt");
      setSaveError("Die temporäre Audiodatei konnte nicht gefunden werden.");
      setScreenState("saveError");
      return;
    }

    const fallbackLocation = currentLocationRef.current;
    const location = locationEnabledRef.current
      ? await withTimeout(captureLocation(), 2_000, fallbackLocation)
      : null;
    const stopped = { sourceUri, durationMs, location };
    stoppedRecordingRef.current = stopped;
    await finishStoppedRecording(stopped);
  }, [captureLocation, durationMs, finishStoppedRecording]);

  const retrySavingRecording = useCallback(() => {
    const stopped = stoppedRecordingRef.current;
    if (stopped) void finishStoppedRecording(stopped);
  }, [finishStoppedRecording]);

  const discardRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;

    recordingRef.current = null;
    setScreenState("discarding");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const uri = recording.getURI();
    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch (error) {
      console.error("discard error:", error);
    } finally {
      if (uri) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch((error) =>
          console.error("discard cleanup error:", error),
        );
      }
      currentLocationRef.current = null;
      smoothedLevelRef.current = 0;
      levelHistoryRef.current = Array.from(
        { length: WAVE_HISTORY_POINTS },
        () => 0,
      );
      setAmplitudes(INITIAL_AMPLITUDES);
      setDurationMs(0);
      router.replace("/thoughts" as Href);
    }
  }, [router]);

  const confirmDiscardRecording = useCallback(() => {
    Alert.alert(
      "Aufnahme verwerfen?",
      "Diese Aufnahme wird nicht gespeichert und kann nicht wiederhergestellt werden.",
      [
        { text: "Weiter aufnehmen", style: "cancel" },
        {
          text: "Verwerfen",
          style: "destructive",
          onPress: () => void discardRecording(),
        },
      ],
    );
  }, [discardRecording]);

  useEffect(() => {
    screenStateRef.current = screenState;
  }, [screenState]);

  useEffect(() => {
    if (screenState === "recording") {
      publishActiveRecording(durationMs);
    } else if (
      screenState === "saved" ||
      screenState === "discarding" ||
      screenState === "saveError" ||
      screenState === "denied"
    ) {
      clearActiveRecording();
    }
  }, [durationMs, screenState]);

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
          router.replace("/thoughts" as Href);
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
  }, [router, startNextRecording]);

  useEffect(() => {
    if (screenState !== "saved") return;
    const timeout = setTimeout(
      () => router.replace("/thoughts" as Href),
      1_000,
    );
    return () => clearTimeout(timeout);
  }, [router, screenState]);

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

      const locationWasEnabled = await ensureLocationPermission();
      if (locationWasEnabled) {
        locationEnabledRef.current = true;
        void captureLocation();
      }

      const { status } = await Audio.requestPermissionsAsync();
      if (status === "granted") await startRecording();
      else setScreenState("denied");
    })();

    return () => {
      clearActiveRecording();
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, [captureLocation, startRecording]);

  const isActive = screenState === "recording";
  const paddingTop = insets.top + (Platform.OS === "web" ? 52 : 5);
  const paddingBottom = insets.bottom + (Platform.OS === "web" ? 30 : 28);

  const shellStyle = [styles.root, { paddingTop, paddingBottom }];

  if (screenState === "denied") {
    return (
      <View style={shellStyle}>
        <SkyBackground reduceMotion={reduceMotion} />
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

  if (screenState === "saveError") {
    return (
      <View style={shellStyle}>
        <SkyBackground reduceMotion={reduceMotion} />
        <View style={styles.messageContent}>
          <Ionicons name="alert-circle-outline" size={42} color={C.sage} />
          <Text style={styles.messageTitle}>{saveErrorTitle}</Text>
          <Text style={styles.messageBody}>
            {saveError ??
              "Die Aufnahme ist noch vorhanden. Versuche das Speichern erneut."}
          </Text>
        </View>
        <View style={styles.savedActions}>
          {stoppedRecordingRef.current ? (
            <Pressable
              accessibilityRole="button"
              onPress={retrySavingRecording}
              style={({ pressed }) => [
                styles.recordAgainButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="refresh" size={18} color={C.ivory} />
              <Text style={styles.recordAgainText}>erneut versuchen</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/thoughts" as Href)}
              style={({ pressed }) => [
                styles.recordAgainButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.recordAgainText}>zum Feed</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  if (screenState === "saved") {
    return (
      <View style={shellStyle}>
        <SkyBackground reduceMotion={reduceMotion} />
        <View style={styles.messageContent}>
          <View style={styles.savedRing}>
            <Ionicons name="checkmark" size={34} color={C.sage} />
          </View>
          <Text style={styles.status}>abgelegt</Text>
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
      <SkyBackground reduceMotion={reduceMotion} />

      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Gespeicherte Gedanken öffnen"
          hitSlop={8}
          onPress={() => router.push("/thoughts" as Href)}
          style={({ pressed }) => [
            styles.archiveButton,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.brand}>thoughts</Text>
        </Pressable>
      </View>

      <View style={styles.center}>
        <Timer durationMs={durationMs} />
        <Waveform
          amplitudes={amplitudes}
          isRecording={isActive}
          reduceMotion={reduceMotion}
        />
      </View>

      <View style={styles.bottomControls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aufnahme abbrechen und verwerfen"
          disabled={!isActive}
          hitSlop={12}
          onPress={confirmDiscardRecording}
          style={({ pressed }) => [
            styles.trashButton,
            !isActive && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="trash-outline" size={21} color={C.ivory60} />
        </Pressable>
        <StopButton disabled={!isActive} onPress={stopRecording} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#2E5E8C",
    paddingHorizontal: 30,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 30,
    transform: [{ translateY: -16 }],
  },
  topBar: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
  },
  archiveButton: {
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  brand: {
    fontFamily: SERIF,
    fontSize: 12,
    color: C.ivory60,
  },
  status: {
    fontFamily: SERIF_ITALIC,
    fontSize: 17,
    color: C.ivory60,
  },
  timer: {
    minWidth: 235,
    fontFamily: SANS,
    fontSize: 72,
    fontWeight: "300",
    letterSpacing: 1,
    color: C.ivory,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
    textAlign: "center",
  },
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
  bottomControls: {
    width: "100%",
    minHeight: 86,
    alignItems: "center",
    justifyContent: "center",
  },
  trashButton: {
    position: "absolute",
    left: -2,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
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
    fontFamily: SERIF_ITALIC,
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
    fontFamily: SANS,
    fontSize: 48,
    fontWeight: "300",
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
    fontFamily: SERIF_ITALIC,
    fontSize: 16,
    color: C.ivory,
  },
  bottomSpacer: { height: 52 },
});

export default RecorderScreen;
