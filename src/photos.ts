import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { storage } from './firebase';
import { $ } from './utils';

export type PendingPhotoValue = File | 'REMOVE' | null;

export interface PendingPhoto {
  file: PendingPhotoValue;
  oldPath: string | null;
}

/** Cross-form state for the photo currently queued for upload in the sheet. */
export const pendingPhoto: PendingPhoto = { file: null, oldPath: null };

export function clearPendingPhoto(): void {
  pendingPhoto.file = null;
  pendingPhoto.oldPath = null;
}

/** Storage path → download URL, populated lazily and held for the session. */
export const photoUrlCache = new Map<string, string>();

/**
 * Resize an image (max 1400px on longest edge) and upload as JPEG @ 0.82.
 * Returns the download URL.
 */
export async function resizeAndUpload(file: File, path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result;
      if (typeof result !== 'string') {
        reject(new Error('read failed'));
        return;
      }
      img.src = result;
      img.onload = () => {
        const MAX = 1400;
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > MAX || h > MAX) {
          if (w >= h) {
            h = Math.round((h * MAX) / w);
            w = MAX;
          } else {
            w = Math.round((w * MAX) / h);
            h = MAX;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('canvas 2d unsupported'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          async blob => {
            if (!blob) {
              reject(new Error('blob creation failed'));
              return;
            }
            try {
              const sRef = storageRef(storage, path);
              await uploadBytes(sRef, blob, { contentType: 'image/jpeg' });
              const url = await getDownloadURL(sRef);
              photoUrlCache.set(path, url);
              resolve(url);
            } catch (err) {
              reject(err);
            }
          },
          'image/jpeg',
          0.82,
        );
      };
      img.onerror = () => reject(new Error('image load failed'));
    };
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Defer loading of the photo until the element enters the viewport,
 * then swap the src and cache the download URL.
 */
export function lazyLoadPhoto(
  el: Element | null | undefined,
  path: string | null | undefined,
): void {
  if (!el || !path) return;
  const imgEl = el as HTMLImageElement;
  const cached = photoUrlCache.get(path);
  if (cached) {
    imgEl.src = cached;
    imgEl.classList.remove('skeleton');
    return;
  }
  imgEl.classList.add('skeleton');
  const obs = new IntersectionObserver(
    async entries => {
      if (!entries[0]?.isIntersecting) return;
      obs.disconnect();
      try {
        const url = await getDownloadURL(storageRef(storage, path));
        photoUrlCache.set(path, url);
        imgEl.src = url;
      } catch (_) {
        imgEl.alt = '⚠';
      }
      imgEl.classList.remove('skeleton');
    },
    { rootMargin: '300px' },
  );
  obs.observe(imgEl);
}

export async function deletePhotoIfExists(path: string | null | undefined): Promise<void> {
  if (!path) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch (_) {
    /* best effort */
  }
  photoUrlCache.delete(path);
}

// ============================================================
//  PHOTO PICKER (camera + library file inputs)
// ============================================================
type PhotoPickerCallback = (file: File) => void;
let photoPickerCallback: PhotoPickerCallback | null = null;

/**
 * Desktop users with a webcam get an in-browser capture UI; touch devices
 * (phones/tablets) keep the native camera app via the file input with
 * `capture="environment"`, which is a much richer experience than a
 * browser <video> element.
 */
function shouldUseWebcam(): boolean {
  if (matchMedia('(pointer: coarse)').matches) return false;
  return !!navigator.mediaDevices?.getUserMedia;
}

export function triggerPhotoPicker(mode: 'camera' | 'library'): void {
  if (mode === 'camera' && shouldUseWebcam()) {
    openWebcamCapture().catch(() => {
      // Permission denied, no camera, or unsupported — fall back to OS picker.
      $<HTMLInputElement>('file-camera').click();
    });
    return;
  }
  $<HTMLInputElement>(mode === 'camera' ? 'file-camera' : 'file-library').click();
}

/**
 * Open a full-screen webcam preview, let the user snap a photo, and
 * hand the resulting File to the active photo-picker callback (same as
 * the file inputs). Resolves once the modal is closed.
 */
async function openWebcamCapture(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });

  const overlay = document.createElement('div');
  overlay.className = 'webcam-overlay';
  overlay.innerHTML = `
    <video autoplay playsinline muted></video>
    <button type="button" class="webcam-cancel" aria-label="Cancel">✕</button>
    <button type="button" class="webcam-snap" aria-label="Take photo"></button>
  `;
  document.body.appendChild(overlay);

  const video = overlay.querySelector('video') as HTMLVideoElement;
  video.srcObject = stream;

  return new Promise<void>(resolve => {
    const cleanup = (): void => {
      stream.getTracks().forEach(t => t.stop());
      overlay.remove();
      resolve();
    };

    overlay.querySelector('.webcam-cancel')!.addEventListener('click', cleanup);

    overlay.querySelector('.webcam-snap')!.addEventListener('click', () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        cleanup();
        return;
      }
      ctx.drawImage(video, 0, 0);
      canvas.toBlob(
        blob => {
          if (blob && photoPickerCallback) {
            const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
            photoPickerCallback(file);
          }
          cleanup();
        },
        'image/jpeg',
        0.92,
      );
    });
  });
}

(['file-camera', 'file-library'] as const).forEach(id => {
  $<HTMLInputElement>(id).addEventListener('change', e => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file && photoPickerCallback) photoPickerCallback(file);
  });
});

/** Register a callback for the next file selected via camera or library. */
export function setupSheetPhotoButtons(getPreviewEl: () => HTMLElement | null): void {
  photoPickerCallback = file => {
    pendingPhoto.file = file;
    const url = URL.createObjectURL(file);
    const prev = getPreviewEl();
    if (prev) {
      prev.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
    }
  };
}
