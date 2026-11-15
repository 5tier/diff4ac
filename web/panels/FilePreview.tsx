import type { ChangeFile } from "../../shared/types";
import { fileContentUrl, type FileRequestContext } from "../api";

function formatBytes(size: number | undefined): string {
  if (size === undefined) {
    return "unknown size";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function binarySummary(file: ChangeFile): string {
  if (file.status === "added") {
    return `Binary file added · ${formatBytes(file.newSize)}`;
  }
  if (file.status === "deleted") {
    return `Binary file deleted · ${formatBytes(file.oldSize)}`;
  }
  return `Binary file changed · old ${formatBytes(
    file.oldSize,
  )} → new ${formatBytes(file.newSize)}`;
}

export function ImagePreview({
  file,
  fileKey,
  context,
}: {
  readonly file: ChangeFile;
  readonly fileKey: string;
  readonly context: FileRequestContext;
}) {
  const before = file.oldRev
    ? fileContentUrl(context, file.path, file.oldRev)
    : null;
  const after = file.newRev
    ? fileContentUrl(context, file.path, file.newRev)
    : null;

  if (!before && !after) {
    return null;
  }

  return (
    <div
      className="image-preview"
      data-testid="image-preview"
      data-layout-block="file-image"
      data-file-key={fileKey}
    >
      {before ? (
        <figure className="image-preview-side">
          <figcaption>Before · {file.oldPath ?? file.path}</figcaption>
          <img
            src={before}
            alt={`${file.oldPath ?? file.path} before`}
            loading="lazy"
          />
        </figure>
      ) : null}
      {after ? (
        <figure className="image-preview-side">
          <figcaption>After · {file.path}</figcaption>
          <img src={after} alt={`${file.path} after`} loading="lazy" />
        </figure>
      ) : null}
    </div>
  );
}

