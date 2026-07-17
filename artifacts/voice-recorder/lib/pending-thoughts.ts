import AsyncStorage from "@react-native-async-storage/async-storage";

const PENDING_THOUGHTS_KEY = "@thoughts/pending-thoughts";

export type PendingThought = {
  id: string;
  createdAt: string;
  durationSeconds: number;
  locationLabel: string;
  remotePath?: string;
  processingStatus?: "processing" | "failed";
  processingError?: string;
};

let mutationQueue: Promise<void> = Promise.resolve();

async function readPendingThoughts(): Promise<PendingThought[]> {
  try {
    const stored = await AsyncStorage.getItem(PENDING_THOUGHTS_KEY);
    return stored ? (JSON.parse(stored) as PendingThought[]) : [];
  } catch {
    return [];
  }
}

export async function getPendingThoughts(): Promise<PendingThought[]> {
  await mutationQueue;
  return readPendingThoughts();
}

async function savePendingThoughts(thoughts: PendingThought[]): Promise<void> {
  await AsyncStorage.setItem(PENDING_THOUGHTS_KEY, JSON.stringify(thoughts));
}

function mutatePendingThoughts(
  mutate: (thoughts: PendingThought[]) => PendingThought[],
): Promise<void> {
  const mutation = mutationQueue.then(async () => {
    const current = await readPendingThoughts();
    await savePendingThoughts(mutate(current));
  });
  mutationQueue = mutation.catch(() => undefined);
  return mutation;
}

export async function addPendingThought(thought: PendingThought): Promise<void> {
  await mutatePendingThoughts((current) => [
    thought,
    ...current.filter(({ id }) => id !== thought.id),
  ]);
}

export async function markPendingThoughtUploaded(
  id: string,
  remotePath: string,
): Promise<void> {
  await mutatePendingThoughts((current) =>
    current.map((thought) =>
      thought.id === id
        ? {
            ...thought,
            remotePath,
            processingStatus: "processing",
            processingError: undefined,
          }
        : thought,
    ),
  );
}

export async function markPendingThoughtProcessingFailed(
  id: string,
  error: string,
): Promise<void> {
  await mutatePendingThoughts((current) =>
    current.map((thought) =>
      thought.id === id
        ? {
            ...thought,
            processingStatus: "failed",
            processingError: error,
          }
        : thought,
    ),
  );
}

export async function markPendingThoughtProcessing(
  id: string,
): Promise<void> {
  await mutatePendingThoughts((current) =>
    current.map((thought) =>
      thought.id === id
        ? {
            ...thought,
            processingStatus: "processing",
            processingError: undefined,
          }
        : thought,
    ),
  );
}

export async function removePendingThought(id: string): Promise<void> {
  await mutatePendingThoughts((current) =>
    current.filter((thought) => thought.id !== id),
  );
}
