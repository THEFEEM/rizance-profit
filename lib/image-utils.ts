export type ImageMediaType = "image/jpeg" | "image/png";

export const MAX_IMAGE_EDGE = 1568;
const THUMB_MAX_EDGE = 200;
const THUMB_QUALITY = 0.6;

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image_load_failed"));
    image.src = src;
  });
}

export function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  mediaType: ImageMediaType,
  quality = 0.92,
): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("canvas_blob_failed"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("blob_read_failed"));
        reader.readAsDataURL(blob);
      },
      mediaType,
      quality,
    );
  });
}

async function resizeImageFile(
  file: File,
  mediaType: ImageMediaType,
  maxEdge: number,
  quality: number,
): Promise<string> {
  const sourceUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceUrl);

  const longEdge = Math.max(image.width, image.height);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_context_failed");

  context.drawImage(image, 0, 0, width, height);
  const resizedDataUrl = await canvasToDataUrl(canvas, mediaType, quality);
  const commaIndex = resizedDataUrl.indexOf(",");
  return commaIndex >= 0 ? resizedDataUrl.slice(commaIndex + 1) : resizedDataUrl;
}

export async function downscaleImage(
  file: File,
  mediaType: ImageMediaType,
): Promise<string> {
  return resizeImageFile(file, mediaType, MAX_IMAGE_EDGE, 0.92);
}

export async function generateThumbnail(
  file: File,
  mediaType: ImageMediaType,
): Promise<string> {
  return resizeImageFile(file, mediaType, THUMB_MAX_EDGE, THUMB_QUALITY);
}

export function detectMediaType(file: File): ImageMediaType | null {
  return file.type === "image/png" || file.type === "image/jpeg" ? file.type : null;
}
