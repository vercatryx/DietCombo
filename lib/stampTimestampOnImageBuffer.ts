import { readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import * as exifr from 'exifr';
import { formatProofStampText } from '@/lib/formatProofStampText';

export type StampTimestampResult = {
  buffer: Buffer;
  stampedAtIso: string;
  source: 'exif' | 'upload_time';
  /** MIME type of `buffer` bytes (stamped output is always jpeg or png). */
  contentType: string;
  /** Filename suffix without dot (e.g. jpg, png). */
  fileExtension: string;
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Latin 600 — embedded so SVG text renders on hosts without fontconfig (e.g. many serverless images). */
let cachedInterLatin600Woff2Base64: string | null | undefined;

function getProofStampFontFaceCss(): string {
  if (cachedInterLatin600Woff2Base64 === undefined) {
    try {
      const fontPath = join(
        process.cwd(),
        'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2'
      );
      cachedInterLatin600Woff2Base64 = readFileSync(fontPath).toString('base64');
    } catch {
      cachedInterLatin600Woff2Base64 = null;
    }
  }
  if (!cachedInterLatin600Woff2Base64) return '';
  return `@font-face{font-family:'ProofStamp';src:url('data:font/woff2;base64,${cachedInterLatin600Woff2Base64}') format('woff2');font-weight:600;font-style:normal;}`;
}

function stampedOutputMeta(mimeType: string): Pick<StampTimestampResult, 'contentType' | 'fileExtension'> {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('png')) {
    return { contentType: 'image/png', fileExtension: 'png' };
  }
  return { contentType: 'image/jpeg', fileExtension: 'jpg' };
}

/** When we skip stamping and return the original buffer, metadata must match actual bytes. */
function passthroughMeta(mimeType: string): Pick<StampTimestampResult, 'contentType' | 'fileExtension'> {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('png')) return { contentType: 'image/png', fileExtension: 'png' };
  if (lower.includes('webp')) return { contentType: 'image/webp', fileExtension: 'webp' };
  if (lower.includes('gif')) return { contentType: 'image/gif', fileExtension: 'gif' };
  if (lower.includes('heic')) return { contentType: 'image/heic', fileExtension: 'heic' };
  if (lower.includes('heif')) return { contentType: 'image/heif', fileExtension: 'heif' };
  return { contentType: 'image/jpeg', fileExtension: 'jpg' };
}

/** Approximate rendered width for the stamped label (Inter 600; avoids a full-width pill). */
function estimateProofStampTextWidthPx(label: string, fontSize: number): number {
  let em = 0;
  for (const ch of label) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x30 && c <= 0x39) em += 0.5;
    else if (c === 0x20) em += 0.28;
    else if (c === 0x2c || c === 0x2e || c === 0x3a) em += 0.33;
    else if (c < 128) em += 0.58;
    else em += 0.72;
  }
  return Math.ceil(em * fontSize * 1.06);
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

type StampInfo = {
  stampDate: Date;
  stampedAtIso: string;
  source: StampTimestampResult['source'];
};

/**
 * Decode through Sharp once (JPEG out) so metadata/composite works for HEIC, odd JPEGs,
 * and buffers where metadata() reports 0×0 until full decode.
 */
async function decodeForStamping(input: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(input, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch {
    return null;
  }
}

async function stampOntoDecodedBuffer(
  input: Buffer,
  mimeType: string,
  stampInfo: StampInfo,
  triedDecodeFallback: boolean
): Promise<StampTimestampResult | null> {
  const { stampDate, stampedAtIso, source } = stampInfo;

  const image = sharp(input, { failOn: 'none' }).rotate();
  const imageMeta = await image.metadata();
  const width = imageMeta.width ?? 0;
  const height = imageMeta.height ?? 0;

  if (!width || !height) {
    if (!triedDecodeFallback) {
      const decoded = await decodeForStamping(input);
      if (decoded) {
        return stampOntoDecodedBuffer(decoded, 'image/jpeg', stampInfo, true);
      }
    }
    return null;
  }

  const minDim = Math.min(width, height);
  const fontSize = Math.max(14, Math.min(34, Math.round(minDim * 0.035)));
  const pad = Math.max(10, Math.round(fontSize * 0.75));
  const boxH = Math.round(fontSize * 1.7);

  const stampLabelRaw = formatProofStampText(stampDate);
  const text = escapeXml(stampLabelRaw);
  const fontCss = getProofStampFontFaceCss();

  const pillPadX = Math.round(fontSize * 0.65);
  const innerTextW = estimateProofStampTextWidthPx(stampLabelRaw, fontSize);
  const pillW = Math.min(width - pad * 2, innerTextW + pillPadX * 2);
  const pillX = width - pad - pillW;
  const textX = width - pad - pillPadX;

  const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <defs>
          <style type="text/css">
            <![CDATA[
              ${fontCss}
              .proof-stamp-text { font-family: 'ProofStamp', 'DejaVu Sans', sans-serif; }
            ]]>
          </style>
        </defs>
        <g>
          <rect
            x="${pillX}"
            y="${height - boxH - pad}"
            width="${pillW}"
            height="${boxH}"
            rx="${Math.round(fontSize * 0.6)}"
            ry="${Math.round(fontSize * 0.6)}"
            fill="rgba(0,0,0,0.55)"
          />
          <text
            class="proof-stamp-text"
            font-size="${fontSize}"
            font-weight="600"
            fill="rgba(255,255,255,0.95)"
            x="${textX}"
            y="${height - pad - Math.round(boxH / 2)}"
            text-anchor="end"
          ><tspan dy="0.35em">${text}</tspan></text>
        </g>
      </svg>
    `;

  const composited = image.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]);

  const lower = (mimeType || '').toLowerCase();
  const outputMeta = stampedOutputMeta(mimeType);
  if (lower.includes('png')) {
    return {
      buffer: await composited.png().toBuffer(),
      stampedAtIso,
      source,
      ...outputMeta
    };
  }

  return {
    buffer: await composited.jpeg({ quality: 92 }).toBuffer(),
    stampedAtIso,
    source,
    ...outputMeta
  };
}

/**
 * Server-side stamping:
 * - Reads EXIF DateTimeOriginal/CreateDate when available
 * - Falls back to upload time
 * - Draws a bottom-right timestamp pill onto the image
 *
 * Order lifecycle (produce vs delivery) does not matter — all callers share this.
 * If the first pass cannot read dimensions or composite fails, we retry once after
 * decoding to JPEG so gallery/HEIC uploads match webcam JPEG behavior.
 */
export async function stampTimestampOnImageBuffer(
  input: Buffer,
  mimeType: string,
  uploadTime: Date = new Date()
): Promise<StampTimestampResult> {
  const exifDate = await readExifTimestamp(input);
  const stampDate = exifDate ?? uploadTime;
  const source: StampTimestampResult['source'] = exifDate ? 'exif' : 'upload_time';
  const stampedAtIso = stampDate.toISOString();
  const stampInfo: StampInfo = { stampDate, stampedAtIso, source };

  try {
    const ok = await stampOntoDecodedBuffer(input, mimeType, stampInfo, false);
    if (ok) return ok;

    console.warn('[proof stamp] Could not stamp after decode fallback; uploading original image.', {
      mimeType
    });
    return {
      buffer: input,
      stampedAtIso,
      source,
      ...passthroughMeta(mimeType)
    };
  } catch (e) {
    try {
      const decoded = await decodeForStamping(input);
      if (decoded) {
        const retry = await stampOntoDecodedBuffer(decoded, 'image/jpeg', stampInfo, true);
        if (retry) return retry;
      }
    } catch {
      /* fall through */
    }

    console.warn(
      '[proof stamp] Server-side timestamp stamping failed; uploading original image.',
      { mimeType, err: e }
    );
    return {
      buffer: input,
      stampedAtIso,
      source,
      ...passthroughMeta(mimeType)
    };
  }
}

