import { useEffect, useMemo, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { Selection, SnapshotSide } from "../../shared/types";
import type { AppAction } from "../state/app-state";
import {
  codeViewMemoryKey,
  readCodeViewMemory,
  writeCodeViewMemory,
  type CodeViewMemory,
} from "../state/code-view-memory";

interface Params {
  readonly selection: Selection;
  readonly worktreePath: string | null;
  readonly side: SnapshotSide;
  readonly reviewPath: string | null;
  readonly expanded: readonly string[];
  readonly cursor: number;
  readonly openPath: string | null;
  readonly line: number;
  /** The live scroll line, so closing remembers the scroll position too. */
  readonly lineRef: MutableRefObject<number>;
  readonly dispatch: Dispatch<AppAction>;
}

/**
 * Remember expanded folders, the open file and the scroll line per Snapshot
 * (Selection + worktree + side) in sessionStorage, and restore them when Code
 * View opens again.
 */
export function useCodeViewMemory({
  selection,
  worktreePath,
  side,
  reviewPath,
  expanded,
  cursor,
  openPath,
  line,
  lineRef,
  dispatch,
}: Params): void {
  const memoryKey = codeViewMemoryKey(selection, worktreePath, side);
  const memoryReady = useRef(false);
  const lastMemoryKey = useRef(memoryKey);
  const lastMemoryPayload = useRef<string | null>(null);
  const memoryKeyRef = useRef(memoryKey);
  memoryKeyRef.current = memoryKey;

  const memoryForState = useMemo<CodeViewMemory>(
    () => ({ expanded, cursor, openPath, line, reviewPath }),
    [cursor, expanded, line, openPath, reviewPath],
  );
  const memoryWithScroll = (): CodeViewMemory => ({
    ...memoryForState,
    line: lineRef.current,
  });
  const memoryWithScrollRef = useRef(memoryWithScroll);
  memoryWithScrollRef.current = memoryWithScroll;

  useEffect(
    () => () => {
      writeCodeViewMemory(memoryKeyRef.current, memoryWithScrollRef.current());
    },
    [],
  );

  useEffect(() => {
    const payload = JSON.stringify(memoryForState);
    const usable = (memory: CodeViewMemory): boolean =>
      reviewPath === null || memory.reviewPath === reviewPath;
    const restore = (memory: CodeViewMemory) => {
      lastMemoryPayload.current = JSON.stringify(memory);
      dispatch({
        type: "code-view-restore",
        expanded: memory.expanded,
        cursor: memory.cursor,
        openPath: memory.openPath,
        line: memory.line,
      });
    };

    if (!memoryReady.current) {
      memoryReady.current = true;
      lastMemoryKey.current = memoryKey;
      const memory = readCodeViewMemory(memoryKey);
      if (memory && usable(memory)) {
        restore(memory);
        return;
      }
      lastMemoryPayload.current = payload;
      writeCodeViewMemory(memoryKey, memoryWithScroll());
      return;
    }

    if (lastMemoryKey.current !== memoryKey) {
      writeCodeViewMemory(lastMemoryKey.current, memoryWithScroll());
      lastMemoryKey.current = memoryKey;
      lastMemoryPayload.current = payload;
      const memory = readCodeViewMemory(memoryKey);
      if (memory && usable(memory)) {
        restore(memory);
      } else {
        dispatch({ type: "code-view-reset", keepOpen: true });
      }
      return;
    }

    if (lastMemoryPayload.current !== payload) {
      lastMemoryPayload.current = payload;
      writeCodeViewMemory(memoryKey, memoryWithScroll());
    }
  }, [dispatch, memoryForState, memoryKey, reviewPath]);
}
