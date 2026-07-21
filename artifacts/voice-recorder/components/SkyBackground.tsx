import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Animated,
  AppState,
  type AppStateStatus,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import {
  Canvas,
  Fill,
  Shader,
  Skia,
  type SkRuntimeEffect,
} from "@shopify/react-native-skia";
import {
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
} from "react-native-reanimated";

const SHADER_SOURCE = `
uniform float2 u_resolution;
uniform float  u_time;
uniform float  u_coverage;
uniform float  u_softness;
uniform float  u_size;
uniform float  u_wind;
uniform float  u_grain;
uniform float  u_rothko;
uniform float3 u_top;
uniform float3 u_bottom;
uniform float3 u_cloud;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float valueNoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(float2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += valueNoise(p) * amp;
    p *= 2.0;
    amp *= 0.42;
  }
  return v;
}

half4 main(float2 fragCoord) {
  float2 uv = fragCoord / u_resolution;

  float t = u_time * u_wind * 0.021;
  float morph = t * 0.35;

  float2 p = fragCoord / (u_size * 8.0);
  float x = p.x + t;
  float y = p.y - t * 0.18;

  float q = fbm(float2(x + morph, y));
  float n = fbm(float2(x + 0.7 * q, y + 0.5 * q - morph * 0.4));

  float threshold = 1.0 - u_coverage / 100.0;
  float soft = max(0.03, u_softness / 100.0);
  float vBias = (uv.y - 0.55) * 0.10;

  float c = clamp((n - (threshold - vBias)) / soft, 0.0, 1.0);
  float cloudAmount = c * c * (3.0 - 2.0 * c);

  float colOff = (fbm(float2(fragCoord.x * 0.006 + t * 0.5, t * 0.3)) - 0.5) * 0.07;
  float zy = uv.y + colOff;

  float R = u_rothko / 100.0;
  float band = 0.60 * (1.0 - smoothstep(0.20, 0.38, zy))
             + 0.35 * (1.0 - smoothstep(0.52, 0.70, zy));
  float dark = 1.0 - R * band * 0.38;
  float lift = R * smoothstep(0.72, 0.94, zy) * (26.0 / 255.0);

  float vg = pow(uv.y, 0.85);
  float3 base = mix(u_top, u_bottom, vg) * dark + lift;
  float3 col = mix(base, u_cloud, cloudAmount);

  float g = (hash(fragCoord) * 2.0 - 1.0) * (u_grain / 255.0);
  col += g;

  return half4(clamp(col, 0.0, 1.0), 1.0);
}
`;

let cachedSource: SkRuntimeEffect | null = null;

type Rgb = readonly [number, number, number];
type Palette = { top: Rgb; bottom: Rgb; cloud: Rgb };

const PALETTES = {
  morning: {
    top: [118, 142, 178],
    bottom: [218, 206, 184],
    cloud: [249, 243, 230],
  },
  day: {
    top: [68, 101, 152],
    bottom: [180, 202, 224],
    cloud: [240, 244, 248],
  },
  evening: {
    top: [60, 74, 116],
    bottom: [214, 176, 158],
    cloud: [233, 214, 204],
  },
  night: {
    top: [22, 34, 62],
    bottom: [70, 90, 122],
    cloud: [128, 144, 170],
  },
} as const satisfies Record<string, Palette>;

export interface SkySettings {
  coverage: number;
  softness: number;
  size: number;
  wind: number;
  grain: number;
  rothko: number;
}

export const DEFAULT_SKY_SETTINGS: SkySettings = {
  coverage: 50,
  softness: 20,
  size: 17,
  wind: 3,
  grain: 6,
  rothko: 90,
};

function smoothstep(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
}

function mixChannel(from: number, to: number, amount: number): number {
  return (from + (to - from) * amount) / 255;
}

function mixPalette(from: Palette, to: Palette, amount: number) {
  const eased = smoothstep(amount);
  const mixRgb = (left: Rgb, right: Rgb): [number, number, number] => [
    mixChannel(left[0], right[0], eased),
    mixChannel(left[1], right[1], eased),
    mixChannel(left[2], right[2], eased),
  ];
  return {
    top: mixRgb(from.top, to.top),
    bottom: mixRgb(from.bottom, to.bottom),
    cloud: mixRgb(from.cloud, to.cloud),
  };
}

function normalizedPalette(palette: Palette) {
  return mixPalette(palette, palette, 0);
}

function cssColor(color: Rgb): string {
  return `rgb(${color.map((channel) => Math.round(channel * 255)).join(",")})`;
}

export function paletteForLocalTime(date: Date) {
  const minutes = date.getHours() * 60 + date.getMinutes();

  // 04:00–05:00 is a direct night-to-morning dawn transition.
  if (minutes >= 4 * 60 && minutes < 5 * 60) {
    return mixPalette(
      PALETTES.night,
      PALETTES.morning,
      (minutes - 4 * 60) / 60,
    );
  }
  if (minutes >= 5 * 60 && minutes < 10 * 60) {
    return mixPalette(
      PALETTES.morning,
      PALETTES.day,
      (minutes - 5 * 60) / (5 * 60),
    );
  }
  if (minutes >= 10 * 60 && minutes < 16 * 60) {
    return normalizedPalette(PALETTES.day);
  }
  if (minutes >= 16 * 60 && minutes < 20 * 60) {
    return mixPalette(
      PALETTES.day,
      PALETTES.evening,
      (minutes - 16 * 60) / (4 * 60),
    );
  }
  if (minutes >= 20 * 60 && minutes < 23 * 60) {
    return mixPalette(
      PALETTES.evening,
      PALETTES.night,
      (minutes - 20 * 60) / (3 * 60),
    );
  }
  return normalizedPalette(PALETTES.night);
}

export function SkyBackground({
  settings = DEFAULT_SKY_SETTINGS,
  reduceMotion = false,
}: {
  settings?: SkySettings;
  reduceMotion?: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const [isFocused, setIsFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );
  const [source, setSource] = useState<SkRuntimeEffect | null>(cachedSource);
  const shaderOpacity = useMemo(
    () => new Animated.Value(cachedSource ? 1 : 0),
    [],
  );
  const elapsedMs = useSharedValue(0);
  const frameRemainderMs = useSharedValue(0);
  const palette = useMemo(() => paletteForLocalTime(new Date()), []);
  const previewColors = useMemo(
    () => [cssColor(palette.top), cssColor(palette.bottom)] as const,
    [palette],
  );

  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (source) return;

    // Commit the time-matched preview first, then compile the GPU effect.
    const frame = requestAnimationFrame(() => {
      const compiled = Skia.RuntimeEffect.Make(SHADER_SOURCE);
      if (!compiled) return;
      cachedSource = compiled;
      setSource(compiled);
    });
    return () => cancelAnimationFrame(frame);
  }, [source]);

  useEffect(() => {
    if (!source) return;
    const animation = Animated.timing(shaderOpacity, {
      toValue: 1,
      duration: reduceMotion ? 0 : 320,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, shaderOpacity, source]);

  const frameCallback = useFrameCallback(({ timeSincePreviousFrame }) => {
    "worklet";
    const delta = timeSincePreviousFrame ?? 0;
    frameRemainderMs.value += delta;
    if (frameRemainderMs.value >= 1000 / 30) {
      elapsedMs.value += frameRemainderMs.value;
      frameRemainderMs.value = 0;
    }
  }, false);

  useEffect(() => {
    frameCallback.setActive(
      !reduceMotion && isFocused && appState === "active",
    );
    return () => frameCallback.setActive(false);
  }, [appState, frameCallback, isFocused, reduceMotion]);

  const uniforms = useDerivedValue(() => ({
    u_resolution: [width, height],
    u_time: elapsedMs.value / 1000,
    u_coverage: settings.coverage,
    u_softness: settings.softness,
    u_size: settings.size,
    u_wind: settings.wind,
    u_grain: settings.grain,
    u_rothko: settings.rothko,
    u_top: palette.top,
    u_bottom: palette.bottom,
    u_cloud: palette.cloud,
  }));

  return (
    <>
      <LinearGradient
        pointerEvents="none"
        colors={previewColors}
        style={StyleSheet.absoluteFill}
      />
      {source ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.shaderLayer, { opacity: shaderOpacity }]}
        >
          <Canvas style={StyleSheet.absoluteFill}>
            <Fill>
              <Shader source={source} uniforms={uniforms} />
            </Fill>
          </Canvas>
        </Animated.View>
      ) : null}
      <LinearGradient
        pointerEvents="none"
        colors={[
          "rgba(17,35,53,0.07)",
          "rgba(17,35,53,0.13)",
          "rgba(17,35,53,0.24)",
        ]}
        locations={[0, 0.52, 1]}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
}

const styles = StyleSheet.create({
  shaderLayer: StyleSheet.absoluteFillObject,
});
