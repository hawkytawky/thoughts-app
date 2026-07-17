import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

export const LOCATION_ENABLED_KEY = "@thoughts/location-enabled";

let permissionRequest: Promise<boolean> | null = null;

async function requestLocationPermission(): Promise<boolean> {
  try {
    let permission = await Location.getForegroundPermissionsAsync();

    if (permission.status !== "granted" && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync();
    }

    const enabled = permission.status === "granted";
    await AsyncStorage.setItem(LOCATION_ENABLED_KEY, String(enabled)).catch(
      () => undefined,
    );
    return enabled;
  } catch (error) {
    console.warn("location permission error:", error);
    return false;
  }
}

export function ensureLocationPermission(): Promise<boolean> {
  if (!permissionRequest) {
    permissionRequest = requestLocationPermission().finally(() => {
      permissionRequest = null;
    });
  }
  return permissionRequest;
}
