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
import {
  type AudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import {
  addPendingThought,
  markPendingThoughtUploaded,
} from "@/lib/pending-thoughts";
import {
  clearActiveRecording,
  publishActiveRecording,
  registerRecorderControls,
} from "@/lib/active-recording";
import {
  ensureLocationPermission,
  LOCATION_ENABLED_KEY,
} from "@/lib/location-permission";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  NOTE_SANS,
  NOTE_SCREEN_TOP_OFFSET,
  NOTE_SERIF_EXTRALIGHT,
} from "@/components/NoteUI";
import { SkyBackground } from "@/components/SkyBackground";
import { authConfig, backendFetch } from "@/lib/auth";
import {
  formatRecordingTime,
  isBackgroundAudioSessionError,
  metadataUriFor,
  meteringToAmplitude,
  withTimeout,
} from "@/lib/recording-utils";

const C = {
  ink: "#2A3547",
  sage: "#A9CFB4",
  terracotta: "#E0836B",
  ivory: "#EBE7DA",
  ivory60: "rgba(235,231,218,0.60)",
  ivory14: "rgba(235,231,218,0.14)",
} as const;

const WAVE_HISTORY_POINTS = 24;
const WAVE_POINT_COUNT = WAVE_HISTORY_POINTS * 2 - 1;
const INITIAL_AMPLITUDES = Array.from({ length: WAVE_POINT_COUNT }, () => 0);
const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings-v2/`;
const NOTE_NUMBER_KEY = "@thoughts/next-note-number";
const RECORDING_API_URL = authConfig.apiUrl;
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

type CreateRecordingResponse = {
  recording_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
};
type RecordingStatusResponse = {
  recording_id: string;
  status: string;
};
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
  capturedAt?: string;
  locationStatus: "captured" | "disabled" | "unavailable";
  location: RecordingLocation | null;
  recordingId?: string;
};
type StoppedRecording = {
  sourceUri: string;
  durationMs: number;
  location: RecordingLocation | null;
};

async function waitForActiveAudioSession(): Promise<void> {
  if (Platform.OS !== "ios") return;

  if (AppState.currentState !== "active") {
    await new Promise<void>((resolve) => {
      let subscription: ReturnType<typeof AppState.addEventListener> | null =
        null;
      const finish = () => {
        subscription?.remove();
        resolve();
      };
      subscription = AppState.addEventListener("change", (state) => {
        if (state !== "active") return;
        finish();
      });
      // Avoid missing the transition between the initial check and listener.
      if (AppState.currentState === "active") finish();
    });
  }

  // iOS reports the React Native app as active just before AVAudioSession can
  // reliably be activated when entering through a deep link / Action Button.
  await new Promise<void>((resolve) => setTimeout(resolve, 180));
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

async function writeRecordingMetadata(
  localUri: string,
  metadata: RecordingMetadata,
): Promise<void> {
  await FileSystem.writeAsStringAsync(
    metadataUriFor(localUri),
    JSON.stringify(metadata),
  );
}

async function responseError(
  response: Response,
  fallback: string,
): Promise<Error> {
  try {
    const body = (await response.json()) as {
      detail?: string | { msg?: string }[];
      error?: string;
    };
    const detail =
      typeof body.detail === "string"
        ? body.detail
        : (body.detail
            ?.map(({ msg }) => msg)
            .filter(Boolean)
            .join(", ") ?? "");
    return new Error(detail || body.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

async function removeUploadedRecording(localUri: string): Promise<void> {
  await FileSystem.deleteAsync(localUri, { idempotent: true });
  await FileSystem.deleteAsync(metadataUriFor(localUri), { idempotent: true });
}

async function uploadRecording(localUri: string): Promise<string> {
  if (!RECORDING_API_URL) throw new Error("thought API is not configured");

  const storedMetadata = await readRecordingMetadata(localUri);
  const metadata: RecordingMetadata = storedMetadata ?? {
    capturedAt: new Date().toISOString(),
    locationStatus: "unavailable",
    location: null,
  };

  // Resume a previously created record after an interrupted upload response.
  if (metadata.recordingId) {
    const statusResponse = await backendFetch(
      `/recordings/${metadata.recordingId}`,
      { headers: { Accept: "application/json" } },
    );
    if (statusResponse.ok) {
      const existing = (await statusResponse.json()) as RecordingStatusResponse;
      if (existing.status !== "awaiting_upload") {
        await removeUploadedRecording(localUri);
        return metadata.recordingId;
      }

      const completeResponse = await backendFetch(
        `/recordings/${metadata.recordingId}/upload-complete`,
        { method: "POST", headers: { Accept: "application/json" } },
      );
      if (completeResponse.ok) {
        await removeUploadedRecording(localUri);
        return metadata.recordingId;
      }
      if (completeResponse.status !== 409) {
        throw await responseError(
          completeResponse,
          `Upload konnte nicht fortgesetzt werden (${completeResponse.status})`,
        );
      }
    } else if (statusResponse.status !== 404) {
      throw await responseError(
        statusResponse,
        `Aufnahmestatus konnte nicht geladen werden (${statusResponse.status})`,
      );
    }
    metadata.recordingId = undefined;
  }

  const createResponse = await backendFetch("/recordings", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      captured_at:
        metadata.capturedAt ??
        metadata.location?.capturedAt ??
        new Date().toISOString(),
      city: metadata.location?.city ?? null,
      suburb: metadata.location?.suburb ?? null,
    }),
  });
  if (!createResponse.ok) {
    throw await responseError(
      createResponse,
      `Aufnahme konnte nicht angelegt werden (${createResponse.status})`,
    );
  }
  const created = (await createResponse.json()) as CreateRecordingResponse;
  if (!created.recording_id || !created.upload_url) {
    throw new Error("Die API hat keine Upload-Adresse zurückgegeben.");
  }

  metadata.recordingId = created.recording_id;
  await writeRecordingMetadata(localUri, metadata);

  const uploadResponse = await FileSystem.uploadAsync(
    created.upload_url,
    localUri,
    {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: created.upload_headers,
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    },
  );
  if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
    throw new Error(`Audio-Upload fehlgeschlagen (${uploadResponse.status}).`);
  }

  const completeResponse = await backendFetch(
    `/recordings/${created.recording_id}/upload-complete`,
    { method: "POST", headers: { Accept: "application/json" } },
  );
  if (!completeResponse.ok) {
    throw await responseError(
      completeResponse,
      `Upload konnte nicht bestätigt werden (${completeResponse.status})`,
    );
  }

  await removeUploadedRecording(localUri);
  return created.recording_id;
}

let pendingRecordingSync: Promise<void> | null = null;

async function runPendingRecordingSync(): Promise<void> {
  if (!RECORDING_API_URL) return;

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

type RecorderIconName =
  | "alert"
  | "back"
  | "microphone"
  | "microphoneOff"
  | "pause"
  | "trash";

function RecorderIcon({
  color = "rgba(255,255,255,0.72)",
  name,
  size = 22,
}: {
  color?: string;
  name: RecorderIconName;
  size?: number;
}) {
  return (
    <Svg
      accessibilityElementsHidden
      focusable={false}
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      {name === "back" ? (
        <Path
          d="M15.5 5.5 9 12l6.5 6.5"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.4}
        />
      ) : null}
      {name === "trash" ? (
        <Path
          d="M4.5 7h15M9.5 7V5.4A1.4 1.4 0 0 1 10.9 4h2.2a1.4 1.4 0 0 1 1.4 1.4V7M6.6 7l.8 11.7A1.4 1.4 0 0 0 8.8 20h6.4a1.4 1.4 0 0 0 1.4-1.3L17.4 7"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.4}
        />
      ) : null}
      {name === "pause" ? (
        <Path
          d="M9.5 5.5v13M14.5 5.5v13"
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeWidth={1.4}
        />
      ) : null}
      {name === "microphone" || name === "microphoneOff" ? (
        <>
          <Rect
            fill="none"
            height={11}
            rx={3}
            stroke={color}
            strokeWidth={1.4}
            width={6}
            x={9}
            y={3}
          />
          <Path
            d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth={1.4}
          />
          {name === "microphoneOff" ? (
            <Path
              d="m4 4 16 16"
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeWidth={1.4}
            />
          ) : null}
        </>
      ) : null}
      {name === "alert" ? (
        <>
          <Circle
            cx={12}
            cy={12}
            fill="none"
            r={8.5}
            stroke={color}
            strokeWidth={1.4}
          />
          <Path
            d="M12 7.5v5.8M12 16.8h.01"
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeWidth={1.4}
          />
        </>
      ) : null}
    </Svg>
  );
}

function Timer({ durationMs }: { durationMs: number }) {
  const time = formatRecordingTime(durationMs);

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
  isPaused,
  reduceMotion,
}: {
  amplitude: number;
  isRecording: boolean;
  isPaused: boolean;
  reduceMotion: boolean;
}) {
  const scale = useRef(new Animated.Value(0.04)).current;
  const opacity = useRef(new Animated.Value(0.24)).current;
  const previousAmplitude = useRef(amplitude);

  useEffect(() => {
    if (isPaused) {
      if (reduceMotion) {
        opacity.setValue(0.28);
        return;
      }
      Animated.timing(opacity, {
        toValue: 0.28,
        duration: 260,
        useNativeDriver: true,
      }).start();
      return;
    }

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
  }, [amplitude, isPaused, isRecording, opacity, reduceMotion, scale]);

  return (
    <Animated.View
      style={[styles.waveBar, { opacity, transform: [{ scaleY: scale }] }]}
    />
  );
});

function Waveform({
  amplitudes,
  isRecording,
  isPaused,
  reduceMotion,
}: {
  amplitudes: number[];
  isRecording: boolean;
  isPaused: boolean;
  reduceMotion: boolean;
}) {
  return (
    <View style={styles.waveform} accessibilityElementsHidden>
      {amplitudes.map((amplitude, index) => (
        <WaveformBar
          key={index}
          amplitude={amplitude}
          isPaused={isPaused}
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
        style={({ pressed }) => [
          styles.stopPressable,
          pressed && styles.stopPressed,
        ]}
      >
        <View style={styles.stopGlass}>
          <View style={styles.stopSquare} />
        </View>
      </Pressable>
    </View>
  );
}

type ScreenState =
  | "requesting"
  | "denied"
  | "recording"
  | "paused"
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorTitle, setSaveErrorTitle] = useState(
    "Aufnahme noch nicht abgelegt",
  );
  const [discardSheetVisible, setDiscardSheetVisible] = useState(false);
  const audioRecorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(audioRecorder, 65);
  const recordingRef = useRef<AudioRecorder | null>(null);
  const stoppedRecordingRef = useRef<StoppedRecording | null>(null);
  const startingRef = useRef(false);
  const locationEnabledRef = useRef(false);
  const currentLocationRef = useRef<RecordingLocation | null>(null);
  const screenStateRef = useRef<ScreenState>("requesting");
  const isFocusedRef = useRef(true);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const startNextRecordingRef = useRef<() => void>(() => {});
  const smoothedLevelRef = useRef(0);
  const levelHistoryRef = useRef<number[]>(
    Array.from({ length: WAVE_HISTORY_POINTS }, () => 0),
  );
  const discardSheetProgress = useRef(new Animated.Value(0)).current;
  const savedMessageOpacity = useRef(new Animated.Value(0)).current;
  const savedMessageTranslate = useRef(new Animated.Value(4)).current;
  const savedScreenOpacity = useRef(new Animated.Value(1)).current;

  const returnToPrevious = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/" as Href);
  }, [router]);

  useEffect(() => {
    if (!recorderState.isRecording) return;
    setDurationMs(recorderState.durationMillis);
    const target = meteringToAmplitude(recorderState.metering);
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
  }, [
    recorderState.durationMillis,
    recorderState.isRecording,
    recorderState.metering,
  ]);

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
    if (!RECORDING_API_URL) return;

    try {
      const path = await uploadRecording(localUri);
      await markPendingThoughtUploaded(localUri, path);
    } catch (error) {
      console.error("upload error:", error);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (startingRef.current || recordingRef.current) return;
    startingRef.current = true;
    try {
      let recording: AudioRecorder | null = null;
      for (let attempt = 0; attempt < 2 && !recording; attempt += 1) {
        await waitForActiveAudioSession();
        try {
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
            // Paired with the UIBackgroundModes "audio" entitlement so leaving
            // the app does not cut the recording short.
            allowsBackgroundRecording: true,
            shouldPlayInBackground: true,
            interruptionMode: "doNotMix",
          });
          await audioRecorder.prepareToRecordAsync();
          audioRecorder.record();
          recording = audioRecorder;
        } catch (error) {
          await setAudioModeAsync({ allowsRecording: false }).catch(
            () => undefined,
          );
          if (attempt === 0 && isBackgroundAudioSessionError(error)) continue;
          throw error;
        }
      }

      if (!recording) throw new Error("Die Audio-Session ist nicht verfügbar.");
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
  }, [audioRecorder, captureLocation]);

  const startNextRecording = useCallback(() => {
    if (
      screenStateRef.current === "recording" ||
      screenStateRef.current === "paused" ||
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
        const createdAt = new Date().toISOString();
        const metadata: RecordingMetadata = {
          capturedAt: createdAt,
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
          createdAt,
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
    let sourceUri = recording.uri;
    let stoppedDurationMs = durationMs;
    try {
      await recording.stop();
      const status = recording.getStatus();
      sourceUri = recording.uri ?? status.url ?? sourceUri;
      stoppedDurationMs = Math.max(durationMs, status.durationMillis);
      recordingRef.current = null;
    } catch (error) {
      console.error("stop error:", error);
      const status = recording.getStatus();
      sourceUri = recording.uri ?? status.url ?? sourceUri;
      if (status?.isRecording) {
        setScreenState("recording");
        return;
      }
      recordingRef.current = null;
    }
    setSavedDurationMs(stoppedDurationMs);
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);

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
    const stopped = { sourceUri, durationMs: stoppedDurationMs, location };
    stoppedRecordingRef.current = stopped;
    await finishStoppedRecording(stopped);
  }, [captureLocation, durationMs, finishStoppedRecording]);

  const pauseRecording = useCallback(() => {
    const recording = recordingRef.current;
    if (!recording || screenStateRef.current !== "recording") return;

    recording.pause();
    const status = recording.getStatus();
    setDurationMs((current) => Math.max(current, status.durationMillis));
    setScreenState("paused");
    void Haptics.selectionAsync();
  }, []);

  const resumeRecording = useCallback(() => {
    const recording = recordingRef.current;
    if (!recording || screenStateRef.current !== "paused") return;

    recording.record();
    setScreenState("recording");
    void Haptics.selectionAsync();
  }, []);

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
    let uri = recording.uri;
    try {
      await recording.stop();
      uri = recording.uri ?? recording.getStatus().url ?? uri;
      await setAudioModeAsync({ allowsRecording: false });
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
      returnToPrevious();
    }
  }, [returnToPrevious]);

  const showDiscardSheet = useCallback(() => {
    setDiscardSheetVisible(true);
    discardSheetProgress.stopAnimation();
    discardSheetProgress.setValue(0);
    Animated.timing(discardSheetProgress, {
      toValue: 1,
      duration: reduceMotion ? 0 : 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [discardSheetProgress, reduceMotion]);

  const hideDiscardSheet = useCallback(
    (afterClose?: () => void) => {
      discardSheetProgress.stopAnimation();
      Animated.timing(discardSheetProgress, {
        toValue: 0,
        duration: reduceMotion ? 0 : 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        setDiscardSheetVisible(false);
        afterClose?.();
      });
    },
    [discardSheetProgress, reduceMotion],
  );

  useEffect(() => {
    screenStateRef.current = screenState;
  }, [screenState]);

  // Stopping via the recording bar finishes this screen while the user is on
  // another route. The auto-navigation below must not yank them off it.
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      return () => {
        isFocusedRef.current = false;
      };
    }, []),
  );

  // stopRecording is rebuilt on every metering tick, so the controls are
  // registered once and read the current callbacks through refs.
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
    startNextRecordingRef.current = startNextRecording;
  }, [startNextRecording, stopRecording]);

  useEffect(() => {
    registerRecorderControls({
      stop: () => void stopRecordingRef.current(),
      startNext: () => startNextRecordingRef.current(),
    });
    return () => registerRecorderControls(null);
  }, []);

  useEffect(() => {
    if (screenState === "recording") {
      publishActiveRecording(durationMs);
    } else if (screenState === "paused") {
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
        if (
          isReturning &&
          isFocusedRef.current &&
          screenStateRef.current === "saved"
        ) {
          returnToPrevious();
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
  }, [returnToPrevious, startNextRecording]);

  useEffect(() => {
    if (screenState !== "saved" || !isFocusedRef.current) return;
    savedMessageOpacity.setValue(reduceMotion ? 1 : 0);
    savedMessageTranslate.setValue(reduceMotion ? 0 : 4);
    savedScreenOpacity.setValue(1);
    Animated.parallel([
      Animated.timing(savedMessageOpacity, {
        toValue: 1,
        duration: reduceMotion ? 0 : 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(savedMessageTranslate, {
        toValue: 0,
        duration: reduceMotion ? 0 : 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    const timeout = setTimeout(() => {
      Animated.timing(savedScreenOpacity, {
        toValue: 0,
        duration: reduceMotion ? 0 : 550,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished && isFocusedRef.current) returnToPrevious();
      });
    }, 1_500);
    return () => clearTimeout(timeout);
  }, [
    reduceMotion,
    returnToPrevious,
    savedMessageOpacity,
    savedMessageTranslate,
    savedScreenOpacity,
    screenState,
  ]);

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

      const { granted } = await requestRecordingPermissionsAsync();
      if (granted) await startRecording();
      else setScreenState("denied");
    })();

    return () => {
      clearActiveRecording();
      void recordingRef.current?.stop().catch(() => {});
    };
  }, [captureLocation, startRecording]);

  const isActive = screenState === "recording";
  const isPaused = screenState === "paused";
  const canControl = isActive || isPaused;
  const isSaved = screenState === "saved";
  const displayDurationMs = isSaved
    ? savedDurationMs
    : screenState === "stopping"
      ? Math.max(savedDurationMs, durationMs)
      : durationMs;
  const paddingTop =
    Math.max(insets.top + NOTE_SCREEN_TOP_OFFSET, 0) +
    (Platform.OS === "web" ? 52 : 0);
  const paddingBottom = insets.bottom + (Platform.OS === "web" ? 30 : 28);

  const shellStyle = [styles.root, { paddingTop, paddingBottom }];

  if (screenState === "denied") {
    return (
      <View style={shellStyle}>
        <SkyBackground reduceMotion={reduceMotion} />
        <View style={styles.messageContent}>
          <RecorderIcon name="microphoneOff" size={42} color={C.sage} />
          <Text style={styles.messageTitle}>Mikrofonzugriff erforderlich</Text>
          <Text style={styles.messageBody}>
            Erlaube den Mikrofonzugriff in den Einstellungen, um eine Aufnahme
            zu starten.
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
          <RecorderIcon name="alert" size={42} color={C.sage} />
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
              <Text style={styles.recordAgainText}>Erneut versuchen</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={returnToPrevious}
              style={({ pressed }) => [
                styles.recordAgainButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.recordAgainText}>Zurück zur Übersicht</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <Animated.View style={[shellStyle, { opacity: savedScreenOpacity }]}>
      <SkyBackground reduceMotion={reduceMotion} />

      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zurück zu den Gedanken"
          hitSlop={8}
          // Pushing keeps this screen mounted so the recording survives the
          // navigation; going back would unmount it and stop the audio.
          onPress={() => router.push("/" as Href)}
          style={({ pressed }) => [
            styles.archiveButton,
            pressed && styles.pressed,
          ]}
        >
          <RecorderIcon name="back" size={22} />
        </Pressable>
      </View>

      <View style={styles.center}>
        <Timer durationMs={displayDurationMs} />
        <View style={styles.stateSlot}>
          {isPaused ? <Text style={styles.pausedText}>pausiert</Text> : null}
          {isSaved ? (
            <Animated.View
              style={[
                styles.uploadStatus,
                {
                  opacity: savedMessageOpacity,
                  transform: [{ translateY: savedMessageTranslate }],
                },
              ]}
            >
              <View style={styles.uploadDot} />
              <Text style={styles.uploadText}>wird sicher hochgeladen</Text>
            </Animated.View>
          ) : null}
        </View>
        {isSaved ? (
          <View style={styles.waveformPlaceholder} />
        ) : (
          <Waveform
            amplitudes={amplitudes}
            isPaused={isPaused || screenState === "stopping"}
            isRecording={isActive}
            reduceMotion={reduceMotion}
          />
        )}
      </View>

      <View style={styles.bottomControls}>
        {canControl ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Aufnahme verwerfen"
              hitSlop={8}
              onPress={showDiscardSheet}
              style={({ pressed }) => [
                styles.sideControl,
                pressed && styles.pressed,
              ]}
            >
              <RecorderIcon
                name="trash"
                size={21}
                color="rgba(255,255,255,0.50)"
              />
            </Pressable>
            <StopButton disabled={false} onPress={stopRecording} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isPaused ? "Aufnahme fortsetzen" : "Aufnahme pausieren"
              }
              hitSlop={8}
              onPress={isPaused ? resumeRecording : pauseRecording}
              style={({ pressed }) => [
                styles.sideControl,
                pressed && styles.pressed,
              ]}
            >
              <RecorderIcon
                name={isPaused ? "microphone" : "pause"}
                size={21}
              />
            </Pressable>
          </>
        ) : null}
      </View>

      {discardSheetVisible ? (
        <View style={styles.sheetLayer}>
          <Animated.View
            style={[
              styles.sheetBackdrop,
              { opacity: discardSheetProgress },
            ]}
          >
            <Pressable
              accessibilityLabel="Verwerfen schließen"
              accessibilityRole="button"
              onPress={() => hideDiscardSheet()}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
          <Animated.View
            style={[
              styles.discardSheet,
              {
                paddingBottom: Math.max(insets.bottom, 18) + 16,
                transform: [
                  {
                    translateY: discardSheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [320, 0],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.sheetTitle}>Aufnahme verwerfen?</Text>
            <View style={styles.sheetActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => hideDiscardSheet()}
                style={({ pressed }) => [
                  styles.sheetButton,
                  styles.keepButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.sheetButtonText}>Behalten</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  hideDiscardSheet(() => void discardRecording())
                }
                style={({ pressed }) => [
                  styles.sheetButton,
                  styles.discardButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.sheetButtonText}>Verwerfen</Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      ) : null}
    </Animated.View>
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
    transform: [{ translateY: -20 }],
  },
  topBar: {
    minHeight: 44,
    marginHorizontal: -10,
    flexDirection: "row",
    alignItems: "center",
  },
  archiveButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
  timer: {
    minWidth: 250,
    fontFamily: NOTE_SERIF_EXTRALIGHT,
    fontSize: 74,
    lineHeight: 78,
    letterSpacing: -1.2,
    color: "rgba(255,255,255,0.96)",
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
    textAlign: "center",
  },
  stateSlot: {
    height: 22,
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  pausedText: {
    fontFamily: NOTE_SANS,
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,255,255,0.55)",
  },
  uploadStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  uploadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.sage,
    shadowColor: C.sage,
    shadowOpacity: 0.55,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
  },
  uploadText: {
    fontFamily: NOTE_SANS,
    fontSize: 14,
    lineHeight: 20,
    color: C.sage,
  },
  waveform: {
    width: 234,
    height: 44,
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  waveformPlaceholder: { width: 234, height: 44, marginTop: 20 },
  waveBar: {
    width: 2,
    height: 44,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  bottomControls: {
    width: "100%",
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sideControl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  stopWrap: {
    width: 74,
    height: 74,
    alignItems: "center",
    justifyContent: "center",
  },
  stopPressable: {
    width: 74,
    height: 74,
    borderRadius: 37,
    shadowColor: "#24455F",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7,
  },
  stopGlass: {
    flex: 1,
    borderRadius: 37,
    backgroundColor: "rgba(255,255,255,0.96)",
    alignItems: "center",
    justifyContent: "center",
  },
  stopSquare: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: C.ink,
  },
  stopPressed: { opacity: 0.88, transform: [{ scale: 0.96 }] },
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
    fontFamily: NOTE_SANS,
    fontSize: 20,
    color: C.ivory,
    textAlign: "center",
  },
  messageBody: {
    maxWidth: 280,
    fontFamily: NOTE_SANS,
    fontSize: 15,
    lineHeight: 22,
    color: C.ivory60,
    textAlign: "center",
  },
  savedActions: { alignItems: "center", gap: 12 },
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
    borderColor: "rgba(235,231,218,0.30)",
  },
  recordAgainText: {
    fontFamily: NOTE_SANS,
    fontSize: 15,
    color: C.ivory,
  },
  bottomSpacer: { height: 52 },
  sheetLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    justifyContent: "flex-end",
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,18,30,0.24)",
  },
  discardSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 24,
    paddingHorizontal: 24,
    backgroundColor: "rgba(38,48,66,0.96)",
  },
  sheetTitle: {
    marginBottom: 20,
    fontFamily: NOTE_SANS,
    fontSize: 19,
    lineHeight: 25,
    color: "rgba(255,255,255,0.94)",
  },
  sheetActions: { flexDirection: "row", gap: 12 },
  sheetButton: {
    minHeight: 48,
    flex: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  keepButton: { backgroundColor: "rgba(255,255,255,0.14)" },
  discardButton: { backgroundColor: "rgba(224,131,107,0.76)" },
  sheetButtonText: {
    fontFamily: NOTE_SANS,
    fontSize: 15,
    color: "#FFFFFF",
  },
});

export default RecorderScreen;
