'use server';

import { processDeliveryProofFromFormData } from '@/lib/processDeliveryProofFromFormData';

export async function processDeliveryProof(formData: FormData) {
    return processDeliveryProofFromFormData(formData);
}
