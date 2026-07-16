import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_THOUGHTS_KEY = "@thoughts/pending-thoughts";

export type PendingThought = {
  id: string;
  createdAt: string;
  durationSeconds: number;
  locationLabel: string;
  remotePath?: string;
};

export async function getPendingThoughts(): Promise<PendingThought[]> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_THOUGHTS_KEY);
    return stored ? (JSON.parse(stored) as PendingThought[]) : [];
  } catch {
    return [];
  }
}

async function savePendingThoughts(thoughts: PendingThought[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_THOUGHTS_KEY, JSON.stringify(thoughts));
}

export async function addPendingThought(thought: PendingThought): Promise<void> {
  const current = await getPendingThoughts();
  await savePendingThoughts([thought, ...current.filter(({ id }) => id !== thought.id)]);
}

export async function markPendingThoughtUploaded(
  id: string,
  remotePath: string,
): Promise<void> {
  const current = await getPendingThoughts();
  await savePendingThoughts(
    current.map((thought) =>
      thought.id === id ? { ...thought, remotePath } : thought,
    ),
  );
}

export async function removePendingThought(id: string): Promise<void> {
  const current = await getPendingThoughts();
  await savePendingThoughts(current.filter((thought) => thought.id !== id));
}
