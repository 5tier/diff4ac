import type {
  CommitSummary,
  TimeWindow,
  TimeWindowPreset,
} from "./types";

export interface TimeWindowOption {
  readonly preset: TimeWindowPreset;
  readonly label: string;
  readonly description: string;
}

export const TIME_WINDOW_OPTIONS: readonly TimeWindowOption[] = [
  {
    preset: "today",
    label: "Today",
    description: "Commits since local midnight",
  },
  {
    preset: "yesterday",
    label: "Yesterday",
    description: "The whole previous local day",
  },
  {
    preset: "last-24h",
    label: "Last 24h",
    description: "Commits in the last 24 hours",
  },
  {
    preset: "custom",
    label: "Custom range…",
    description: "Choose a start and end date",
  },
];

const PRESET_LABELS: Record<Exclude<TimeWindowPreset, "custom">, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "last-24h": "Last 24h",
};

const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isTimeWindowPreset(value: string): value is TimeWindowPreset {
  return TIME_WINDOW_OPTIONS.some((option) => option.preset === value);
}

export function parseTimeWindowInstant(value: string): number | null {
  if (!ISO_INSTANT.test(value)) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isNaN(millis) ? null : millis;
}

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localDateInputValue(date: Date): string {
  return localDateString(date);
}

export function timeWindowLabel(
  preset: TimeWindowPreset,
  startIso: string,
  endIso: string,
): string {
  if (preset !== "custom") {
    return PRESET_LABELS[preset];
  }

  const start = new Date(startIso);
  const endInclusive = new Date(new Date(endIso).getTime() - 1);
  return `${localDateString(start)} → ${localDateString(endInclusive)}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function createPresetTimeWindow(
  preset: Exclude<TimeWindowPreset, "custom">,
  now: Date = new Date(),
): TimeWindow {
  if (preset === "last-24h") {
    const end = new Date(now);
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return {
      preset,
      start: start.toISOString(),
      end: end.toISOString(),
      label: PRESET_LABELS[preset],
    };
  }

  const today = startOfLocalDay(now);
  const start = preset === "today" ? today : addLocalDays(today, -1);
  const end = preset === "today" ? addLocalDays(today, 1) : today;

  return {
    preset,
    start: start.toISOString(),
    end: end.toISOString(),
    label: PRESET_LABELS[preset],
  };
}

function parseLocalDate(value: string): Date | null {
  const match = LOCAL_DATE.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

export function createCustomTimeWindow(
  startDate: string,
  endDate: string,
): TimeWindow {
  const startDay = parseLocalDate(startDate);
  const endDay = parseLocalDate(endDate);
  if (!startDay || !endDay) {
    throw new Error("Start and end must be valid dates (YYYY-MM-DD)");
  }
  if (endDay.getTime() < startDay.getTime()) {
    throw new Error("Start date must be on or before the end date");
  }

  const start = startOfLocalDay(startDay);
  const end = addLocalDays(startOfLocalDay(endDay), 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  return {
    preset: "custom",
    start: startIso,
    end: endIso,
    label: timeWindowLabel("custom", startIso, endIso),
  };
}

export function isCommitInTimeWindow(
  commit: Pick<CommitSummary, "committedAt">,
  window: Pick<TimeWindow, "start" | "end">,
): boolean {
  const committedAt = Date.parse(commit.committedAt);
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (
    Number.isNaN(committedAt) ||
    Number.isNaN(start) ||
    Number.isNaN(end)
  ) {
    return false;
  }

  return committedAt >= start && committedAt < end;
}

export function filterCommitsInTimeWindow(
  commits: readonly CommitSummary[],
  window: Pick<TimeWindow, "start" | "end">,
): CommitSummary[] {
  return commits.filter((commit) => isCommitInTimeWindow(commit, window));
}
