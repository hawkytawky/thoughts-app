---
name: Expo Go SDK 54 — crash causes found the hard way
description: Silent crash causes in Expo Go SDK 54 that produce zero logs before closing to home screen
---

## SplashScreen.hideAsync() crash (CONFIRMED root cause)
`SplashScreen.preventAutoHideAsync()` called at module level + `SplashScreen.hideAsync()` in useEffect crashes in Expo Go with:
"No native splash screen registered for given view controller. Call 'SplashScreen.show' first."

**Why:** In Expo Go SDK 54, the splash screen lifecycle changed. `preventAutoHideAsync()` must be configured in app.json (`"splash": { ... }`) AND the view controller must be the right one. Calling hideAsync() from a layout useEffect hits a timing issue.

**Fix:** Remove all SplashScreen logic from `_layout.tsx`. The app renders fine without it. If you need it, configure `expo-splash-screen` plugin in app.json and test carefully.

## expo-audio (NOT in Expo Go SDK 54)
expo-audio causes a silent native crash in Expo Go SDK 54. expo-av still works (the deprecation warning is JS-only; native code is present).

## Reanimated 4.x (status: OK in Expo Go SDK 54)
react-native-reanimated 4.x is fine in Expo Go SDK 54. Not the crash cause.

## react-native-keyboard-controller (NOT in Expo Go)
Causes native crash. Remove from _layout.tsx.

## Diagnosis tip
Always check Metro logs directly — the real JS error appears there. "iOS Bundled Xms" followed by silence = crash before first render = look for module-level errors or native module issues. ErrorBoundary cannot catch these.
