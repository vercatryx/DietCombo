'use server';

import { uploadFile } from '@/lib/storage';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { saveDeliveryProofUrlAndProcessOrder } from '@/lib/actions';

export async function processDeliveryProof(formData: FormData) {
    const file = formData.get('file') as File;
    const orderNumber = formData.get('orderNumber') as string;

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (!file || !orderNumber) {
        console.error('[Delivery Debug] processDeliveryProof called but missing file or orderNumber', {
            hasFile: !!file,
            orderNumber
        });
        return { success: false, error: 'Missing file or order number' };
    }

    try {
        // 1. Verify Order matches
        let table: 'orders' | 'upcoming_orders' = 'orders';
        let foundOrder: { id: string } | null = null;

        // Try finding in orders
        const { data: orderData } = await supabaseAdmin
            .from('orders')
            .select('id')
            .eq('order_number', orderNumber)
            .maybeSingle();

        foundOrder = orderData;

        // If not found by number, try ID
        if (!foundOrder) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(orderNumber)) {
                const { data: orderById } = await supabaseAdmin
                    .from('orders')
                    .select('id')
                    .eq('id', orderNumber)
                    .maybeSingle();
                foundOrder = orderById;
            }
        }

        // If still not found, try UPCOMING orders
        if (!foundOrder) {
            table = 'upcoming_orders';

            const { data: upcomingOrder } = await supabaseAdmin
                .from('upcoming_orders')
                .select('id')
                .eq('order_number', orderNumber)
                .maybeSingle();

            foundOrder = upcomingOrder;

            // Try ID for upcoming if number failed
            if (!foundOrder) {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (uuidRegex.test(orderNumber)) {
                    const { data: upcomingById } = await supabaseAdmin
                        .from('upcoming_orders')
                        .select('id')
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

        // 2. Upload File
        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = Date.now();
        const extension = file.name.split('.').pop();
        const key = `proof-${orderNumber}-${timestamp}.${extension}`;

        await uploadFile(key, buffer, file.type, process.env.R2_DELIVERY_BUCKET_NAME);
        const publicUrl = `${process.env.R2_PUBLIC_URL_BASE || 'https://pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev'}/${key}`;

        // 3. Update Order in Supabase
        // For upcoming_orders, use saveDeliveryProofUrlAndProcessOrder to properly process the order
        if (table === 'upcoming_orders') {
            const result = await saveDeliveryProofUrlAndProcessOrder(orderId, 'upcoming', publicUrl);
            if (!result.success) {
                return { success: false, error: result.error || 'Failed to process order' };
            }
            revalidatePath('/admin');
            return { success: true, url: publicUrl };
        }

        // For orders table, update with billing_pending status (never 'pending' or 'delivered')
        const updateData: any = {
            delivery_proof_url: publicUrl,
            status: 'billing_pending',
            actual_delivery_date: new Date().toISOString()
        };

        const { error: updateError } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', orderId);

        if (updateError) {
            console.error('Error updating order:', updateError);
            return { success: false, error: 'Failed to update order status' };
        }

        // Create billing record if it doesn't exist (similar to updateOrderDeliveryProof)
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
                const billingPayload = {
                    client_id: orderDetails.client_id,
                    client_name: client?.full_name || 'Unknown Client',
                    order_id: orderId,
                    status: 'pending',
                    amount: orderDetails.total_value || 0,
                    navigator: client?.navigator_id || 'Unknown',
                    delivery_date: orderDetails.actual_delivery_date,
                    remarks: 'Auto-generated upon proof upload'
                };

                await supabaseAdmin.from('billing_records').insert([billingPayload]);
            }

            if (!existingBilling && client) {
                // Treat null/undefined as 0 and allow negative result
                const currentAmount = client.authorized_amount ?? 0;
                const orderAmount = orderDetails.total_value || 0;
                const newAuthorizedAmount = currentAmount - orderAmount;

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

        revalidatePath('/admin'); // Revalidate admin views

        return { success: true, url: publicUrl };
    } catch (error: any) {
        console.error('Error processing delivery:', error);
        return { success: false, error: error.message };
    }
}

