'use server';

/** Demo shim for `@/app/delivery/actions` — gallery upload succeeds without storage */
export async function processDeliveryProof(_formData: FormData) {
  return { success: true as const };
}
