export function extensionOf(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot).toLowerCase();
}

export function isSafeRelativePath(path: string): boolean {
  if (
    !path ||
    /[\x00-\x1f\x7f]/.test(path) ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    return false;
  }
  return !path.split("/").some((segment) => segment === ".." || segment === ".");
}

/**
 * Conservative branch-name check close to `git check-ref-format --branch`.
 * It is intentionally stricter than git in a few places; diff4ac only reads.
 */
export function isValidBranchName(name: string): boolean {
  if (!name) {
    return false;
  }
  if (
    name.startsWith("-") ||
    name.startsWith("/") ||
    name.endsWith("/") ||
    name.endsWith(".") ||
    name.endsWith(".lock")
  ) {
    return false;
  }
  if (/[\x00-\x20\x7f~^:?*\[\\]/.test(name)) {
    return false;
  }
  if (name.includes("..") || name.includes("@{") || name.includes("//")) {
    return false;
  }
  return true;
}
