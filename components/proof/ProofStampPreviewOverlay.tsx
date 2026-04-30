'use client';

import { formatProofStampText } from '@/lib/formatProofStampText';

/**
 * Visual-only overlay for preview: the authoritative stamp is applied on the server
 * when the image is uploaded (see stampTimestampOnImageBuffer).
 */
export function ProofStampPreviewOverlay({ capturedAt }: { capturedAt: Date }) {
  const text = formatProofStampText(capturedAt);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        right: 'max(12px, env(safe-area-inset-right))',
        bottom: 'max(12px, env(safe-area-inset-bottom))',
        maxWidth: 'calc(100% - 24px)',
        padding: '10px 14px',
        borderRadius: 12,
        background: 'rgba(0, 0, 0, 0.55)',
        color: 'rgba(255, 255, 255, 0.95)',
        fontWeight: 600,
        fontSize: 'clamp(13px, 3.2vw, 22px)',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
        lineHeight: 1.35,
        textAlign: 'right',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      {text}
    </div>
  );
}
