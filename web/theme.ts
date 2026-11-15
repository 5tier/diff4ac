import type { Theme } from "../shared/types";
import { isTheme } from "../shared/theme";

export const THEME_STORAGE_KEY = "diff4ac-theme";

export function nextTheme(theme: Theme): Theme {
  if (theme === "system") {
    return "light";
  }
  return theme === "light" ? "dark" : "system";
}

export function readThemePreference(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function readStoredTheme(): Theme {
  return readThemePreference() ?? "system";
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable; the theme still applies for this page.
  }
}

export function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

export function effectiveTheme(theme: Theme): "light" | "dark" {
  return theme === "system" ? (prefersDark() ? "dark" : "light") : theme;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute("content", effectiveTheme(theme));
  }
}

export function watchSystemTheme(onChange: () => void): () => void {
  try {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}
