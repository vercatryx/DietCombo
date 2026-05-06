'use server';

import { uploadFile } from '@/lib/storage';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { saveDeliveryProofUrlAndProcessOrder } from '@/lib/actions';
import { roundCurrency } from '@/lib/utils';
import { randomUUID } from 'crypto';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { sendDeliveryNotificationIfEnabled } from '@/lib/delivery-notification';
import { stampTimestampOnImageBuffer } from '@/lib/stampTimestampOnImageBuffer';
import { collectImageFilesFromFormData, proofPayloadForDb } from '@/lib/proof-of-delivery-urls';

export async function processDeliveryProof(formData: FormData) {
    const files = collectImageFilesFromFormData(formData);
    const orderNumber = formData.get('orderNumber') as string;
    const testUrl = formData.get('testUrl') as string | null;
    const testUrlsMulti = formData.getAll('testUrls').filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    let proofTimeIso: string | null = null;

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    const testUrlList: string[] =
        testUrlsMulti.length > 0
            ? testUrlsMulti.map((t) => t.trim())
            : testUrl
              ? [String(testUrl).trim()]
              : [];

    if (files.length === 0 && testUrlList.length === 0) {
        console.error('[Delivery Debug] processDeliveryProof: no files or test URLs', { orderNumber });
        return { success: false, error: 'Missing image(s) or test URL(s) or order number' };
    }
    if (!orderNumber) {
        return { success: false, error: 'Missing order number' };
    }

    try {
        let table: 'orders' | 'upcoming_orders' = 'orders';
        let foundOrder: { id: string; client_id: string } | null = null;

        const { data: orderData } = await supabaseAdmin
            .from('orders')
            .select('id, client_id')
            .eq('order_number', orderNumber)
            .maybeSingle();

        foundOrder = orderData;

        if (!foundOrder) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(orderNumber)) {
                const { data: orderById } = await supabaseAdmin
                    .from('orders')
                    .select('id, client_id')
                    .eq('id', orderNumber)
                    .maybeSingle();
                foundOrder = orderById;
            }
        }

        if (!foundOrder) {
            table = 'upcoming_orders';

            const { data: upcomingOrder } = await supabaseAdmin
                .from('upcoming_orders')
                .select('id, client_id')
                .eq('order_number', orderNumber)
                .maybeSingle();

            foundOrder = upcomingOrder;

            if (!foundOrder) {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (uuidRegex.test(orderNumber)) {
                    const { data: upcomingById } = await supabaseAdmin
                        .from('upcoming_orders')
                        .select('id, client_id')
                        .eq('id', orderNumber)
                        .maybeSingle();
                    foundOrder = upcomingById;
                }
            }
        }

        if (!foundOrder) {
            console.error(`[Delivery Debug] Order not found for OrderNumber: "${orderNumber}" in orders or upcoming_orders`);
            return { success: false, error: 'Order not found' };
        }

        const orderId = foundOrder.id;
        const clientId = foundOrder.client_id;

        let publicUrls: string[];

        if (testUrlList.length > 0) {
            publicUrls = testUrlList;
        } else {
            const publicUrlBase = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://storage.thedietfantasy.com';
            const baseUrl = publicUrlBase.endsWith('/') ? publicUrlBase.slice(0, -1) : publicUrlBase;
            publicUrls = [];

            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                const rawBuffer = Buffer.from(await f.arrayBuffer());
                const { buffer, stampedAtIso, contentType, fileExtension } = await stampTimestampOnImageBuffer(
                    rawBuffer,
                    f.type || 'image/jpeg',
                    new Date()
                );
                if (i === 0) proofTimeIso = stampedAtIso;
                const key = `proof-${orderNumber}-${Date.now()}-${i + 1}.${fileExtension}`;
                await uploadFile(key, buffer, contentType, process.env.R2_DELIVERY_BUCKET_NAME);
                publicUrls.push(`${baseUrl}/${key}`);
            }
        }

        const proofDb = proofPayloadForDb(publicUrls);

        if (table === 'upcoming_orders') {
            const result = await saveDeliveryProofUrlAndProcessOrder(orderId, 'upcoming', publicUrls);
            if (!result.success) {
                return { success: false, error: result.error || 'Failed to process order' };
            }
            await supabaseAdmin.from('stops').update({ proof_url: proofDb.proof_of_delivery_url }).eq('order_id', orderId);
            revalidatePath('/admin');
            sendDeliveryNotificationIfEnabled(supabaseAdmin, clientId).catch(() => {});
            return {
                success: true,
                urls: publicUrls,
                url: publicUrls[0],
            };
        }

        const updateData: any = {
            ...proofDb,
            status: 'billing_pending',
            actual_delivery_date: proofTimeIso ?? new Date().toISOString(),
        };

        const { error: updateError } = await supabaseAdmin.from('orders').update(updateData).eq('id', orderId);

        if (updateError) {
            console.error('Error updating order:', updateError);
            return { success: false, error: 'Failed to update order status' };
        }

        await supabaseAdmin.from('stops').update({ proof_url: proofDb.proof_of_delivery_url }).eq('order_id', orderId);

        const { data: orderDetails } = await supabaseAdmin
            .from('orders')
            .select('client_id, total_value, actual_delivery_date')
            .eq('id', orderId)
            .single();

        if (orderDetails) {
            const { data: client } = await supabaseAdmin
                .from('clients')
                .select('navigator_id, full_name, authorized_amount')
                .eq('id', orderDetails.client_id)
                .single();

            const { data: existingBilling } = await supabaseAdmin
                .from('billing_records')
                .select('id')
                .eq('order_id', orderId)
                .maybeSingle();

            if (!existingBilling) {
                await supabaseAdmin.from('billing_records').insert([
                    {
                        id: randomUUID(),
                        client_id: orderDetails.client_id,
                        order_id: orderId,
                        status: 'pending',
                        amount: orderDetails.total_value || 0,
                        navigator: client?.navigator_id || null,
                        remarks: 'Auto-generated upon proof upload',
                    },
                ]);
            }

            if (!existingBilling && client) {
                const currentAmount = client.authorized_amount ?? 0;
                const orderAmount = orderDetails.total_value || 0;
                const newAuthorizedAmount = roundCurrency(currentAmount - orderAmount);

                const { error: deductionError } = await supabaseAdmin
                    .from('clients')
                    .update({ authorized_amount: newAuthorizedAmount })
                    .eq('id', orderDetails.client_id);

                if (deductionError) {
                    console.error('[Delivery Proof] Error updating authorized_amount:', deductionError);
                }
            } else {
                if (!client) console.warn('[Delivery Proof] Client not found. Skipping deduction.');
            }
        }

        revalidatePath('/admin');
        sendDeliveryNotificationIfEnabled(supabaseAdmin, clientId).catch(() => {});

        return {
            success: true,
            urls: publicUrls,
            url: publicUrls[0],
        };
    } catch (error: any) {
        console.error('Error processing delivery:', error);
        return { success: false, error: error.message };
    }
}
