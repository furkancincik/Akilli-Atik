export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 1600;
export const MAX_PIXELS = 64_000_000;

export function validatePhotoSize(size: number) {
  if (!Number.isFinite(size) || size <= 0)
    throw new Error("Fotoğraf dosyası boş veya okunamıyor.");
  if (size > MAX_INPUT_BYTES)
    throw new Error(
      "Fotoğraf 20 MB sınırını aşıyor. Daha küçük bir fotoğraf seç.",
    );
}

export function detectPhotoType(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return "image/png";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new Error("Desteklenmeyen dosya. JPG, PNG veya WebP fotoğraf seç.");
}

export function scaledDimensions(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > MAX_PIXELS
  )
    throw new Error(
      "Fotoğrafın çözünürlüğü desteklenmiyor. Daha küçük bir fotoğraf seç.",
    );
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function photoErrorMessage(error: unknown): string | null {
  const details =
    error && typeof error === "object"
      ? (error as { code?: unknown; message?: unknown })
      : {};
  const code = String(details.code ?? "");
  const message = typeof details.message === "string" ? details.message : "";
  if (
    code === "OS-PLUG-CAMR-0006" ||
    /cancel|canceled|cancelled|iptal|no image picked|no photos selected/i.test(
      message,
    )
  )
    return null;
  if (
    ["OS-PLUG-CAMR-0003", "OS-PLUG-CAMR-0005"].includes(code) ||
    /permission|denied|notallowed/i.test(message)
  )
    return "Kamera veya fotoğraf erişimine izin verilmedi. Telefon Ayarları → Uygulamalar → Akıllı Atık → İzinler bölümünü kontrol edip tekrar dene.";
  if (code === "OS-PLUG-CAMR-0007" || /no camera|notfound/i.test(message))
    return "Kamera bulunamadı. Galeriden bir fotoğraf seçebilirsin.";
  if (
    error instanceof Error &&
    /^(Fotoğraf|Desteklenmeyen|Görüntü)/.test(message)
  )
    return message;
  return "Fotoğraf alınamadı veya okunamadı. Tekrar dene ya da başka bir fotoğraf seç.";
}
