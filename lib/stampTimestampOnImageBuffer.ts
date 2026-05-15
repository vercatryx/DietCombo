import { createRequire } from 'module';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import * as exifr from 'exifr';
import { formatProofStampText } from '@/lib/formatProofStampText';

const require = createRequire(import.meta.url);

const PROOF_STAMP_FAMILY = 'ProofStampInter';

export type StampTimestampResult = {
  buffer: Buffer;
  stampedAtIso: string;
  source: 'exif' | 'upload_time';
  contentType: string;
  fileExtension: string;
};

/** Same fields as used when compositing; shared with async `after()` jobs. */
export type ProofStampMeta = {
  stampDate: Date;
  stampedAtIso: string;
  source: 'exif' | 'upload_time';
};

function stampedOutputMeta(mimeType: string): Pick<StampTimestampResult, 'contentType' | 'fileExtension'> {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('png')) {
    return { contentType: 'image/png', fileExtension: 'png' };
  }
  return { contentType: 'image/jpeg', fileExtension: 'jpg' };
}

function passthroughMeta(mimeType: string): Pick<StampTimestampResult, 'contentType' | 'fileExtension'> {
  const lower = (mimeType || '').toLowerCase();
  if (lower.includes('png')) return { contentType: 'image/png', fileExtension: 'png' };
  if (lower.includes('webp')) return { contentType: 'image/webp', fileExtension: 'webp' };
  if (lower.includes('gif')) return { contentType: 'image/gif', fileExtension: 'gif' };
  if (lower.includes('heic')) return { contentType: 'image/heic', fileExtension: 'heic' };
  if (lower.includes('heif')) return { contentType: 'image/heif', fileExtension: 'heif' };
  return { contentType: 'image/jpeg', fileExtension: 'jpg' };
}

/** Prefer font next to this module, then cwd (Vercel), then @fontsource. */
function interLatin600Woff2Candidates(): string[] {
  const fromModule = join(dirname(fileURLToPath(import.meta.url)), 'fonts', 'inter-latin-600-normal.woff2');
  const out: string[] = [
    fromModule,
    join(process.cwd(), 'lib/fonts/inter-latin-600-normal.woff2'),
  ];
  try {
    const pkgJson = require.resolve('@fontsource/inter/package.json');
    out.push(join(dirname(pkgJson), 'files', 'inter-latin-600-normal.woff2'));
  } catch {
    out.push(join(process.cwd(), 'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2'));
  }
  return out;
}

let proofFontRegistrationAttempted = false;

function proofStampFontFamilyOrFallback(): string {
  if (!proofFontRegistrationAttempted) {
    proofFontRegistrationAttempted = true;
    for (const p of interLatin600Woff2Candidates()) {
      if (!existsSync(p)) continue;
      try {
        GlobalFonts.registerFromPath(p, PROOF_STAMP_FAMILY);
        break;
      } catch (e) {
        console.warn('[proof stamp] GlobalFonts.registerFromPath failed', p, e);
      }
    }
  }
  return GlobalFonts.has(PROOF_STAMP_FAMILY) ? PROOF_STAMP_FAMILY : 'sans-serif';
}

/** Approximate rendered width for the stamped label (layout only). */
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
      tiff: true,
      exif: true,
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

type StampInfo = ProofStampMeta;

/**
 * EXIF capture time (if any) + upload instant metadata for the pill text.
 * Call on the **original** upload bytes before normalizing to JPEG (EXIF may be stripped).
 */
export async function resolveProofStampMeta(
  rawBuffer: Buffer,
  uploadTime: Date = new Date()
): Promise<ProofStampMeta> {
  const exifDate = await readExifTimestamp(rawBuffer);
  const stampDate = exifDate ?? uploadTime;
  return {
    stampDate,
    stampedAtIso: stampDate.toISOString(),
    source: exifDate ? 'exif' : 'upload_time',
  };
}

/**
 * Auto-orient and encode as JPEG for storage + stamping (single Sharp decode path).
 */
export async function normalizeProofImageToJpeg(rawBuffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(rawBuffer, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer();
  } catch {
    return null;
  }
}

/**
 * Skia canvas text + Sharp composite (no librsvg SVG text — reliable on Vercel).
 * `jpegBuffer` must already be oriented (e.g. from `normalizeProofImageToJpeg`).
 */
export async function stampPreparedJpeg(jpegBuffer: Buffer, meta: ProofStampMeta): Promise<Buffer | null> {
  const stampInfo: StampInfo = meta;
  try {
    return await compositeStampOntoJpegBuffer(jpegBuffer, stampInfo);
  } catch (e) {
    console.warn('[proof stamp] stampPreparedJpeg failed', e);
    return null;
  }
}

async function compositeStampOntoJpegBuffer(jpegBuffer: Buffer, stampInfo: StampInfo): Promise<Buffer | null> {
  const { stampDate, stampedAtIso, source } = stampInfo;

  const image = sharp(jpegBuffer, { failOn: 'none' });
  const imageMeta = await image.metadata();
  const width = imageMeta.width ?? 0;
  const height = imageMeta.height ?? 0;
  if (!width || !height) return null;

  const minDim = Math.min(width, height);
  const fontSize = Math.max(14, Math.min(34, Math.round(minDim * 0.035)));
  const pad = Math.max(10, Math.round(fontSize * 0.75));
  const boxH = Math.round(fontSize * 1.7);
  const label = formatProofStampText(stampDate);
  const pillPadX = Math.round(fontSize * 0.65);
  const innerTextW = estimateProofStampTextWidthPx(label, fontSize);
  const pillW = Math.min(width - pad * 2, innerTextW + pillPadX * 2);
  const pillX = width - pad - pillW;
  const pillY = height - boxH - pad;

  const overlay = createCanvas(pillW, boxH);
  const ctx = overlay.getContext('2d');
  const r = Math.round(fontSize * 0.6);
  ctx.beginPath();
  ctx.roundRect(0, 0, pillW, boxH, r);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();

  const family = proofStampFontFamilyOrFallback();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${fontSize}px ${family}`;
  ctx.fillText(label, pillW - pillPadX, boxH / 2);

  const overlayPng = overlay.toBuffer('image/png');

  return await image
    .composite([{ input: overlayPng, left: pillX, top: pillY }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Server-side stamping (synchronous path): read EXIF from original, normalize to JPEG, Skia text pill.
 * Prefer `normalizeProofImageToJpeg` + `stampPreparedJpeg` + `after()` for faster uploads.
 */
export async function stampTimestampOnImageBuffer(
  input: Buffer,
  mimeType: string,
  uploadTime: Date = new Date()
): Promise<StampTimestampResult> {
  const meta = await resolveProofStampMeta(input, uploadTime);
  const { stampedAtIso, source } = meta;

  try {
    const decoded = await normalizeProofImageToJpeg(input);
    if (!decoded) {
      console.warn('[proof stamp] Could not decode to JPEG; uploading original image.', { mimeType });
      return {
        buffer: input,
        stampedAtIso,
        source,
        ...passthroughMeta(mimeType),
      };
    }

    const out = await compositeStampOntoJpegBuffer(decoded, meta);
    if (!out) {
      console.warn('[proof stamp] Composite failed; uploading normalized JPEG without stamp.', { mimeType });
      return {
        buffer: decoded,
        stampedAtIso,
        source,
        contentType: 'image/jpeg',
        fileExtension: 'jpg',
      };
    }

    return {
      buffer: out,
      stampedAtIso,
      source,
      contentType: 'image/jpeg',
      fileExtension: 'jpg',
    };
  } catch (e) {
    console.warn('[proof stamp] Server-side timestamp stamping failed; uploading original image.', {
      mimeType,
      err: e,
    });
    return {
      buffer: input,
      stampedAtIso,
      source,
      ...passthroughMeta(mimeType),
    };
  }
}
