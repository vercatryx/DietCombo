'use server';

import { uploadFile } from '@/lib/storage';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { saveDeliveryProofUrlAndProcessOrder, getDefaultOrderTemplate, getDefaultVendorId } from '@/lib/actions';
import { roundCurrency } from '@/lib/utils';
import { getNextOccurrence } from '@/lib/order-dates';
import { getCurrentTime } from '@/lib/time';
import { getTodayDateInAppTzAsReference } from '@/lib/timezone';
import { randomUUID } from 'crypto';

export async function processProduceProof(formData: FormData) {
    const file = formData.get('file') as File;
    const orderNumber = formData.get('orderNumber') as string;
    const testUrl = formData.get('testUrl') as string | null; // Optional test URL to bypass R2

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
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
            const buffer = Buffer.from(await file.arrayBuffer());
            const timestamp = Date.now();
            const extension = file.name.split('.').pop();
            const key = `produce-proof-${orderNumber}-${timestamp}.${extension}`;

            await uploadFile(key, buffer, file.type, process.env.R2_DELIVERY_BUCKET_NAME);
            const publicUrlBase = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev';
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
            return { success: true, url: publicUrl };
        }

        // For orders table, update with produce processing status.
        // Set both actual_delivery_date and scheduled_delivery_date to proof upload date (Produce = prompt/realtime).
        const proofUploadTime = new Date();
        const proofUploadDateStr = proofUploadTime.toISOString().split('T')[0];
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
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    try {
        const { data: client, error: clientError } = await supabaseAdmin
            .from('clients')
            .select('id, full_name, address, sign_token')
            .eq('id', clientId)
            .single();

        if (clientError || !client) {
            console.error('[Get Client For Produce] Client not found:', clientError);
            return { success: false, error: 'Client not found' };
        }

        // Produce is prompt/realtime delivery: show today's date as scheduled (not vendor delivery days)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const deliveryDateLabel = today.toISOString().split('T')[0];

        return {
            success: true,
            client: {
                id: client.id,
                full_name: client.full_name,
                address: client.address || 'Unknown Address',
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
        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = Date.now();
        const extension = file.name.split('.').pop() || 'jpg';
        const key = `produce-proof-${clientId}-${timestamp}.${extension}`;

        await uploadFile(key, buffer, file.type, process.env.R2_DELIVERY_BUCKET_NAME);
        const publicUrlBase = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev';
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
        process.env.SUPABASE_SERVICE_ROLE_KEY!
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
        // Delivery date = date when proof image is uploaded (today)
        const uploadDate = new Date();
        uploadDate.setHours(0, 0, 0, 0);
        const deliveryDateStr = uploadDate.toISOString().split('T')[0];

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
        process.env.SUPABASE_SERVICE_ROLE_KEY!
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
            scheduled_delivery_date: scheduledDeliveryDate.toISOString().split('T')[0],
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
