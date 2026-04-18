/**
 * Client-side background removal using @imgly/background-removal.
 * The ONNX model (~40MB) is lazy-loaded from CDN and cached by the browser.
 */

let removeBackgroundFn: ((src: Blob) => Promise<Blob>) | null = null;

async function loadLibrary(): Promise<(src: Blob) => Promise<Blob>> {
  if (removeBackgroundFn) return removeBackgroundFn;
  const { removeBackground } = await import('@imgly/background-removal');
  removeBackgroundFn = (src: Blob) =>
    removeBackground(src, { output: { format: 'image/png', quality: 1 } });
  return removeBackgroundFn;
}

/**
 * Remove the background from a photo, returning a transparent PNG blob.
 * The first call downloads the model (~40MB, cached by the browser).
 */
export async function removePhotoBackground(source: Blob): Promise<Blob> {
  const fn = await loadLibrary();
  return fn(source);
}
