import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_INPUT_BYTES,
  detectPhotoType,
  photoErrorMessage,
  scaledDimensions,
  validatePhotoSize,
} from "../src/services/photoValidation.ts";

test("Dosya boyutu: boş, geçersiz ve 20 MB üzerindeki dosyalar reddedilir", () => {
  for (const size of [0, -1, NaN, Infinity, MAX_INPUT_BYTES + 1])
    assert.throws(() => validatePhotoSize(size));
  assert.doesNotThrow(() => validatePhotoSize(MAX_INPUT_BYTES));
});
test("JPEG, PNG ve WebP dosya içeriğinden tanınır; uzantı yeterli değildir", () => {
  assert.equal(detectPhotoType(new Uint8Array([255, 216, 255])), "image/jpeg");
  assert.equal(
    detectPhotoType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/png",
  );
  assert.equal(
    detectPhotoType(new TextEncoder().encode("RIFF0000WEBP")),
    "image/webp",
  );
  assert.throws(() => detectPhotoType(new TextEncoder().encode("<svg></svg>")));
  assert.throws(() => detectPhotoType(new Uint8Array()));
});
test("En uzun kenar 1600 px olur; en-boy oranı korunur, küçük fotoğraf büyütülmez", () => {
  assert.deepEqual(scaledDimensions(4000, 2000), { width: 1600, height: 800 });
  assert.deepEqual(scaledDimensions(2000, 4000), { width: 800, height: 1600 });
  assert.deepEqual(scaledDimensions(100, 50), { width: 100, height: 50 });
  assert.deepEqual(scaledDimensions(8000, 8000), { width: 1600, height: 1600 });
  for (const dimensions of [
    [0, 1],
    [Infinity, 1],
    [9000, 9000],
  ])
    assert.throws(() => scaledDimensions(...(dimensions as [number, number])));
});
test("İptal işlemi hata olarak gösterilmez", () => {
  assert.equal(photoErrorMessage({ code: "OS-PLUG-CAMR-0006" }), null);
  assert.equal(photoErrorMessage(new Error("No photos selected")), null);
});
test("İzin reddi ve kamera yokluğu Türkçe eylem önerisi verir", () => {
  assert.match(photoErrorMessage({ code: "OS-PLUG-CAMR-0003" })!, /İzinler/);
  assert.match(photoErrorMessage({ code: "OS-PLUG-CAMR-0005" })!, /İzinler/);
  assert.match(photoErrorMessage({ code: "OS-PLUG-CAMR-0007" })!, /Galeri/);
  assert.match(
    photoErrorMessage(new Error("Permission denied"))!,
    /izin verilmedi/,
  );
});
test("Platform hata ayrıntıları gizlenir; uygulama doğrulama mesajı korunur", () => {
  assert.equal(
    photoErrorMessage(new Error("Fotoğraf bozuk.")),
    "Fotoğraf bozuk.",
  );
  assert.doesNotMatch(
    photoErrorMessage(new Error("internal content://private/path"))!,
    /private/,
  );
});
