import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import type { MediaResult, MediaResults } from "@capacitor/camera";
import {
  acquireNativePhoto,
  prepareNativePhoto,
  preparePhoto,
} from "../services/photos";
import type { PhotoSource, PreparedPhoto } from "../services/photos";
import { photoErrorMessage } from "../services/photoValidation";

export function usePhotoCapture() {
  const [photo, setPhoto] = useState<(PreparedPhoto & { url: string }) | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const processing = useRef(false);
  const alive = useRef(false);
  const previewUrl = useRef<string | null>(null);
  const navigate = useNavigate();

  const replacePhoto = useCallback((prepared: PreparedPhoto) => {
    // Account change can unmount this hook while the OS/file decoder is working.
    if (!alive.current) return;
    const url = URL.createObjectURL(prepared.blob);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = url;
    setPhoto({ ...prepared, url });
  }, []);

  async function run(operation: () => Promise<PreparedPhoto>) {
    if (processing.current) return;
    processing.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      replacePhoto(await operation());
    } catch (reason) {
      if (!alive.current) return;
      const message = photoErrorMessage(reason);
      setError(message);
      if (!message) setNotice("Fotoğraf seçimi iptal edildi.");
    } finally {
      processing.current = false;
      if (alive.current) setBusy(false);
    }
  }

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    const listener = NativeApp.addListener(
      "appRestoredResult",
      async (result) => {
        if (disposed || result.pluginId !== "Camera") return;
        navigate("/tara", { replace: true });
        setError(null);
        setNotice(null);
        if (!result.success) {
          setError(photoErrorMessage(result.error));
          return;
        }
        setBusy(true);
        processing.current = true;
        try {
          const data = result.data as MediaResult | MediaResults;
          const media = "results" in data ? data.results[0] : data;
          if (!media)
            throw new Error("Fotoğraf dosyası okunamıyor. Yeniden seç.");
          const prepared = await prepareNativePhoto(media);
          if (!disposed) replacePhoto(prepared);
        } catch (reason) {
          if (!disposed) setError(photoErrorMessage(reason));
        } finally {
          if (!disposed) {
            setBusy(false);
            processing.current = false;
          }
        }
      },
    );
    void listener.catch(() => {
      if (!disposed)
        setError(
          "Fotoğraf kurtarma özelliği başlatılamadı. Uygulamayı yeniden aç.",
        );
    });
    return () => {
      disposed = true;
      void listener.then((handle) => handle.remove()).catch(() => {});
    };
  }, [navigate, replacePhoto]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  return {
    photo,
    busy,
    error,
    notice,
    native: Capacitor.isNativePlatform(),
    capture: (source: PhotoSource) =>
      run(async () => prepareNativePhoto(await acquireNativePhoto(source))),
    selectFile: (file: File) => run(() => preparePhoto(file)),
    remove: () => {
      if (processing.current) return;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
      setPhoto(null);
      setError(null);
      setNotice("Fotoğraf kaldırıldı.");
    },
  };
}
export type PhotoCapture = ReturnType<typeof usePhotoCapture>;
