export type ImageMediaType = "image/jpeg" | "image/png";

export const MAX_IMAGE_EDGE = 1568;

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
      0.92,
    );
  });
}

export async function downscaleImage(
  file: File,
  mediaType: ImageMediaType,
): Promise<string> {
  const sourceUrl = await fileToDataUrl(file);
  const image = await loadImage(sourceUrl);

  const longEdge = Math.max(image.width, image.height);
  const scale = longEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longEdge : 1;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_context_failed");

  context.drawImage(image, 0, 0, width, height);
  const resizedDataUrl = await canvasToDataUrl(canvas, mediaType);
  const commaIndex = resizedDataUrl.indexOf(",");
  return commaIndex >= 0 ? resizedDataUrl.slice(commaIndex + 1) : resizedDataUrl;
}

export function detectMediaType(file: File): ImageMediaType | null {
  return file.type === "image/png" || file.type === "image/jpeg" ? file.type : null;
}
