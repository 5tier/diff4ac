import type { ChangeSetScope } from "../changeset/scope";
import {
  isValidGlob,
  type FilterSettings,
} from "../filters";
import { isSafeRelativePath } from "../paths";
import {
  isTimeWindowPreset,
  parseTimeWindowInstant,
  timeWindowLabel,
} from "../../shared/time-windows";
import type {
  ChangeViewMode,
  SnapshotSide,
  TimeWindow,
} from "../../shared/types";

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly message: string };

function fail<T>(message: string, status = 400): ParseResult<T> {
  return { ok: false, status, message };
}

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

const COMMIT_HASH = /^[0-9a-fA-F]{4,64}$/;

export function isValidCommitHash(value: string | null): value is string {
  return value !== null && COMMIT_HASH.test(value);
}

export function isValidContentRev(value: string | null): value is string {
  return (
    value === "index" || value === "worktree" || isValidCommitHash(value)
  );
}

export function parseCommitHash(
  value: string | null,
): ParseResult<string> {
  return isValidCommitHash(value)
    ? ok(value)
    : fail("Bad request: a commit hash is required");
}

const COMMITS_REQUIRED =
  "Bad request: commit hashes and a mode of net or stack are required";

export function parseChangeViewMode(
  value: string | null,
): ParseResult<ChangeViewMode> {
  const mode = value ?? "net";
  return mode === "net" || mode === "stack"
    ? ok(mode)
    : fail(COMMITS_REQUIRED);
}

export function parseCommitScope(
  url: URL,
): ParseResult<Extract<ChangeSetScope, { kind: "commit" }>> {
  const hash = parseCommitHash(url.searchParams.get("hash"));
  return hash.ok
    ? ok({ kind: "commit", hash: hash.value })
    : fail(hash.message, hash.status);
}

export function parseCommitsScope(
  url: URL,
): ParseResult<Extract<ChangeSetScope, { kind: "commits" }>> {
  const hashes = (url.searchParams.get("hashes") ?? "")
    .split(",")
    .filter(Boolean);
  const mode = parseChangeViewMode(url.searchParams.get("mode"));

  if (
    hashes.length === 0 ||
    !hashes.every((hash) => isValidCommitHash(hash)) ||
    !mode.ok
  ) {
    return fail(COMMITS_REQUIRED);
  }

  return ok({ kind: "commits", hashes, mode: mode.value });
}

export function parseTimeWindowRequest(
  url: URL,
): ParseResult<TimeWindow> {
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";
  const preset = url.searchParams.get("preset") ?? "";
  const startMs = parseTimeWindowInstant(start);
  const endMs = parseTimeWindowInstant(end);

  if (
    startMs === null ||
    endMs === null ||
    startMs >= endMs ||
    !isTimeWindowPreset(preset)
  ) {
    return fail("Bad request: start, end and a preset are required");
  }

  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();
  return ok({
    preset,
    start: startIso,
    end: endIso,
    label: timeWindowLabel(preset, startIso, endIso),
  });
}

export function parseTimeWindowMode(
  value: string | null,
): ParseResult<ChangeViewMode | "auto"> {
  const mode = value ?? "auto";
  return mode === "auto" || mode === "net" || mode === "stack"
    ? ok(mode)
    : fail("Bad request: mode must be auto, net or stack");
}

export function parseTimeWindowScope(
  url: URL,
): ParseResult<Extract<ChangeSetScope, { kind: "time-window" }>> {
  const window = parseTimeWindowRequest(url);
  if (!window.ok) {
    return fail(window.message, window.status);
  }

  const mode = parseTimeWindowMode(url.searchParams.get("mode"));
  if (!mode.ok) {
    return fail(mode.message, mode.status);
  }

  const agent = url.searchParams.get("agent") ?? undefined;
  return ok({
    kind: "time-window",
    window: window.value,
    mode: mode.value,
    ...(agent ? { agent } : {}),
  });
}

export function parseBranchScope(
  url: URL,
): ParseResult<Extract<ChangeSetScope, { kind: "branch" }>> {
  const name = url.searchParams.get("name");
  return name
    ? ok({ kind: "branch", name })
    : fail("Bad request: a branch name is required");
}

export function parseSnapshotSide(url: URL): ParseResult<SnapshotSide> {
  const side = url.searchParams.get("side");
  return side === "after" || side === "before"
    ? ok(side)
    : fail("Bad request: side must be after or before");
}

function parseSnapshotDir(url: URL): ParseResult<string> {
  const raw = url.searchParams.get("dir");
  if (raw === null || raw === "") {
    return ok("");
  }
  if (!isSafeRelativePath(raw)) {
    return fail("Bad request: a safe directory path is required");
  }
  return ok(raw.replace(/\/+$/, ""));
}

function parseSnapshotPath(url: URL): ParseResult<string> {
  const path = url.searchParams.get("path");
  if (!path || !isSafeRelativePath(path)) {
    return fail("Bad request: a safe file path is required");
  }
  return ok(path);
}

function parseSnapshotFull(url: URL): ParseResult<boolean> {
  const full = url.searchParams.get("full");
  if (full === null || full === "0") {
    return ok(false);
  }
  return full === "1"
    ? ok(true)
    : fail("Bad request: full must be 1");
}

export interface SnapshotBaseRequest {
  readonly scope: ChangeSetScope;
  readonly side: SnapshotSide;
}

function parseSnapshotBase(url: URL): ParseResult<SnapshotBaseRequest> {
  const scope = parseScope(url);
  if (!scope.ok) {
    return scope;
  }
  const side = parseSnapshotSide(url);
  return side.ok ? ok({ scope: scope.value, side: side.value }) : side;
}

export interface SnapshotTreeRequest extends SnapshotBaseRequest {
  readonly dir: string;
}

export function parseSnapshotTreeRequest(
  url: URL,
): ParseResult<SnapshotTreeRequest> {
  const base = parseSnapshotBase(url);
  if (!base.ok) {
    return base;
  }
  const dir = parseSnapshotDir(url);
  return dir.ok
    ? ok({ ...base.value, dir: dir.value })
    : dir;
}

export interface SnapshotFileRequest extends SnapshotBaseRequest {
  readonly path: string;
  readonly full: boolean;
}

export function parseSnapshotFileRequest(
  url: URL,
): ParseResult<SnapshotFileRequest> {
  const base = parseSnapshotBase(url);
  if (!base.ok) {
    return base;
  }
  const path = parseSnapshotPath(url);
  if (!path.ok) {
    return path;
  }
  const full = parseSnapshotFull(url);
  return full.ok
    ? ok({ ...base.value, path: path.value, full: full.value })
    : full;
}

export interface SnapshotRawRequest extends SnapshotBaseRequest {
  readonly path: string;
}

export function parseSnapshotRawRequest(
  url: URL,
): ParseResult<SnapshotRawRequest> {
  const base = parseSnapshotBase(url);
  if (!base.ok) {
    return base;
  }
  const path = parseSnapshotPath(url);
  return path.ok ? ok({ ...base.value, path: path.value }) : path;
}

export interface SnapshotPathsRequest extends SnapshotBaseRequest {
  readonly query: string;
  readonly limit: number;
}

export function parseSnapshotPathsRequest(
  url: URL,
): ParseResult<SnapshotPathsRequest> {
  const base = parseSnapshotBase(url);
  if (!base.ok) {
    return base;
  }

  const query = url.searchParams.get("q") ?? "";
  if (query.length > 256) {
    return fail("Bad request: q must be at most 256 characters");
  }

  const rawLimit = url.searchParams.get("limit");
  let limit = 50;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      return fail("Bad request: limit must be between 1 and 200");
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      return fail("Bad request: limit must be between 1 and 200");
    }
  }

  return ok({ ...base.value, query, limit });
}

export function parseCommitSkip(url: URL): ParseResult<number> {
  const raw = url.searchParams.get("skip");
  if (raw === null) {
    return ok(0);
  }
  if (!/^\d+$/.test(raw) || raw.length > 15) {
    return fail("Bad request: skip must be a non-negative integer");
  }
  const skip = Number(raw);
  return Number.isSafeInteger(skip)
    ? ok(skip)
    : fail("Bad request: skip must be a non-negative integer");
}

export function parseScope(url: URL): ParseResult<ChangeSetScope> {
  const selection = url.searchParams.get("selection");
  if (!selection) {
    return fail("Bad request: a Selection is required");
  }

  switch (selection) {
    case "pending":
      return ok({ kind: "pending" });
    case "commit":
      return parseCommitScope(url);
    case "commits":
      return parseCommitsScope(url);
    case "time-window":
      return parseTimeWindowScope(url);
    case "branch":
      return parseBranchScope(url);
    default:
      return fail("Bad request: unknown Selection");
  }
}

export function parseFilterSettings(
  url: URL,
  noisePatterns: readonly string[],
): ParseResult<FilterSettings> {
  const disabledExtensions = url.searchParams
    .getAll("ext")
    .map((extension) => extension.trim().toLowerCase());
  if (
    !disabledExtensions.every(
      (extension) =>
        extension === "" ||
        (extension.startsWith(".") &&
          extension.length <= 64 &&
          !/[/\\\0\r\n]/.test(extension)),
    )
  ) {
    return fail("Bad request: invalid filter");
  }

  const parseGlobs = (name: string) =>
    url.searchParams
      .getAll(name)
      .map((pattern) => pattern.trim())
      .filter(Boolean);
  const includeGlobs = parseGlobs("include");
  const excludeGlobs = parseGlobs("exclude");

  if (
    !includeGlobs.every(isValidGlob) ||
    !excludeGlobs.every(isValidGlob)
  ) {
    return fail("Bad request: invalid filter");
  }

  return ok({
    disabledExtensions,
    includeGlobs,
    excludeGlobs,
    hideNoise: url.searchParams.get("noise") !== "0",
    noisePatterns,
  });
}

/** `context=full` asks for whole files instead of changed hunks only. */
export function wantsFullContext(url: URL): boolean {
  return url.searchParams.get("context") === "full";
}

const FILE_PARAMS_REQUIRED = "Bad request: a safe path and rev are required";

export interface FileDiffRequest {
  readonly path: string;
  readonly rev: string | null;
}

export interface FileContentRequest {
  readonly path: string;
  readonly rev: string;
}

export function parseFileDiffRequest(url: URL): ParseResult<FileDiffRequest> {
  const path = url.searchParams.get("path");
  const rev = url.searchParams.get("rev");

  if (!path || !isSafeRelativePath(path)) {
    return fail(FILE_PARAMS_REQUIRED);
  }
  if (rev !== null && !isValidContentRev(rev)) {
    return fail(FILE_PARAMS_REQUIRED);
  }
  return ok({ path, rev });
}

export function parseFileContentRequest(
  url: URL,
): ParseResult<FileContentRequest> {
  const path = url.searchParams.get("path");
  const rev = url.searchParams.get("rev");

  if (!path || !isSafeRelativePath(path)) {
    return fail(FILE_PARAMS_REQUIRED);
  }
  if (rev === null || !isValidContentRev(rev)) {
    return fail(FILE_PARAMS_REQUIRED);
  }
  return ok({ path, rev });
}
