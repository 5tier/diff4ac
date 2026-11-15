import type { Theme } from "./types";

const THEMES: readonly Theme[] = ["system", "light", "dark"];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && THEMES.includes(value as Theme);
}
