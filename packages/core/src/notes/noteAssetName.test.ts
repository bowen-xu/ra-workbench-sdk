import { expect, it } from "vitest";
import { noteImageDisplayName } from "./index";

it.each([
  ["image/png", "png"], ["image/jpeg", "jpg"], ["image/gif", "gif"], ["image/webp", "webp"],
  ["image/svg+xml", "svg"], ["image/avif", "avif"], ["image/apng", "apng"], ["image/bmp", "bmp"],
  ["image/tiff", "tiff"], ["image/x-icon", "ico"], ["image/vnd.microsoft.icon", "ico"],
  ["image/heic", "heic"], ["image/heif", "heif"], ["image/jxl", "jxl"], ["IMAGE/JPEG; charset=binary", "jpg"],
  ["image/future-format", "bin"],
])("names %s by asset identity with its %s extension", (mimeType, extension) => {
  expect(noteImageDisplayName("asset-id", mimeType)).toBe(`asset-id.${extension}`);
});

it.each(["text/plain", "application/pdf", "application/octet-stream", ""])("leaves %s attachment naming to its owner", mimeType => {
  expect(noteImageDisplayName("asset-id", mimeType)).toBeUndefined();
});
