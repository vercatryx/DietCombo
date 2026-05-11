import { NextResponse } from 'next/server';
import { processDeliveryProofFromFormData } from '@/lib/processDeliveryProofFromFormData';
import type { ProofUploadFormData } from '@/lib/proof-of-delivery-urls';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const formData = (await request.formData()) as unknown as ProofUploadFormData;
        const result = await processDeliveryProofFromFormData(formData);
        return NextResponse.json(result);
    } catch (e: unknown) {
        console.error('[api/delivery/proof]', e);
        const msg = e instanceof Error ? e.message : 'Upload failed';
        return NextResponse.json({ success: false, error: msg }, { status: 500 });
    }
}
