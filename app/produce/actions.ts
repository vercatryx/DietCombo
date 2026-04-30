'use server';

import { uploadFile } from '@/lib/storage';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { saveDeliveryProofUrlAndProcessOrder, getDefaultOrderTemplate, getDefaultVendorId } from '@/lib/actions';
import { roundCurrency } from '@/lib/utils';
import { getNextOccurrence } from '@/lib/order-dates';
import { getCurrentTime } from '@/lib/time';
import { getTodayDateInAppTzAsReference, getTodayInAppTz, toDateStringInAppTz } from '@/lib/timezone';
import { randomUUID } from 'crypto';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { sendDeliveryNotificationIfEnabled } from '@/lib/delivery-notification';
import { stampTimestampOnImageBuffer } from '@/lib/stampTimestampOnImageBuffer';

type BulkResult<T> = { success: true } & T | { success: false; error: string; errors?: string[] };

async function getProduceVendorByToken(supabaseAdmin: any, vendorToken: string) {
    if (!vendorToken?.trim()) return null;
    const { data } = await supabaseAdmin
        .from('produce_vendors')
        .select('id, name, token, is_active')
        .eq('token', vendorToken.trim())
        .maybeSingle();
    if (!data || data.is_active === false) return null;
    return data as { id: string; name: string; token: string; is_active: boolean };
}

export async function processProduceProof(formData: FormData) {
    const file = formData.get('file') as File;
    const orderNumber = formData.get('orderNumber') as string;
    const testUrl = formData.get('testUrl') as string | null; // Optional test URL to bypass R2
    let proofTimeIso: string | null = null;

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    // Allow test URL to bypass file requirement
    if ((!file && !testUrl) || !orderNumber) {
        console.error('[Produce Debug] processProduceProof called but missing file/testUrl or orderNumber', {
            hasFile: !!file,
            hasTestUrl: !!testUrl,
            orderNumber
        });
        return { success: false, error: 'Missing file/test URL or order number' };
    }

    try {
        // 1. Verify Order matches
        let table: 'orders' | 'upcoming_orders' = 'orders';
        let foundOrder: { id: string; client_id: string } | null = null;

        // Try finding in orders
        const { data: orderData } = await supabaseAdmin
            .from('orders')
            .select('id, client_id')
            .eq('order_number', orderNumber)
            .maybeSingle();

        foundOrder = orderData;

        // If not found by number, try ID
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

        // If still not found, try UPCOMING orders
        if (!foundOrder) {
            table = 'upcoming_orders';

            const { data: upcomingOrder } = await supabaseAdmin
                .from('upcoming_orders')
                .select('id, client_id')
                .eq('order_number', orderNumber)
                .maybeSingle();

            foundOrder = upcomingOrder;

            // Try ID for upcoming if number failed
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
            console.error(`[Produce Debug] Order not found for OrderNumber: "${orderNumber}" in orders or upcoming_orders`);
            return { success: false, error: 'Order not found' };
        }

        const orderId = foundOrder.id;

        // 2. Handle File Upload or Test URL
        let publicUrl: string;
        
        if (testUrl) {
            // Use test URL directly, skip R2 upload
            console.log(`[Produce Debug] Using test URL (skipping R2): ${testUrl}`);
            publicUrl = testUrl;
        } else if (file) {
            // Normal flow: Upload to R2
            const rawBuffer = Buffer.from(await file.arrayBuffer());
            const { buffer, stampedAtIso } = await stampTimestampOnImageBuffer(
                rawBuffer,
                file.type || 'image/jpeg',
                new Date()
            );
            proofTimeIso = stampedAtIso;
            const timestamp = Date.now();
            const extension = file.name.split('.').pop();
            const key = `produce-proof-${orderNumber}-${timestamp}.${extension}`;

            await uploadFile(key, buffer, file.type, process.env.R2_DELIVERY_BUCKET_NAME);
            const publicUrlBase = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://storage.thedietfantasy.com';
            const baseUrl = publicUrlBase.endsWith('/') ? publicUrlBase.slice(0, -1) : publicUrlBase;
            publicUrl = `${baseUrl}/${key}`;
        } else {
            return { success: false, error: 'No file or test URL provided' };
        }

        // 3. Update Order in Supabase
        // For upcoming_orders, use saveDeliveryProofUrlAndProcessOrder to properly process the order
        if (table === 'upcoming_orders') {
            const result = await saveDeliveryProofUrlAndProcessOrder(orderId, 'upcoming', publicUrl);
            if (!result.success) {
                return { success: false, error: result.error || 'Failed to process order' };
            }
            revalidatePath('/admin');
            sendDeliveryNotificationIfEnabled(supabaseAdmin, foundOrder.client_id).catch(() => {});
            return { success: true, url: publicUrl };
        }

        // For orders table, update with produce processing status.
        // Set both actual_delivery_date and scheduled_delivery_date to proof upload date (Produce = prompt/realtime).
        const proofUploadTime = proofTimeIso ? new Date(proofTimeIso) : new Date();
        const proofUploadDateStr = toDateStringInAppTz(proofUploadTime);
        const updateData: any = {
            proof_of_delivery_url: publicUrl,
            status: 'billing_pending',
            actual_delivery_date: proofUploadTime.toISOString(),
            scheduled_delivery_date: proofUploadDateStr
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
            .select('client_id, total_value, bill_amount, actual_delivery_date')
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
                // Use bill_amount if available, otherwise fall back to total_value
                const billingAmount = orderDetails.bill_amount ?? orderDetails.total_value ?? 0;
                await supabaseAdmin.from('billing_records').insert([{
                    id: randomUUID(),
                    client_id: orderDetails.client_id,
                    order_id: orderId,
                    status: 'pending',
                    amount: billingAmount,
                    navigator: client?.navigator_id || null,
                    remarks: 'Auto-generated upon produce proof upload'
                }]);
            }

            if (!existingBilling && client) {
                // Treat null/undefined as 0 and allow negative result
                const currentAmount = client.authorized_amount ?? 0;
                const orderAmount = orderDetails.total_value || 0;
                const newAuthorizedAmount = roundCurrency(currentAmount - orderAmount);

                const { error: deductionError } = await supabaseAdmin
                    .from('clients')
                    .update({ authorized_amount: newAuthorizedAmount })
                    .eq('id', orderDetails.client_id);

                if (deductionError) {
                    console.error('[Produce Proof] Error updating authorized_amount:', deductionError);
                }
            } else {
                if (!client) console.warn('[Produce Proof] Client not found. Skipping deduction.');
            }
        }

        revalidatePath('/admin'); // Revalidate admin views

        const smsClientId = orderDetails?.client_id ?? foundOrder.client_id;
        sendDeliveryNotificationIfEnabled(supabaseAdmin, smsClientId).catch(() => {});

        return { success: true, url: publicUrl };
    } catch (error: any) {
        console.error('Error processing produce:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Load client info for the produce flow (no order created).
 * Used to show client details and allow image upload before creating the order.
 */
export async function getClientForProduce(clientId: string) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    try {
        const { data: client, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('id, full_name, address, phone_number, sign_token')
            .eq('id', clientId)
            .single();

        if (clientError || !client) {
            console.error('[Get Client For Produce] Client not found:', clientError);
            return { success: false, error: 'Client not found' };
        }

        // Produce is prompt/realtime delivery: show today's date as scheduled (not vendor delivery days)
        const deliveryDateLabel = getTodayInAppTz();

        return {
            success: true,
            client: {
                id: client.id,
                full_name: client.full_name,
                address: client.address || 'Unknown Address',
                phoneNumber: client.phone_number?.trim() || null,
                deliveryDateLabel,
                clientSignToken: client.sign_token || null
            }
        };
    } catch (error: any) {
        console.error('[Get Client For Produce] Error:', error);
        return { success: false, error: error.message || 'Failed to load client' };
    }
}

/**
 * Upload produce proof image only (no order required).
 * Returns the public URL for use when creating the order.
 */
export async function uploadProduceProofOnly(formData: FormData) {
    const file = formData.get('file') as File;
    const clientId = formData.get('clientId') as string;

    if (!file || !clientId) {
        return { success: false, error: 'Missing file or client ID' };
    }

    try {
        const rawBuffer = Buffer.from(await file.arrayBuffer());
        const { buffer } = await stampTimestampOnImageBuffer(rawBuffer, file.type || 'image/jpeg', new Date());
        const timestamp = Date.now();
        const extension = file.name.split('.').pop() || 'jpg';
        const key = `produce-proof-${clientId}-${timestamp}.${extension}`;

        await uploadFile(key, buffer, file.type, process.env.R2_DELIVERY_BUCKET_NAME);
        const publicUrlBase = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://storage.thedietfantasy.com';
        const baseUrl = publicUrlBase.endsWith('/') ? publicUrlBase.slice(0, -1) : publicUrlBase;
        const publicUrl = `${baseUrl}/${key}`;

        return { success: true, url: publicUrl };
    } catch (error: any) {
        console.error('[Upload Produce Proof Only] Error:', error);
        return { success: false, error: error.message || 'Upload failed' };
    }
}

/**
 * Create a Produce order with delivery proof URL already set.
 * Called only after the image has been uploaded to prevent unfulfilled orders.
 */
export async function createProduceOrderWithProof(clientId: string, deliveryProofUrl: string) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    try {
        const { data: client, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('id, full_name, address, sign_token, navigator_id')
            .eq('id', clientId)
            .single();

        if (clientError || !client) {
            return { success: false, error: 'Client not found' };
        }

        const defaultTemplate = await getDefaultOrderTemplate('Produce');
        const billAmount = defaultTemplate?.billAmount || 0;
        if (!billAmount || billAmount <= 0) {
            return { success: false, error: 'Default bill amount not configured. Please set it in Admin Control > Default Order Template > Produce.' };
        }

        const defaultVendorId = await getDefaultVendorId();
        const { data: vendors } = await supabaseAdmin
            .from('vendors')
            .select('id, name, delivery_days, is_default')
            .eq('is_active', true)
            .order('is_default', { ascending: false });

        const mainVendor = vendors?.find(v => v.is_default === true) || vendors?.[0];
        // Delivery date = date when proof image is uploaded (today in app timezone)
        const deliveryDateStr = getTodayInAppTz();

        const { generateUniqueOrderNumber } = await import('@/lib/actions');
        const finalOrderNumber = await generateUniqueOrderNumber(supabaseAdmin);
        const orderId = randomUUID();
        const orderData: any = {
            id: orderId,
            client_id: clientId,
            service_type: 'Produce',
            order_number: finalOrderNumber,
            scheduled_delivery_date: deliveryDateStr,
            status: 'billing_pending',
            total_value: billAmount,
            total_items: 1,
            bill_amount: billAmount,
            proof_of_delivery_url: deliveryProofUrl,
            actual_delivery_date: new Date().toISOString(),
            created_at: new Date().toISOString()
        };
        if (defaultVendorId) orderData.vendor_id = defaultVendorId;

        const { data: newOrder, error: insertError } = await supabaseAdmin
            .from('orders')
            .insert([orderData])
            .select()
            .single();

        if (insertError || !newOrder) {
            const errorMessage = insertError?.message || insertError?.details || insertError?.hint || 'Failed to create order';
            return { success: false, error: errorMessage };
        }

        if (mainVendor) {
            const vsId = randomUUID();
            await supabaseAdmin
                .from('order_vendor_selections')
                .insert([{ id: vsId, order_id: orderId, vendor_id: mainVendor.id }]);
        }

        const { data: orderDetails } = await supabaseAdmin
            .from('orders')
            .select('client_id, total_value, bill_amount, actual_delivery_date')
            .eq('id', orderId)
            .single();

        if (orderDetails) {
            const { data: clientRow } = await supabaseAdmin
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
                const billingAmount = orderDetails.bill_amount ?? orderDetails.total_value ?? 0;
                await supabaseAdmin.from('billing_records').insert([{
                    id: randomUUID(),
                    client_id: orderDetails.client_id,
                    order_id: orderId,
                    status: 'pending',
                    amount: billingAmount,
                    navigator: clientRow?.navigator_id || null,
                    remarks: 'Auto-generated upon produce proof upload'
                }]);
            }

            if (!existingBilling && clientRow) {
                const currentAmount = clientRow.authorized_amount ?? 0;
                const orderAmount = orderDetails.total_value || 0;
                const newAuthorizedAmount = roundCurrency(currentAmount - orderAmount);
                await supabaseAdmin
                    .from('clients')
                    .update({ authorized_amount: newAuthorizedAmount })
                    .eq('id', orderDetails.client_id);
            }
        }

        revalidatePath('/admin');

        sendDeliveryNotificationIfEnabled(supabaseAdmin, clientId).catch(() => {});

        return {
            success: true,
            order: {
                id: newOrder.id,
                orderNumber: newOrder.order_number,
                clientName: client.full_name,
                address: client.address || 'Unknown Address',
                deliveryDate: newOrder.scheduled_delivery_date,
                alreadyDelivered: true,
                clientSignToken: client.sign_token || null
            }
        };
    } catch (error: any) {
        console.error('[Create Produce Order With Proof] Error:', error);
        return { success: false, error: error.message || 'Failed to create produce order' };
    }
}

/**
 * Create a new Produce order for a client (legacy: creates order upfront without proof).
 * Prefer getClientForProduce + uploadProduceProofOnly + createProduceOrderWithProof to avoid unfulfilled orders.
 */
export async function createProduceOrder(clientId: string) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    try {
        // 1. Verify client exists
        const { data: client, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('id, full_name, address, sign_token, navigator_id')
            .eq('id', clientId)
            .single();

        if (clientError || !client) {
            console.error('[Create Produce Order] Client not found:', clientError);
            return { success: false, error: 'Client not found' };
        }

        // 2. Get default bill_amount from admin control (default order template)
        const defaultTemplate = await getDefaultOrderTemplate('Produce');
        const billAmount = defaultTemplate?.billAmount || 0;

        if (!billAmount || billAmount <= 0) {
            console.error('[Create Produce Order] No default bill_amount found in admin control');
            return { success: false, error: 'Default bill amount not configured. Please set it in Admin Control > Default Order Template > Produce.' };
        }

        // 3. Get default vendor ID
        const defaultVendorId = await getDefaultVendorId();
        
        // Get vendors to find main vendor for delivery date calculation
        const { data: vendors } = await supabaseAdmin
            .from('vendors')
            .select('id, name, delivery_days, is_default')
            .eq('is_active', true)
            .order('is_default', { ascending: false });

        const mainVendor = vendors?.find(v => v.is_default === true) || vendors?.[0];
        
        // Calculate scheduled delivery date in Eastern time (today or next vendor delivery day)
        const currentTime = await getCurrentTime();
        const refToday = getTodayDateInAppTzAsReference(currentTime);
        let scheduledDeliveryDate = new Date(refToday);

        if (mainVendor && mainVendor.delivery_days) {
            const deliveryDays = typeof mainVendor.delivery_days === 'string'
                ? JSON.parse(mainVendor.delivery_days)
                : mainVendor.delivery_days;

            if (Array.isArray(deliveryDays) && deliveryDays.length > 0) {
                const vendorDeliveryDay = deliveryDays[0];
                const nextDate = getNextOccurrence(vendorDeliveryDay, refToday);
                if (nextDate) {
                    scheduledDeliveryDate = nextDate;
                }
            }
        }

        // 4. Generate unique order_number using helper function (checks both orders and upcoming_orders)
        const { generateUniqueOrderNumber } = await import('@/lib/actions');
        const finalOrderNumber = await generateUniqueOrderNumber(supabaseAdmin);

        // 6. Create the order in orders table (not upcoming_orders)
        const orderId = randomUUID();
        const orderData: any = {
            id: orderId,
            client_id: clientId,
            service_type: 'Produce',
            order_number: finalOrderNumber,
            scheduled_delivery_date: toDateStringInAppTz(scheduledDeliveryDate),
            status: 'pending',
            total_value: billAmount,
            total_items: 1,
            bill_amount: billAmount,
            proof_of_delivery_url: null,
            created_at: new Date().toISOString()
        };

        // Only include vendor_id if it's not null (Supabase might reject null explicitly)
        if (defaultVendorId) {
            orderData.vendor_id = defaultVendorId;
        }

        // Log the order data being inserted for debugging
        console.log('[Create Produce Order] Inserting order data:', JSON.stringify(orderData, null, 2));

        const { data: newOrder, error: insertError } = await supabaseAdmin
            .from('orders')
            .insert([orderData])
            .select()
            .single();

        if (insertError || !newOrder) {
            // Log full error details for debugging
            let errorString = 'Unable to serialize error';
            try {
                errorString = JSON.stringify(insertError, null, 2);
            } catch (e) {
                // If JSON.stringify fails, try to get error properties manually
                errorString = `Error object: ${insertError?.constructor?.name || 'Unknown'}, message: ${insertError?.message || 'N/A'}`;
            }
            
            console.error('[Create Produce Order] Error creating order:', {
                error: insertError,
                errorString: errorString,
                errorMessage: insertError?.message,
                errorCode: insertError?.code,
                errorDetails: insertError?.details,
                errorHint: insertError?.hint,
                errorStatus: (insertError as any)?.status,
                errorStatusText: (insertError as any)?.statusText,
                orderData: JSON.stringify(orderData, null, 2),
                hasError: !!insertError,
                errorType: typeof insertError,
                errorKeys: insertError ? Object.keys(insertError) : []
            });
            
            // Extract error message from various possible error formats
            const errorMessage = insertError?.message 
                || insertError?.details 
                || insertError?.hint 
                || (insertError ? (errorString !== 'Unable to serialize error' ? errorString : 'Database error occurred') : 'Unknown error')
                || 'Failed to create order';
            
            return { success: false, error: errorMessage };
        }

        // 7. Create vendor selection if vendor exists
        if (mainVendor) {
            const vsId = randomUUID();
            await supabaseAdmin
                .from('order_vendor_selections')
                .insert([{ 
                    id: vsId, 
                    order_id: orderId, 
                    vendor_id: mainVendor.id 
                }]);
        }

        return {
            success: true,
            order: {
                id: newOrder.id,
                orderNumber: newOrder.order_number,
                clientName: client.full_name,
                address: client.address || 'Unknown Address',
                deliveryDate: newOrder.scheduled_delivery_date,
                alreadyDelivered: false,
                clientSignToken: client.sign_token || null
            }
        };
    } catch (error: any) {
        console.error('[Create Produce Order] Error:', error);
        return { success: false, error: error.message || 'Failed to create produce order' };
    }
}

export async function bulkCreateProduceOrdersForVendor(
    clientIds: string[],
    deliveryDate: string, // 'YYYY-MM-DD'
    vendorToken: string
): Promise<BulkResult<{ created: number; errors: string[]; orders: Array<{ clientId: string; clientName: string; address: string; phone: string; orderNumber: number; deliveryDate: string }> }>> {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    try {
        const vendor = await getProduceVendorByToken(supabaseAdmin, vendorToken);
        if (!vendor) return { success: false, error: 'Unauthorized' };

        const ids = (clientIds || []).map(s => (s || '').trim()).filter(Boolean);
        if (ids.length === 0) {
            return { success: true, created: 0, errors: [], orders: [] };
        }

        const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ? deliveryDate : toDateStringInAppTz(new Date(deliveryDate));

        const defaultTemplate = await getDefaultOrderTemplate('Produce');
        const billAmount = defaultTemplate?.billAmount || 0;
        if (!billAmount || billAmount <= 0) {
            return { success: false, error: 'Default bill amount not configured for Produce.' };
        }

        const defaultVendorId = await getDefaultVendorId();

        // Fetch client info and enforce vendor ownership
        const { data: clientRows, error: clientsErr } = await supabaseAdmin
            .from('clients')
            .select('id, full_name, address, phone_number, service_type, paused, produce_vendor_id')
            .in('id', ids);
        if (clientsErr) return { success: false, error: `Failed to load clients: ${clientsErr.message}` };

        const validClients = (clientRows || [])
            .filter(c => c.service_type === 'Produce' && !c.paused && c.produce_vendor_id === vendor.id);

        if (validClients.length === 0) {
            return { success: true, created: 0, errors: [], orders: [] };
        }

        const { generateBatchOrderNumbers } = await import('@/lib/actions');
        const orderNumbers = await generateBatchOrderNumbers(supabaseAdmin, validClients.length);

        const nowIso = new Date().toISOString();
        const insertPayload = validClients.map((c, idx) => {
            const payload: any = {
                id: randomUUID(),
                client_id: c.id,
                service_type: 'Produce',
                order_number: orderNumbers[idx],
                scheduled_delivery_date: dateKey,
                status: 'pending',
                total_value: billAmount,
                total_items: 1,
                bill_amount: billAmount,
                proof_of_delivery_url: null,
                created_at: nowIso
            };
            if (defaultVendorId) payload.vendor_id = defaultVendorId;
            return payload;
        });

        const { data: insertedOrders, error: insertErr } = await supabaseAdmin
            .from('orders')
            .insert(insertPayload)
            .select('id, client_id, order_number, scheduled_delivery_date');
        if (insertErr) return { success: false, error: `Failed to create orders: ${insertErr.message}` };

        // Build return rows for Excel export
        const byClientId = new Map(validClients.map(c => [c.id, c]));
        const orders = (insertedOrders || []).map(o => {
            const c: any = byClientId.get(o.client_id);
            return {
                clientId: o.client_id,
                clientName: c?.full_name || 'Unknown',
                address: c?.address || '',
                phone: (c?.phone_number || '').trim(),
                orderNumber: o.order_number,
                deliveryDate: o.scheduled_delivery_date || dateKey
            };
        });

        revalidatePath('/admin');
        revalidatePath('/vendors');

        return { success: true, created: orders.length, errors: [], orders };
    } catch (e: any) {
        return { success: false, error: e?.message || 'Failed to create orders' };
    }
}

export async function bulkUpdateProduceProofsForVendor(
    updates: Array<{ orderNumber: string; proofUrl: string }>,
    vendorToken: string
): Promise<BulkResult<{ updated: number; errors: string[] }>> {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    try {
        const vendor = await getProduceVendorByToken(supabaseAdmin, vendorToken);
        if (!vendor) return { success: false, error: 'Unauthorized' };

        const rows = (updates || [])
            .map(u => ({ orderNumber: (u?.orderNumber || '').trim(), proofUrl: (u?.proofUrl || '').trim() }))
            .filter(u => u.orderNumber && u.proofUrl);

        if (rows.length === 0) return { success: true, updated: 0, errors: [] };

        // Preload vendor client ids for ownership checks
        const { data: vendorClients, error: vcErr } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('produce_vendor_id', vendor.id);
        if (vcErr) return { success: false, error: `Failed to load vendor clients: ${vcErr.message}` };
        const allowedClientIds = new Set((vendorClients || []).map(c => c.id));

        const errors: string[] = [];
        let updated = 0;

        for (let i = 0; i < rows.length; i++) {
            const { orderNumber, proofUrl } = rows[i];

            try {
                const asNumber = Number(orderNumber);
                const isNumeric = Number.isFinite(asNumber) && String(asNumber) === orderNumber;

                const { data: order, error: orderErr } = await supabaseAdmin
                    .from('orders')
                    .select('id, client_id, total_value, bill_amount, service_type')
                    .eq('service_type', 'Produce')
                    // order_number is numeric in DB; accept numeric string
                    .eq('order_number', isNumeric ? asNumber : orderNumber)
                    .maybeSingle();

                if (orderErr) {
                    errors.push(`Row ${i + 1} (Order ${orderNumber}): ${orderErr.message}`);
                    continue;
                }
                if (!order) {
                    errors.push(`Row ${i + 1} (Order ${orderNumber}): Order not found`);
                    continue;
                }

                if (!allowedClientIds.has(order.client_id)) {
                    errors.push(`Row ${i + 1} (Order ${orderNumber}): Unauthorized`);
                    continue;
                }

                const nowIso = new Date().toISOString();
                const { error: updErr } = await supabaseAdmin
                    .from('orders')
                    .update({
                        proof_of_delivery_url: proofUrl,
                        status: 'billing_pending',
                        actual_delivery_date: nowIso
                    })
                    .eq('id', order.id);
                if (updErr) {
                    errors.push(`Row ${i + 1} (Order ${orderNumber}): Failed to update order: ${updErr.message}`);
                    continue;
                }

                // Create billing record if missing
                const { data: existingBilling } = await supabaseAdmin
                    .from('billing_records')
                    .select('id')
                    .eq('order_id', order.id)
                    .maybeSingle();

                if (!existingBilling) {
                    const { data: clientRow } = await supabaseAdmin
                        .from('clients')
                        .select('navigator_id, authorized_amount')
                        .eq('id', order.client_id)
                        .single();

                    const billingAmount = order.bill_amount ?? order.total_value ?? 0;
                    await supabaseAdmin
                        .from('billing_records')
                        .insert([{
                            id: randomUUID(),
                            client_id: order.client_id,
                            order_id: order.id,
                            status: 'pending',
                            amount: billingAmount,
                            navigator: clientRow?.navigator_id || null,
                            remarks: 'Auto-generated upon vendor bulk proof upload'
                        }]);

                    // Reduce authorized amount (if present)
                    if (clientRow?.authorized_amount !== null && clientRow?.authorized_amount !== undefined) {
                        const currentAmount = clientRow.authorized_amount ?? 0;
                        const orderAmount = billingAmount || 0;
                        const newAuthorizedAmount = Math.max(0, roundCurrency(currentAmount - orderAmount));
                        await supabaseAdmin
                            .from('clients')
                            .update({ authorized_amount: newAuthorizedAmount })
                            .eq('id', order.client_id);
                    }
                }

                updated += 1;
            } catch (rowErr: any) {
                errors.push(`Row ${i + 1} (Order ${rows[i].orderNumber}): ${rowErr?.message || 'Unknown error'}`);
            }
        }

        revalidatePath('/admin');
        revalidatePath('/vendors');

        // IMPORTANT: Do not call sendDeliveryNotificationIfEnabled here (no SMS for this bulk flow).
        return { success: true, updated, errors };
    } catch (e: any) {
        return { success: false, error: e?.message || 'Failed to update proofs' };
    }
}
