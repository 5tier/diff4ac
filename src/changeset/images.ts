import { extensionOf } from "../paths";

const IMAGE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function imageContentType(path: string): string | null {
  return IMAGE_CONTENT_TYPES[extensionOf(path)] ?? null;
}

export function isImagePath(path: string): boolean {
  return imageContentType(path) !== null;
}
