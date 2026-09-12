import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X, Check } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { cn } from '@/core/utils';

interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** Fired with the captured photo as a File (image/jpeg). */
  onCapture: (file: File) => void;
}

/**
 * Camera photo capture for chat attachments (Package B).
 * Rear camera preferred (documents/invoices), stream tracks always stopped
 * on close/unmount — a leaked camera session is a privacy bug.
 */
export const CameraCapture = memo(function CameraCapture({ open, onClose, onCapture }: CameraCaptureProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // P3 fix: every preview blob URL must be revoked exactly once. The old
  // code revoked only on the explicit X/confirm/retake paths — the
  // open→false branch and the unmount cleanup dropped the URL without
  // revoking (leaked blob per capture), and re-capture overwrote it.
  const previewRef = useRef<string | null>(null);
  const clearPreview = useCallback(() => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setPreview(null);
  }, []);

  useEffect(() => {
    if (!open) {
      clearPreview();
      setError(null);
      stopStream();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError(t('ai.attach.noCamera'));
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
        }
      } catch {
        if (!cancelled) setError(t('ai.attach.cameraDenied'));
      }
    })();
    return () => {
      cancelled = true;
      stopStream();
      // Unmount while a preview is showing (parent closed us without the
      // X path): revoke here or the blob leaks with no owner left.
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
        previewRef.current = null;
      }
    };
  }, [open, stopStream, t, clearPreview]);

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        // Revoke any previous preview before replacing it (re-capture).
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        const url = URL.createObjectURL(blob);
        previewRef.current = url;
        setPreview(url);
      },
      'image/jpeg',
      0.92,
    );
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    try {
      const res = await fetch(preview);
      const blob = await res.blob();
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
      clearPreview();
      onCapture(file);
      onClose();
    } catch {
      useToastStore.getState().addToast('error', t('ai.attach.unreadable'));
    }
  }, [preview, onCapture, onClose, t, clearPreview]);

  const handleRetake = useCallback(() => {
    clearPreview();
  }, [clearPreview]);

  const handleClose = useCallback(() => {
    clearPreview();
    onClose();
  }, [clearPreview, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-label={t('ai.attach.takePhoto')}
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 p-4 shadow-lift">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 flex items-center gap-2">
            <Camera size={16} />
            {t('ai.attach.takePhoto')}
          </span>
          <button
            onClick={handleClose}
            className="p-2 rounded-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={t('ai.attach.cancel')}
          >
            <X size={16} />
          </button>
        </div>

        {error ? (
          <p className="text-sm text-danger-600 dark:text-danger-400 py-8 text-center">{error}</p>
        ) : preview ? (
          <img src={preview} alt="" className="w-full rounded-xl max-h-[60vh] object-contain bg-black" />
        ) : (
          <video ref={videoRef} playsInline muted className="w-full rounded-xl max-h-[60vh] object-cover bg-black" />
        )}

        {!error && (
          <div className="flex items-center justify-center gap-2 mt-3">
            {preview ? (
              <>
                <button
                  onClick={handleRetake}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-medium',
                    'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  )}
                >
                  <RefreshCw size={15} />
                  {t('ai.attach.retake')}
                </button>
                <button
                  onClick={handleConfirm}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl text-sm font-medium bg-gradient-to-br from-primary-500 to-primary-700 text-white hover:shadow-lift"
                >
                  <Check size={15} />
                  {t('ai.attach.confirmPhoto')}
                </button>
              </>
            ) : (
              <button
                onClick={handleCapture}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-2xl text-sm font-medium bg-gradient-to-br from-primary-500 to-primary-700 text-white hover:shadow-lift"
              >
                <Camera size={15} />
                {t('ai.attach.takePhoto')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
