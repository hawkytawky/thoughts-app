export function mergeThoughtDays(
  current: ReadonlySet<string>,
  incoming: Iterable<string>,
): Set<string> {
  const next = new Set(current);
  for (const day of incoming) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) next.add(day);
  }
  return next;
}

export function thoughtDaysFromCounts(
  counts: Iterable<readonly [string, number]>,
): Set<string> {
  return mergeThoughtDays(
    new Set(),
    Array.from(counts)
      .filter(([, count]) => count > 0)
      .map(([day]) => day),
  );
}

export function replaceThoughtMonth(
  current: ReadonlySet<string>,
  month: string,
  incoming: Iterable<string>,
): Set<string> {
  const next = new Set(
    [...current].filter((day) => day.slice(0, 7) !== month),
  );
  return mergeThoughtDays(
    next,
    [...incoming].filter((day) => day.slice(0, 7) === month),
  );
}