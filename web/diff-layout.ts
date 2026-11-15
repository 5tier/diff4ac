import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type {
  LayoutBlock,
  LayoutBlockKind,
  LayoutFile,
  PaneLayout,
} from "../shared/diff/layout";

const DEFAULT_ROW_HEIGHT = 20;

function naturalOffsetTop(element: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = element;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

interface RowsElement {
  readonly offsetTop: number;
  readonly rowHeight: number;
  readonly rowCount: number;
}

function readRows(element: HTMLElement, paneTop: number): RowsElement {
  const rowHeight = Number(element.dataset.rowHeight);
  const rowCount = Number(element.dataset.rowCount);
  return {
    offsetTop: naturalOffsetTop(element) - paneTop,
    rowHeight:
      Number.isFinite(rowHeight) && rowHeight > 0
        ? rowHeight
        : DEFAULT_ROW_HEIGHT,
    rowCount: Number.isFinite(rowCount) && rowCount > 0 ? rowCount : 0,
  };
}

export function measureDiffLayout(pane: HTMLElement): PaneLayout {
  const paneTop = naturalOffsetTop(pane);
  const scrollHeight = pane.scrollHeight;
  const blocks: LayoutBlock[] = [];
  const headings: LayoutBlock[] = [];

  for (const element of pane.querySelectorAll<HTMLElement>(
    "[data-layout-block]",
  )) {
    const kind = element.dataset.layoutBlock as LayoutBlockKind | undefined;
    if (!kind) {
      continue;
    }
    const block: LayoutBlock = {
      kind,
      fileKey: element.dataset.fileKey ?? null,
      commitHash: element.dataset.commitHash ?? null,
      offsetTop: naturalOffsetTop(element) - paneTop,
      height: element.offsetHeight,
    };
    blocks.push(block);
    if (kind === "commit-heading" || kind === "file-heading") {
      headings.push(block);
    }
  }

  const rowsByFile = new Map<string, RowsElement>();
  for (const element of pane.querySelectorAll<HTMLElement>(
    "[data-layout-rows]",
  )) {
    const key = element.dataset.fileKey;
    if (key) {
      rowsByFile.set(key, readRows(element, paneTop));
    }
  }

  const files = new Map<string, LayoutFile>();
  const fileOrder: string[] = [];
  const fileHeadings = blocks
    .filter((block) => block.kind === "file-heading" && block.fileKey)
    .sort((left, right) => left.offsetTop - right.offsetTop);

  let rowStart = 0;
  fileHeadings.forEach((heading, index) => {
    const key = heading.fileKey;
    if (!key) {
      return;
    }
    const rows = rowsByFile.get(key);
    const next = fileHeadings[index + 1];
    const rowCount = rows?.rowCount ?? 0;
    files.set(key, {
      fileKey: key,
      top: heading.offsetTop,
      rowsTop: rows?.offsetTop ?? null,
      rowHeight: rows?.rowHeight ?? DEFAULT_ROW_HEIGHT,
      rowCount,
      bottom: next?.offsetTop ?? scrollHeight,
      rowStart,
    });
    fileOrder.push(key);
    rowStart += rowCount;
  });

  blocks.sort(
    (left, right) =>
      left.offsetTop - right.offsetTop || left.height - right.height,
  );

  return {
    scrollHeight,
    clientHeight: pane.clientHeight,
    stickyHeight: headings.reduce(
      (max, heading) => Math.max(max, heading.height),
      0,
    ),
    blocks,
    files,
    fileOrder,
  };
}

function layoutSignature(layout: PaneLayout): string {
  const blocks = layout.blocks
    .map(
      (block) =>
        `${block.kind}:${block.fileKey ?? ""}:${block.commitHash ?? ""}:${block.offsetTop}:${block.height}`,
    )
    .join(",");
  const files = [...layout.files.values()]
    .map(
      (file) =>
        `${file.fileKey}:${file.top}:${file.rowsTop ?? ""}:${file.rowHeight}:${file.rowCount}:${file.bottom}:${file.rowStart}`,
    )
    .join(",");
  return `${layout.scrollHeight}:${layout.clientHeight}:${layout.stickyHeight}:${blocks}:${files}`;
}

export function useDiffLayout(
  pane: RefObject<HTMLElement | null>,
  revision: unknown,
): PaneLayout | null {
  const [layout, setLayout] = useState<PaneLayout | null>(null);
  const signatureRef = useRef("");

  const measure = useCallback(() => {
    const element = pane.current;
    if (!element) {
      return;
    }
    const next = measureDiffLayout(element);
    const signature = layoutSignature(next);
    if (signature !== signatureRef.current) {
      signatureRef.current = signature;
      setLayout(next);
    }
  }, [pane]);

  useLayoutEffect(() => {
    measure();
  }, [measure, revision]);

  useEffect(() => {
    const element = pane.current;
    if (!element) {
      return;
    }

    let frame = 0;
    const schedule = () => {
      if (frame !== 0) {
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const mutations = new MutationObserver(schedule);
    mutations.observe(element, { subtree: true, childList: true });
    element.addEventListener("load", schedule, true);
    element.addEventListener("error", schedule, true);
    window.addEventListener("resize", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();

    return () => {
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
      mutations.disconnect();
      element.removeEventListener("load", schedule, true);
      element.removeEventListener("error", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [measure, pane, revision]);

  return layout;
}
