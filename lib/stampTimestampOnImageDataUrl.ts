import { formatProofStampText } from '@/lib/formatProofStampText';
import { APP_TIMEZONE } from '@/lib/timezone';

export type StampTimestampOptions = {
  locale?: string;
  /** Defaults to Eastern (app timezone); pass a zone name for local wall time. */
  timeZone?: string;
  /** Override the timestamp text entirely (advanced use). */
  text?: string;
};

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = dataUrl;

  // `decode()` is nicer when available; fall back to onload for Safari edge cases.
  if (typeof img.decode === 'function') {
    await img.decode();
    return img;
  }

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
  });
  return img;
}

function getMimeTypeFromDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  return match?.[1] || 'image/jpeg';
}

/**
 * Stamps a human-readable timestamp onto a base64 data URL image.
 * Intended for client-side usage (camera screenshots) prior to upload.
 */
export async function stampTimestampOnImageDataUrl(
  imageDataUrl: string,
  options: StampTimestampOptions = {}
): Promise<string> {
  try {
    if (typeof document === 'undefined') return imageDataUrl;

    const mimeType = getMimeTypeFromDataUrl(imageDataUrl);
    const img = await loadImage(imageDataUrl);

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return imageDataUrl;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const text =
      options.text ??
      formatProofStampText(new Date(), {
        locale: options.locale,
        timeZone: options.timeZone ?? APP_TIMEZONE,
      });

    // Scale stamp styling based on image size.
    const minDim = Math.min(canvas.width, canvas.height);
    const fontSize = Math.max(14, Math.min(34, Math.round(minDim * 0.035)));
    const pad = Math.max(10, Math.round(fontSize * 0.75));
    const radius = Math.max(8, Math.round(fontSize * 0.5));

    ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
    ctx.textBaseline = 'middle';

    const metrics = ctx.measureText(text);
    const textW = Math.ceil(metrics.width);
    const boxW = textW + pad * 2;
    const boxH = Math.ceil(fontSize * 1.6);

    const x = canvas.width - boxW - pad;
    const y = canvas.height - boxH - pad;

    // Background pill.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    roundRect(ctx, x, y, boxW, boxH, radius);
    ctx.fill();

    // Text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText(text, x + pad, y + boxH / 2);

    // Keep output format stable: JPEG stays JPEG, PNG stays PNG.
    // `toDataURL` quality only applies to image/jpeg and image/webp.
    const quality = mimeType === 'image/jpeg' ? 0.92 : undefined;
    return typeof quality === 'number'
      ? canvas.toDataURL(mimeType, quality)
      : canvas.toDataURL(mimeType);
  } catch (e) {
    console.warn('[proof stamp] Client-side timestamp stamping failed; using original image.', e);
    return imageDataUrl;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

