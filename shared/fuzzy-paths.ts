/**
 * Case-insensitive subsequence scoring for go-to-file. Higher is better; null
 * means the query is not a subsequence of the path.
 */
export function fuzzyScore(query: string, path: string): number | null {
  const needle = query.trim().toLowerCase();
  if (needle === "") {
    return 0;
  }

  const haystack = path.toLowerCase();
  const basenameStart = haystack.lastIndexOf("/") + 1;
  let matched = 0;
  let score = 0;
  let lastMatch = -2;
  let consecutive = 0;

  for (let index = 0; index < haystack.length && matched < needle.length; index++) {
    if (haystack[index] !== needle[matched]) {
      continue;
    }

    let bonus = 1;
    if (index === lastMatch + 1) {
      consecutive++;
      bonus += consecutive * 2;
    } else {
      consecutive = 0;
    }
    if (index === 0 || haystack[index - 1] === "/") {
      bonus += 4;
    }
    if (index >= basenameStart) {
      bonus += 3;
    }

    score += bonus;
    lastMatch = index;
    matched++;
  }

  if (matched < needle.length) {
    return null;
  }
  return score - haystack.length * 0.01;
}

/** Best matches first, then alphabetically for equal scores. */
export function rankPaths(
  query: string,
  paths: readonly string[],
  limit: number,
): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const score = fuzzyScore(query, path);
    if (score !== null) {
      scored.push({ path, score });
    }
  }

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.path.toLowerCase().localeCompare(right.path.toLowerCase()),
  );
  return scored.slice(0, limit).map((entry) => entry.path);
}
