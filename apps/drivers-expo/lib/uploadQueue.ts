import * as FileSystem from 'expo-file-system/legacy';

import { postDeliveryProof } from '@/lib/api';
import * as Pending from '@/lib/pendingUploadsDb';

function newId(): string {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function queueProofUpload(orderId: string, fileUris: string[]): Promise<string> {
    const id = newId();
    await Pending.enqueuePendingUpload(id, orderId, fileUris);
    return id;
}

/** Try to upload all pending rows; delete local files and DB row on success. */
export async function flushUploadQueue(): Promise<{ processed: number; errors: string[] }> {
    const rows = await Pending.listPendingUploads();
    const errors: string[] = [];
    let processed = 0;
    for (const row of rows) {
        let uris: string[] = [];
        try {
            uris = JSON.parse(row.local_uris) as string[];
        } catch {
            await Pending.deletePendingUpload(row.id);
            continue;
        }
        const exist = await Promise.all(uris.map((u) => FileSystem.getInfoAsync(u).then((i) => i.exists)));
        if (exist.some((e) => !e)) {
            await Pending.bumpAttempt(row.id, 'Local file missing');
            errors.push(row.id);
            continue;
        }
        const result = await postDeliveryProof(row.order_id, uris);
        if (result.success) {
            for (const u of uris) {
                try {
                    await FileSystem.deleteAsync(u, { idempotent: true });
                } catch {
                    /* ignore */
                }
            }
            await Pending.deletePendingUpload(row.id);
            processed += 1;
        } else {
            const msg = (result as { error?: string }).error || 'Upload failed';
            await Pending.bumpAttempt(row.id, msg);
            errors.push(msg);
        }
    }
    return { processed, errors };
}
