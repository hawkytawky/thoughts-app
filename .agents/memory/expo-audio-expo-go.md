---
name: expo-audio not in Expo Go SDK 54
description: expo-audio causes a silent native crash in Expo Go; expo-av still works despite deprecation warning
---

expo-audio (any version) is NOT bundled in Expo Go SDK 54. Importing it causes a silent native crash — iOS bundle loads fine ("iOS Bundled Xms"), then app closes to home screen with zero JS error logs.

**Why:** expo-audio's native binary is not compiled into Expo Go. The expo-av deprecation warning ("will be removed in SDK 54") is misleading — expo-av native code IS still present in Expo Go SDK 54 and works fine.

**How to apply:** For audio recording in Expo Go projects, always use expo-av. Only switch to expo-audio with a development build (custom native binary). Correct expo-av recording API:
```ts
const { recording } = await Audio.Recording.createAsync(
  { ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true },
  onStatusCallback,
  intervalMs,
);
```

Other native modules that also crash Expo Go silently: react-native-keyboard-controller.
