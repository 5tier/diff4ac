import { useEffect, useState } from "react";
import type { ChangeFile } from "../src/types";
import type { HunkHighlight } from "../src/diff/rows";
import { highlightHunks, languageForPath } from "./highlight";

interface HighlightEntry {
  readonly key: string;
  readonly value: readonly HunkHighlight[] | null;
}

export function useHunkHighlights(
  file: ChangeFile,
): readonly HunkHighlight[] | null {
  const key = `${file.contentHash}\u0000${file.path}`;
  const [entry, setEntry] = useState<HighlightEntry | null>(null);

  useEffect(() => {
    const language = languageForPath(file.path);
    if (file.binary || !language) {
      setEntry({ key, value: null });
      return;
    }

    let cancelled = false;
    highlightHunks(file.hunks, language)
      .then((value) => {
        if (!cancelled) {
          setEntry({ key, value });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEntry({ key, value: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [key, file.binary, file.hunks, file.path]);

  return entry?.key === key ? entry.value : null;
}
