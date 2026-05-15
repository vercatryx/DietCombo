'use server';

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
import { ordersRowTouch } from '@/lib/orders-row-touch';
import { proofPayloadForDb } from '@/lib/proof-of-delivery-urls';
import {
    addCalendarDaysAppTz,
    getProduceOrderRosterWeekSundayKey,
    isDateKeyInRosterWeek,
} from '@/lib/produce-roster-week';
import { isProduceServiceType } from '@/lib/isProduceServiceType';

export async function applyProduceProofToOrderRow(
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

async function getProduceVerifyWeekMondayLabel(): Promise<string> {
    const rosterSun = getProduceOrderRosterWeekSundayKey(new Date());
    const mondayKey = addCalendarDaysAppTz(rosterSun, 1);
    const mondayAnchor = easternWallClockToUtcInstant(mondayKey, 12, 0, 0, 0);
    return formatInAppTz(mondayAnchor, {
        timeZone: APP_TIMEZONE,
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
}

const SCAN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve legacy `/produce/[scanId]` links to a **Driver Delivery** path segment:
 * `/delivery/{segment}` where `segment` is the Produce order number when possible, else order UUID.
 * Accepts Produce **order id**, **order #**, or legacy **client id** (only when a matching pending Produce order exists).
 */
export async function getProduceScanContext(scanId: string): Promise<{
    success: boolean;
    /** Pass to `redirect(\`/delivery/${encodeURIComponent(segment)}\`)`. */
    deliveryPathSegment?: string;
    clientName?: string;
    error?: string;
}> {
    const trimmed = String(scanId ?? '').trim();
    if (!trimmed) {
        return { success: false, error: 'Missing id' };
    }

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!
    );

    const rosterSun = getProduceOrderRosterWeekSundayKey(new Date());

    const buildClientPayload = async (clientId: string) => {
        const { data: client, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('full_name')
            .eq('id', clientId)
            .single();
        if (clientError || !client) return { ok: false as const, error: 'Client not found' };
        return { ok: true as const, client: { full_name: client.full_name || 'Client' } };
    };

    const attachOrderIfProducePending = async (ord: {
        id: string;
        client_id: string;
        service_type: string;
        status: string;
        scheduled_delivery_date: unknown;
        order_number?: unknown;
    }) => {
        if (!isProduceServiceType(ord.service_type)) {
            return { success: false, error: 'This link is not for a Produce order.' };
        }
        if (String(ord.status).toLowerCase() !== 'pending') {
            return { success: false, error: 'This produce order is not awaiting proof (it may already be processed).' };
        }
        const dk = String(ord.scheduled_delivery_date ?? '').slice(0, 10);
        if (!isDateKeyInRosterWeek(dk, rosterSun)) {
            return {
                success: false,
                error: "This produce order is not for the current delivery week. Use the current week's label or contact support.",
            };
        }
        const built = await buildClientPayload(ord.client_id);
        if (!built.ok) return { success: false, error: built.error };
        const seg =
            ord.order_number != null && String(ord.order_number).trim() !== ''
                ? String(ord.order_number)
                : ord.id;
        return { success: true, deliveryPathSegment: seg, clientName: built.client.full_name };
    };

    try {
        if (SCAN_UUID_RE.test(trimmed)) {
            const { data: ord, error: ordErr } = await supabaseAdmin
                .from('orders')
                .select('id, client_id, service_type, status, scheduled_delivery_date, order_number')
                .eq('id', trimmed)
                .maybeSingle();
            if (ordErr) {
                console.error('[getProduceScanContext] order lookup', ordErr);
                return { success: false, error: 'Failed to look up order' };
            }
            if (ord) {
                return attachOrderIfProducePending(ord);
            }
            const legacy = await getClientForProduce(trimmed);
            if (!legacy.success || !legacy.client) {
                return { success: false, error: legacy.error || 'Client not found' };
            }
            const { data: prows } = await supabaseAdmin
                .from('orders')
                .select('id, order_number, scheduled_delivery_date, service_type')
                .eq('client_id', trimmed)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(25);
            const pend = (prows || []).find(
                (o) =>
                    isProduceServiceType(o.service_type) &&
                    isDateKeyInRosterWeek(String(o.scheduled_delivery_date ?? '').slice(0, 10), rosterSun)
            );
            if (!pend) {
                return {
                    success: false,
                    error:
                        'No pending Produce order for this client this week. Use Driver Delivery and enter the order number from the label.',
                };
            }
            const seg =
                pend.order_number != null && String(pend.order_number).trim() !== ''
                    ? String(pend.order_number)
                    : pend.id;
            return { success: true, deliveryPathSegment: seg, clientName: legacy.client.full_name };
        }

        if (/^\d+$/.test(trimmed)) {
            const n = parseInt(trimmed, 10);
            const { data: rows, error: numErr } = await supabaseAdmin
                .from('orders')
                .select('id, client_id, service_type, status, scheduled_delivery_date, order_number')
                .eq('order_number', n)
                .eq('status', 'pending')
                .order('created_at', { ascending: false })
                .limit(25);
            if (numErr) {
                console.error('[getProduceScanContext] order number lookup', numErr);
                return { success: false, error: 'Failed to look up order number' };
            }
            const match = (rows || []).find(
                (o) =>
                    isProduceServiceType(o.service_type) &&
                    isDateKeyInRosterWeek(String(o.scheduled_delivery_date ?? '').slice(0, 10), rosterSun)
            );
            if (match) {
                return attachOrderIfProducePending(match);
            }
            return {
                success: false,
                error: `No pending Produce order #${n} for the current delivery week. Check the order number or use the QR on this week's label.`,
            };
        }

        return {
            success: false,
            error: 'Invalid link. Use the QR on the label (order link) or a valid client id.',
        };
    } catch (e: any) {
        console.error('[getProduceScanContext]', e);
        return { success: false, error: e?.message || 'Failed to load produce scan context' };
    }
}

/**
 * Load client info for the produce flow (no order created).
 * `deliveryDateLabel` is the Monday of the current roster week — context before any proof exists.
 * Proof timing after upload is handled by the shared Driver Delivery flow (`processDeliveryProofFromFormData`).
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

        const deliveryDateLabel = await getProduceVerifyWeekMondayLabel();

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
 * Create a new Produce order for a client (legacy: creates order upfront without proof).
 * Prefer weekly auto-orders plus Driver Delivery proof upload so orders are not left pending without proof.
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
