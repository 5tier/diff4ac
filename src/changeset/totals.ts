import type { ChangeFile, ChangeTotals } from "../../shared/types";

export function changeSetTotals(files: readonly ChangeFile[]): ChangeTotals {
  return files.reduce(
    (sum, file) => ({
      files: sum.files + 1,
      additions: sum.additions + file.additions,
      deletions: sum.deletions + file.deletions,
    }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
