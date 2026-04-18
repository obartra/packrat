/**
 * Shared image-processing utility. Kept free of Firebase/DOM-heavy
 * dependencies so both photos.ts and inference.ts can import it.
 */

/** Read a Blob/File, resize to fit within `maxSize` px, and return the canvas. */
export function resizeToCanvas(file: Blob, maxSize: number): Promise<HTMLCanvasElement> {
  return new Promise<HTMLCanvasElement>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target?.result;
      if (typeof result !== 'string') {
        reject(new Error('read failed'));
        return;
      }
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxSize || h > maxSize) {
          if (w >= h) {
            h = Math.round((h * maxSize) / w);
            w = maxSize;
          } else {
            w = Math.round((w * maxSize) / h);
            h = maxSize;
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
        resolve(canvas);
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = result;
    };
    reader.onerror = () => reject(new Error('file read failed'));
    reader.readAsDataURL(file);
  });
}

/** Resize a blob to fit within maxSize px (no upscale) and return as PNG. */
export async function resizeBlobPng(blob: Blob, maxSize: number): Promise<Blob> {
  const canvas = await resizeToCanvas(blob, maxSize);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('PNG blob creation failed'))),
      'image/png',
    );
  });
}

/** Generate a small JPEG data URL for inline thumbnails (~2-3KB). */
export async function generateThumbDataUrl(
  source: Blob,
  size = 80,
  format: 'image/jpeg' | 'image/png' = 'image/jpeg',
  quality = 0.4,
): Promise<string> {
  const canvas = await resizeToCanvas(source, size);
  return format === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);
}
