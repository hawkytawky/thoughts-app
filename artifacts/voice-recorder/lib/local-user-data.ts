import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

const RECORDINGS_DIR = `${FileSystem.documentDirectory}recordings-v2/`;
const THOUGHTS_STORAGE_PREFIX = "@thoughts/";

export async function clearLocalUserData(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const userKeys = keys.filter((key) =>
    key.startsWith(THOUGHTS_STORAGE_PREFIX),
  );

  await Promise.all([
    userKeys.length > 0
      ? AsyncStorage.multiRemove(userKeys)
      : Promise.resolve(),
    FileSystem.deleteAsync(RECORDINGS_DIR, { idempotent: true }),
  ]);
}
