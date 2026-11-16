import type { GitGateway } from "../git/gateway";
import { parseModeChange } from "../../shared/diff/mode";
import { isSafeRelativePath } from "../paths";
import {
  countDiffLines,
  looksBinary,
  parseHunks,
  parseNameStatus,
  parseNumstat,
  type FileStatusRecord,
} from "./parse";
import {
  contentSizeFor,
  objectFormat,
  resolveBlobInfo,
  type BlobRequest,
} from "./objects";
import {
  diffFor,
  newRevision,
  oldRevision,
  pairedRenameDiff,
  rangeArgs,
  reviewContentHash,
} from "./file-diff";
import { isImagePath } from "./images";
import type { ChangeFile } from "../../shared/types";
import type { ChangeFileOptions, DiffRange } from "./types";


export const LARGE_DIFF_LINE_LIMIT = 1500;

/** How many per-file git diffs may run at once while building a Change Set. */
export const FILE_DIFF_CONCURRENCY = 8;

/**
 * Resolve every changed file's per-file git work with at most
 * `FILE_DIFF_CONCURRENCY` diffs in flight.
 */
async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  limit: number,
  run: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= items.length) {
        return;
      }
      results[index] = await run(items[index] as Item, index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

interface PreparedChangeFile {
  readonly record: FileStatusRecord;
  readonly diff: string;
  readonly binary: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly modeChange: ReturnType<typeof parseModeChange>;
  readonly oldRev: string | undefined;
  readonly newRev: string | undefined;
  readonly collapsed: boolean;
}

function contentHashRevision(
  range: DiffRange,
  record: FileStatusRecord,
): string | null {
  if (record.status === "deleted") {
    return range.baseRef;
  }
  return range.targetRef ?? null;
}

export async function buildChangeFiles(
  git: GitGateway,
  range: DiffRange,
  records: readonly FileStatusRecord[],
  options: ChangeFileOptions = {},
): Promise<ChangeFile[]> {
  const { stdout } = await git.run([
    "diff",
    ...rangeArgs(range),
    "--numstat",
    "-z",
    "--find-renames",
  ]);
  const numstat = parseNumstat(stdout.toString("utf8"));
  const format = await objectFormat(git);
  const threshold = options.largeDiffThreshold ?? LARGE_DIFF_LINE_LIMIT;

  const prepared = await mapWithConcurrency(
    records,
    FILE_DIFF_CONCURRENCY,
    async (record): Promise<PreparedChangeFile> => {
      const paired = record.pairedRename
        ? await pairedRenameDiff(git, record, options)
        : null;
      const diff = paired
        ? paired.diff
        : await diffFor(git, range, record, options);
      const stats = numstat.get(record.path);
      const fallback = countDiffLines(diff);
      const binary = paired
        ? paired.binary
        : (stats?.binary ?? looksBinary(diff));
      const additions = binary ? 0 : (stats?.additions ?? fallback.additions);
      const deletions = binary ? 0 : (stats?.deletions ?? fallback.deletions);
      const oldRev = oldRevision(range, record);
      const newRev = newRevision(range, record);
      const collapsed =
        !binary &&
        !options.includeLargeDiffs &&
        additions + deletions > threshold;

      return {
        record,
        diff,
        binary,
        additions,
        deletions,
        modeChange: parseModeChange(diff),
        oldRev,
        newRev,
        collapsed,
      };
    },
  );

  const blobRequests: BlobRequest[] = [];
  for (const item of prepared) {
    const hashRev = contentHashRevision(range, item.record);
    if (hashRev) {
      blobRequests.push({ rev: hashRev, path: item.record.path });
    }
    if (!item.binary) {
      continue;
    }
    const oldPath = item.record.oldPath ?? item.record.path;
    if (
      item.oldRev &&
      item.oldRev !== "index" &&
      item.oldRev !== "worktree" &&
      isSafeRelativePath(oldPath)
    ) {
      blobRequests.push({ rev: item.oldRev, path: oldPath });
    }
    if (
      item.newRev &&
      item.newRev !== "index" &&
      item.newRev !== "worktree" &&
      isSafeRelativePath(item.record.path)
    ) {
      blobRequests.push({ rev: item.newRev, path: item.record.path });
    }
  }
  const blobs = await resolveBlobInfo(git, blobRequests);

  const files: ChangeFile[] = [];
  for (const item of prepared) {
    const {
      record,
      diff,
      binary,
      additions,
      deletions,
      modeChange,
      oldRev,
      newRev,
      collapsed,
    } = item;

    let oldSize: number | undefined;
    let newSize: number | undefined;
    if (binary) {
      if (oldRev) {
        const size = await contentSizeFor(
          git,
          oldRev,
          record.oldPath ?? record.path,
          blobs,
        );
        if (size !== null) {
          oldSize = size;
        }
      }
      if (newRev) {
        const size = await contentSizeFor(git, newRev, record.path, blobs);
        if (size !== null) {
          newSize = size;
        }
      }
    }

    files.push({
      path: record.path,
      ...(record.oldPath ? { oldPath: record.oldPath } : {}),
      status: record.status,
      additions,
      deletions,
      binary,
      image: isImagePath(record.path),
      diff: collapsed ? "" : diff,
      hunks: binary || collapsed ? [] : parseHunks(diff),
      contentHash: await reviewContentHash(
        git,
        range,
        record,
        diff,
        format,
        blobs,
      ),
      ...(oldSize !== undefined ? { oldSize } : {}),
      ...(newSize !== undefined ? { newSize } : {}),
      ...(modeChange
        ? { oldMode: modeChange.oldMode, newMode: modeChange.newMode }
        : {}),
      ...(oldRev ? { oldRev } : {}),
      ...(newRev ? { newRev } : {}),
      ...(collapsed ? { collapsed: true } : {}),
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function listChangeRecords(
  git: GitGateway,
  range: DiffRange,
): Promise<FileStatusRecord[]> {
  const nameStatusOutput = await git.text([
    "diff",
    ...rangeArgs(range),
    "--name-status",
    "-z",
    "--find-renames",
    "--no-color",
    "--no-ext-diff",
  ]);

  return parseNameStatus(nameStatusOutput);
}

export async function buildChangeFilesForRange(
  git: GitGateway,
  range: DiffRange,
  options: ChangeFileOptions = {},
): Promise<ChangeFile[]> {
  return buildChangeFiles(
    git,
    range,
    await listChangeRecords(git, range),
    options,
  );
}
