'use server';

import { uploadFile } from '@/lib/storage';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { saveDeliveryProofUrlAndProcessOrder, getDefaultOrderTemplate, getDefaultVendorId } from '@/lib/actions';
import { roundCurrency } from '@/lib/utils';
import { getNextOccurrence } from '@/lib/order-dates';
import { getCurrentTime } from '@/lib/time';
import {
    APP_TIMEZONE,
    easternWallClockToUtcInstant,
    formatInAppTz,
    getTodayDateInAppTzAsReference,
    toDateStringInAppTz,
} from '@/lib/timezone';
import { randomUUID } from 'crypto';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { sendDeliveryNotificationIfEnabled } from '@/lib/delivery-notification';
import { stampTimestampOnImageBuffer } from '@/lib/stampTimestampOnImageBuffer';
import { ordersRowTouch } from '@/lib/orders-row-touch';
import { collectImageFilesFromFormData, proofPayloadForDb } from '@/lib/proof-of-delivery-urls';
import {
    addCalendarDaysAppTz,
    getProduceOrderRosterWeekSundayKey,
    isDateKeyInRosterWeek,
} from '@/lib/produce-roster-week';

async function applyProduceProofToOrderRow(
    supabaseAdmin: any,
    orderId: string,
    proofUrls: string[],
    options: { keepScheduledDate: boolean; proofTime?: Date }
): Promise<{ success: boolean; error?: string; clientId?: string }> {
    const urls = proofUrls.map((u) => String(u).trim()).filter(Boolean);
    if (urls.length === 0) return { success: false, error: 'At least one proof image URL is required' };

    const proofDb = proofPayloadForDb(urls);
    const proofUploadTime = options.proofTime ?? new Date();
    const proofUploadDateStr = toDateStringInAppTz(proofUploadTime);

    let scheduledDeliveryDateStr = proofUploadDateStr;
    if (options.keepScheduledDate) {
        const { data: ord } = await supabaseAdmin
            .from('orders')
            .select('scheduled_delivery_date')
            .eq('id', orderId)
            .maybeSingle();
        const ex = ord?.scheduled_delivery_date;
        if (ex) scheduledDeliveryDateStr = String(ex).slice(0, 10);
    }

    const updateData: any = {
        ...proofDb,
        ...ordersRowTouch(),
        status: 'billing_pending',
        actual_delivery_date: proofUploadTime.toISOString(),
        scheduled_delivery_date: scheduledDeliveryDateStr
    };

    const { error: updateError } = await supabaseAdmin.from('orders').update(updateData).eq('id', orderId);

    if (updateError) {
        console.error('Error updating order:', updateError);
        const msg = String(updateError.message || '');
        if (msg.includes('updated_at') || updateError.code === '42703') {
            return {
                success: false,
                error:
                    'Order update blocked by a database trigger: public.orders uses last_updated, but the trigger function update_updated_at_column() still assigns NEW.updated_at. Fix it in Postgres (see sql/fix_update_updated_at_trigger_orders_last_updated.sql) or your team\'s migration.'
            };
        }
        return { success: false, error: 'Failed to update order status' };
    }

    const { data: orderDetails } = await supabaseAdmin
        .from('orders')
        .select('client_id, total_value, bill_amount, actual_delivery_date, order_number')
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
            const billingAmount = orderDetails.bill_amount ?? orderDetails.total_value ?? 0;
            await supabaseAdmin.from('billing_records').insert([
                {
                    id: randomUUID(),
                    client_id: orderDetails.client_id,
                    order_id: orderId,
                    status: 'pending',
                    amount: billingAmount,
                    navigator: client?.navigator_id || null,
                    remarks: 'Auto-generated upon produce proof upload'
                }
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
                console.error('[Produce Proof] Error updating authorized_amount:', deductionError);
            }
        } else if (!client) {
            console.warn('[Produce Proof] Client not found. Skipping deduction.');
        }
    }

    revalidatePath('/admin');
    revalidatePath('/orders');
    revalidatePath(`/orders/${orderId}`);
    revalidatePath(`/delivery/${orderId}`);
    if (orderDetails?.order_number != null && orderDetails.order_number !== '') {
        revalidatePath(`/delivery/${String(orderDetails.order_number)}`);
    }
    const smsClientId = orderDetails?.client_id;
    if (smsClientId) {
        sendDeliveryNotificationIfEnabled(supabaseAdmin, smsClientId).catch(() => {});
    }
    return { success: true, clientId: orderDetails?.client_id };
}

export async function processProduceProof(formData: FormData) {
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
        console.error('[Produce Debug] processProduceProof: no files or test URLs', { orderNumber });
        return { success: false, error: 'Missing image(s) or test URL(s) or order number' };
    }
    if (!orderNumber) {
        return { success: false, error: 'Missing order number' };
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
                const key = `produce-proof-${orderNumber}-${Date.now()}-${i + 1}.${fileExtension}`;
                await uploadFile(key, buffer, contentType, process.env.R2_DELIVERY_BUCKET_NAME);
                publicUrls.push(`${baseUrl}/${key}`);
            }
        }

        if (table === 'upcoming_orders') {
            const result = await saveDeliveryProofUrlAndProcessOrder(orderId, 'upcoming', publicUrls);
            if (!result.success) {
                return { success: false, error: result.error || 'Failed to process order' };
            }
            revalidatePath('/admin');
            sendDeliveryNotificationIfEnabled(supabaseAdmin, foundOrder.client_id).catch(() => {});
            return { success: true, urls: publicUrls, url: publicUrls[0] };
        }

        const proofUploadTime = proofTimeIso ? new Date(proofTimeIso) : new Date();
        const fin = await applyProduceProofToOrderRow(supabaseAdmin, orderId, publicUrls, {
            keepScheduledDate: false,
            proofTime: proofUploadTime
        });
        if (!fin.success) {
            return { success: false, error: fin.error || 'Failed to update order' };
        }

        return { success: true, urls: publicUrls, url: publicUrls[0] };
    } catch (error: any) {
        console.error('Error processing produce:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Load client info for the produce flow (no order created).
 * `deliveryDateLabel` is the Monday of the current roster week — context before any proof exists.
 * Order timing after upload uses the proof submit time (see uploadProduceProofOnly / createProduceOrderWithProof).
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

        const rosterSun = getProduceOrderRosterWeekSundayKey(new Date());
        const mondayKey = addCalendarDaysAppTz(rosterSun, 1);
        const mondayAnchor = easternWallClockToUtcInstant(mondayKey, 12, 0, 0, 0);
        const deliveryDateLabel = formatInAppTz(mondayAnchor, {
            timeZone: APP_TIMEZONE,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });

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
    const files = collectImageFilesFromFormData(formData);
    const clientId = formData.get('clientId') as string;

    if (files.length === 0 || !clientId) {
        return { success: false, error: 'Missing file(s) or client ID' };
    }

    try {
        const publicUrlBase = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://storage.thedietfantasy.com';
        const baseUrl = publicUrlBase.endsWith('/') ? publicUrlBase.slice(0, -1) : publicUrlBase;
        const urls: string[] = [];
        /** Single instant for this submit — used for order `actual_delivery_date` (not EXIF on the file). */
        const uploadTime = new Date();
        const proofCapturedAtIso = uploadTime.toISOString();

        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const rawBuffer = Buffer.from(await f.arrayBuffer());
            const { buffer, contentType, fileExtension } = await stampTimestampOnImageBuffer(
                rawBuffer,
                f.type || 'image/jpeg',
                uploadTime
            );
            const key = `produce-proof-${clientId}-${Date.now()}-${i + 1}.${fileExtension}`;
            await uploadFile(key, buffer, contentType, process.env.R2_DELIVERY_BUCKET_NAME);
            urls.push(`${baseUrl}/${key}`);
        }

        return { success: true, urls, url: urls[0], proofCapturedAtIso };
    } catch (error: any) {
        console.error('[Upload Produce Proof Only] Error:', error);
        return { success: false, error: error.message || 'Upload failed' };
    }
}

/**
 * Create a Produce order with delivery proof URL already set.
 * Called only after the image has been uploaded to prevent unfulfilled orders.
 */
export async function createProduceOrderWithProof(
    clientId: string,
    proofUrls: string[],
    proofCapturedAtIso?: string | null
) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    try {
        const urls = proofUrls.map((u) => String(u).trim()).filter(Boolean);
        if (urls.length === 0) {
            return { success: false, error: 'At least one proof image URL is required' };
        }

        const { data: client, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('id, full_name, address, sign_token, navigator_id')
            .eq('id', clientId)
            .single();

        if (clientError || !client) {
            return { success: false, error: 'Client not found' };
        }

        /** Same roster Sunday as weekly cron / `getProduceOrderRosterWeekSundayKey` (not calendar-week Sunday). */
        const rosterSun = getProduceOrderRosterWeekSundayKey(new Date());
        const { data: pendingRows } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, scheduled_delivery_date')
            .eq('client_id', clientId)
            .eq('service_type', 'Produce')
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(20);

        const pending = (pendingRows || []).find((o) =>
            isDateKeyInRosterWeek(String(o.scheduled_delivery_date ?? '').slice(0, 10), rosterSun)
        );

        if (!pending) {
            return {
                success: false,
                error:
                    'No weekly produce order was found for this client. Orders are created automatically after each week\'s cutoff. Please contact support if you need help.'
            };
        }

        const proofTime =
            proofCapturedAtIso && !Number.isNaN(Date.parse(proofCapturedAtIso))
                ? new Date(proofCapturedAtIso)
                : new Date();
        const fin = await applyProduceProofToOrderRow(supabaseAdmin, pending.id, urls, {
            keepScheduledDate: true,
            proofTime,
        });
        if (!fin.success) {
            return { success: false, error: fin.error || 'Failed to update produce order' };
        }

        return {
            success: true,
            order: {
                id: pending.id,
                orderNumber: pending.order_number,
                clientName: client.full_name,
                address: client.address || 'Unknown Address',
                deliveryDate: String(pending.scheduled_delivery_date ?? '').slice(0, 10),
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
