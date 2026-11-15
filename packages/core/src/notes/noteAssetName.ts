const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/svg+xml": "svg", "image/avif": "avif", "image/apng": "apng", "image/bmp": "bmp", "image/x-ms-bmp": "bmp",
  "image/tiff": "tiff", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/heic": "heic", "image/heif": "heif", "image/jxl": "jxl",
};

/** New image references use content identity rather than a user's source filename.
 * Unknown image MIME types keep their type but use a generic binary extension. */
export function noteImageDisplayName(assetId: string, mimeType: string): string | undefined {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return type.startsWith("image/") ? `${assetId}.${IMAGE_EXTENSIONS[type] ?? "bin"}` : undefined;
}
