import sharp from 'sharp';
import * as exifr from 'exifr';
import { APP_TIMEZONE } from '@/lib/timezone';

export type StampTimestampResult = {
  buffer: Buffer;
  stampedAtIso: string;
  source: 'exif' | 'upload_time';
};

function formatTimestampForStamp(date: Date): string {
  // Project-wide convention is Eastern time for display.
  return new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZoneName: 'short',
  }).format(date);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function readExifTimestamp(buffer: Buffer): Promise<Date | null> {
  try {
    const data: any = await exifr.parse(buffer, {
      // Try to keep this fast and targeted.
      tiff: true,
      exif: true,
      // Some cameras store timezone offset tags; if present exifr will apply it to Date fields.
      // If not present, Date fields are still useful but represent a "local wall time" without a known timezone.
      translateKeys: false,
    });

    const candidate =
      data?.DateTimeOriginal ??
      data?.CreateDate ??
      data?.ModifyDate ??
      data?.DateTimeDigitized ??
      null;

    if (!candidate) return null;
    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) return candidate;

    // Some EXIF parsers can emit strings like "2026:04:30 09:17:12"
    if (typeof candidate === 'string') {
      const m = candidate.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
      if (m) {
        const [_, y, mo, d, hh, mm, ss] = m;
        const dt = new Date(
          Number(y),
          Number(mo) - 1,
          Number(d),
          Number(hh),
          Number(mm),
          ss ? Number(ss) : 0
        );
        if (!Number.isNaN(dt.getTime())) return dt;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Server-side stamping:
 * - Reads EXIF DateTimeOriginal/CreateDate when available
 * - Falls back to upload time
 * - Draws a bottom-right timestamp pill onto the image
 */
export async function stampTimestampOnImageBuffer(
  input: Buffer,
  mimeType: string,
  uploadTime: Date = new Date()
): Promise<StampTimestampResult> {
  try {
    const exifDate = await readExifTimestamp(input);
    const stampDate = exifDate ?? uploadTime;
    const source: StampTimestampResult['source'] = exifDate ? 'exif' : 'upload_time';
    const stampedAtIso = stampDate.toISOString();

    const image = sharp(input, { failOn: 'none' }).rotate(); // honor orientation if present
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      return { buffer: input, stampedAtIso, source };
    }

    const minDim = Math.min(width, height);
    const fontSize = Math.max(14, Math.min(34, Math.round(minDim * 0.035)));
    const pad = Math.max(10, Math.round(fontSize * 0.75));
    const boxH = Math.round(fontSize * 1.7);

    const text = escapeXml(formatTimestampForStamp(stampDate));

    // Render an overlay across the whole image so we can position precisely.
    // Bottom-right "pill" with right-aligned text.
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <style>
          .ts { font: 600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; fill: rgba(255,255,255,0.95); }
        </style>
        <g>
          <rect
            x="${pad}"
            y="${height - boxH - pad}"
            width="${width - pad * 2}"
            height="${boxH}"
            rx="${Math.round(fontSize * 0.6)}"
            ry="${Math.round(fontSize * 0.6)}"
            fill="rgba(0,0,0,0.55)"
          />
          <text
            class="ts"
            x="${width - pad}"
            y="${height - pad - Math.round(boxH / 2)}"
            text-anchor="end"
            dominant-baseline="middle"
          >${text}</text>
        </g>
      </svg>
    `;

    const composited = image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);

    // Preserve output format for storage.
    const lower = (mimeType || '').toLowerCase();
    if (lower.includes('png')) {
      return { buffer: await composited.png().toBuffer(), stampedAtIso, source };
    }

    // default to JPEG
    return { buffer: await composited.jpeg({ quality: 92 }).toBuffer(), stampedAtIso, source };
  } catch (e) {
    // Never fail the upload path due to stamping.
    return { buffer: input, stampedAtIso: uploadTime.toISOString(), source: 'upload_time' };
  }
}

