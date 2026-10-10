import {
  Camera,
  EncodingType,
  MediaType,
  MediaTypeSelection,
} from "@capacitor/camera";
import type { MediaResult } from "@capacitor/camera";
import {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_PHOTO_EDGE,
  detectPhotoType,
  scaledDimensions,
  validatePhotoSize,
} from "./photoValidation";

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
}
export type PhotoSource = "camera" | "gallery";

export async function acquireNativePhoto(
  source: PhotoSource,
): Promise<MediaResult> {
  const options = {
    quality: 85,
    targetWidth: MAX_PHOTO_EDGE,
    targetHeight: MAX_PHOTO_EDGE,
    correctOrientation: true,
    includeMetadata: true,
  };
  if (source === "camera") {
    const permission = await Camera.checkPermissions();
    if (permission.camera === "denied")
      throw new Error("Camera permission denied");
    return Camera.takePhoto({
      ...options,
      encodingType: EncodingType.JPEG,
      saveToGallery: false,
    });
  }
  const result = await Camera.chooseFromGallery({
    ...options,
    mediaType: MediaTypeSelection.Photo,
    allowMultipleSelection: false,
  });
  if (!result.results[0]) throw new Error("No photos selected");
  return result.results[0];
}

export async function prepareNativePhoto(
  result: MediaResult,
): Promise<PreparedPhoto> {
  if (result.type !== MediaType.Photo || !result.webPath)
    throw new Error("Fotoğraf dosyası okunamıyor.");
  if (result.metadata?.size !== undefined)
    validatePhotoSize(result.metadata.size);
  const response = await fetch(result.webPath);
  if (!response.ok)
    throw new Error("Fotoğraf dosyası okunamıyor. Yeniden seç.");
  const length = Number(response.headers.get("Content-Length"));
  if (length > MAX_INPUT_BYTES) validatePhotoSize(length);
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_INPUT_BYTES) {
          await reader.cancel();
          validatePhotoSize(size);
        }
        chunks.push(value.slice().buffer);
      }
    } finally {
      reader.releaseLock();
    }
    return preparePhoto(new Blob(chunks));
  }
  return preparePhoto(await response.blob());
}

export async function preparePhoto(input: Blob): Promise<PreparedPhoto> {
  validatePhotoSize(input.size);
  const mime = detectPhotoType(
    new Uint8Array(await input.slice(0, 12).arrayBuffer()),
  );
  const bitmap = await createImageBitmap(new Blob([input], { type: mime }), {
    imageOrientation: "from-image",
  }).catch(() => {
    throw new Error(
      "Fotoğraf bozuk veya bu cihazda açılamıyor. Başka bir fotoğraf seç.",
    );
  });
  try {
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Görüntü işlenemedi. Yeniden dene.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (output) => {
          if (output) resolve(output);
          else reject(new Error("Görüntü işlenemedi. Yeniden dene."));
        },
        "image/jpeg",
        0.85,
      ),
    );
    if (blob.size > MAX_OUTPUT_BYTES)
      throw new Error(
        "Fotoğraf işlendikten sonra 5 MB sınırını aşıyor. Daha küçük bir fotoğraf seç.",
      );
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}
