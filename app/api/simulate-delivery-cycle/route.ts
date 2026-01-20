import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getCurrentTime } from '@/lib/time';
import { getMenuItems, getSettings, getVendors, getStatuses } from '@/lib/actions';
// import { isDeliveryDateLocked, getLockedWeekDescription, getEarliestEffectiveDate } from '@/lib/weekly-lock';
import { getNextDeliveryDateForDay, formatDateToYYYYMMDD } from '@/lib/order-dates';
import { randomUUID } from 'crypto';

/**
 * API Route: Simulate Delivery Cycle
 * 
 * POST /api/simulate-delivery-cycle
 * 
 * Logic:
 * 1. Find ALL Upcoming Orders with status 'scheduled' (no date filtering - they are templates).
 * 2. For each match:
 *    - Calculate the actual delivery date from delivery_day (day of week).
 *    - Create a new Order in 'orders' table with the calculated delivery date.
 *    - Status = 'waiting_for_proof'.
 *    - Maintain link to Client (client_id).
 *    - Copy all vendor selections/items/boxes.
 * 3. Do NOT modify the original Upcoming Order (it remains as a template).
 */
export async function POST(request: NextRequest) {
    try {
        // 1. Fetch ALL scheduled Upcoming Orders (they are templates, no date filtering)
        const { data: upcomingOrders, error: fetchError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('status', 'scheduled')
            .order('delivery_day', { ascending: true });

        if (fetchError) {
            throw new Error(`Failed to fetch upcoming orders: ${fetchError.message}`);
        }

        if (!upcomingOrders || upcomingOrders.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No scheduled upcoming orders found.',
                totalFound: 0,
                processedCount: 0,
                skippedCount: 0
            });
        }

        let processedCount = 0;
        let skippedCount = 0;
        let ineligibleCount = 0;
        const errors: string[] = [];
        const skippedReasons: string[] = [];
        const debugLogs: string[] = []; // Collect logs to return in response

        // Fetch menu items to get correct prices
        const menuItems = await getMenuItems();
        console.log(`[Simulate Delivery] Loaded ${menuItems.length} menu items for price lookup`);
        debugLogs.push(`Loaded ${menuItems.length} menu items for price lookup`);

        console.log(`[Simulate Delivery] Found ${upcomingOrders.length} upcoming orders to process`);
        debugLogs.push(`Found ${upcomingOrders.length} upcoming orders to process`);

        // Fetch statuses to check eligibility
        const statuses = await getStatuses();
        const statusMap = new Map(statuses.map(s => [s.id, s.deliveriesAllowed]));
        debugLogs.push(`Loaded ${statuses.length} statuses`);

        // Fetch all clients to check their status and creation time
        // WE MUST FETCH ALL CLIENTS to filter by status, as upcoming_orders doesn't have status info
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, status_id, created_at');

        if (clientsError) {
            console.error('Error fetching clients for status check:', clientsError);
            // Proceeding but warning
            errors.push(`Error fetching clients: ${clientsError.message}`);
        }

        const clientDataMap = new Map(clients?.map(c => [c.id, { status_id: c.status_id, created_at: c.created_at }]) || []);
        debugLogs.push(`Loaded ${clients?.length || 0} clients for status/age verification`);

        // Get the starting order number (ensures at least 6 digits, starting from 100000)
        const { data: maxOrderData } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();

        const { data: maxUpcomingData } = await supabase
            .from('upcoming_orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();

        const maxOrderNum = maxOrderData?.order_number || 0;
        const maxUpcomingNum = maxUpcomingData?.order_number || 0;
        const maxNum = Math.max(maxOrderNum, maxUpcomingNum);

        // Start from max + 1, ensuring at least 6 digits (100000 = 6 digits minimum)
        let nextOrderNumber = Math.max(100000, maxNum + 1);

        for (const upOrder of upcomingOrders) {
            console.log(`[Simulate Delivery] Processing upcoming order ${upOrder.id} (client: ${upOrder.client_id}, delivery_day: ${upOrder.delivery_day || 'null'})`);

            // CHECK ELIGIBILITY
            const clientData = clientDataMap.get(upOrder.client_id);
            if (clientData) {
                const isAllowed = statusMap.get(clientData.status_id);
                if (isAllowed === false) { // Explicitly false, enabled defaults to true often but let's be strict
                    const skipMsg = `Order ${upOrder.id}: Client ${upOrder.client_id} has status which disallows deliveries.`;
                    console.log(`[Simulate Delivery] IGNORED (Ineligible Status): ${skipMsg}`);
                    // skippedReasons.push(skipMsg); // User requested these not be considered skips
                    ineligibleCount++;
                    continue;
                }
            } else {
                console.warn(`[Simulate Delivery] Warning: Client ${upOrder.client_id} not found in client list or has no status.`);
            }

            // Fetch vendors for cutoff checks
            const vendors = await getVendors();

            // --------------------------------------------------------------------------------
            // TIMING & CUTOFF LOGIC (Next Week Only + Strict Cutoff)
            // --------------------------------------------------------------------------------

            // 1. Determine "Next Week" Delivery Date
            // --------------------------------------------------------------------------------
            // TIMING & CUTOFF LOGIC (Just-In-Time / JIT)
            // --------------------------------------------------------------------------------

            // 1. Determine Immediate Next Delivery Date
            // We look for the NEXT occurrence of the day, starting from today.
            const { getNextOccurrence } = await import('@/lib/order-dates');
            const currentTime = await getCurrentTime();

            // Try to determine delivery_day if it's null
            let deliveryDay = upOrder.delivery_day;
            let inferenceAttempted = false;
            let inferenceFailureReason = '';
            
            if (!deliveryDay || deliveryDay.trim() === '') {
                console.warn(`[Simulate Delivery] Order ${upOrder.id} has null/empty delivery_day. Attempting to infer from vendor data...`);
                inferenceAttempted = true;
                
                // Try to infer delivery_day from vendor selections
                if (upOrder.service_type === 'Food') {
                    const { data: vendorSelections } = await supabase
                        .from('upcoming_order_vendor_selections')
                        .select('vendor_id')
                        .eq('upcoming_order_id', upOrder.id);

                    if (!vendorSelections || vendorSelections.length === 0) {
                        inferenceFailureReason = 'No vendor selections found for Food order';
                    } else {
                        // Try all vendor selections to find one with deliveryDays
                        let foundDeliveryDay = false;
                        for (const vs of vendorSelections) {
                            if (!vs.vendor_id) continue;
                            
                            const vendor = vendors.find(v => v.id === vs.vendor_id);
                            if (!vendor) {
                                inferenceFailureReason = `Vendor ${vs.vendor_id} not found in vendor list`;
                                continue;
                            }
                            
                            if (!vendor.deliveryDays || vendor.deliveryDays.length === 0) {
                                inferenceFailureReason = `Vendor ${vs.vendor_id} (${vendor.name || 'Unknown'}) has no delivery_days configured`;
                                continue;
                            }
                            
                            // Use the first delivery day from the vendor
                            deliveryDay = vendor.deliveryDays[0];
                            foundDeliveryDay = true;
                            console.log(`[Simulate Delivery] Inferred delivery_day "${deliveryDay}" from vendor ${vs.vendor_id} (${vendor.name || 'Unknown'}) for order ${upOrder.id}`);
                            debugLogs.push(`Order ${upOrder.id}: Inferred delivery_day "${deliveryDay}" from vendor ${vs.vendor_id}`);
                            
                            // Update the upcoming_order with the inferred delivery_day
                            await supabase
                                .from('upcoming_orders')
                                .update({ delivery_day: deliveryDay })
                                .eq('id', upOrder.id);
                            break;
                        }
                        
                        if (!foundDeliveryDay && !inferenceFailureReason) {
                            inferenceFailureReason = 'None of the vendors have delivery_days configured';
                        }
                    }
                } else if (upOrder.service_type === 'Boxes') {
                    const { data: boxSelections } = await supabase
                        .from('upcoming_order_box_selections')
                        .select('vendor_id')
                        .eq('upcoming_order_id', upOrder.id);

                    if (!boxSelections || boxSelections.length === 0) {
                        inferenceFailureReason = 'No box selections found for Boxes order';
                    } else {
                        // Try all box selections to find one with deliveryDays
                        let foundDeliveryDay = false;
                        for (const bs of boxSelections) {
                            if (!bs.vendor_id) continue;
                            
                            const vendor = vendors.find(v => v.id === bs.vendor_id);
                            if (!vendor) {
                                inferenceFailureReason = `Vendor ${bs.vendor_id} not found in vendor list`;
                                continue;
                            }
                            
                            if (!vendor.deliveryDays || vendor.deliveryDays.length === 0) {
                                inferenceFailureReason = `Vendor ${bs.vendor_id} (${vendor.name || 'Unknown'}) has no delivery_days configured`;
                                continue;
                            }
                            
                            // Use the first delivery day from the vendor
                            deliveryDay = vendor.deliveryDays[0];
                            foundDeliveryDay = true;
                            console.log(`[Simulate Delivery] Inferred delivery_day "${deliveryDay}" from vendor ${bs.vendor_id} (${vendor.name || 'Unknown'}) for order ${upOrder.id}`);
                            debugLogs.push(`Order ${upOrder.id}: Inferred delivery_day "${deliveryDay}" from vendor ${bs.vendor_id}`);
                            
                            // Update the upcoming_order with the inferred delivery_day
                            await supabase
                                .from('upcoming_orders')
                                .update({ delivery_day: deliveryDay })
                                .eq('id', upOrder.id);
                            break;
                        }
                        
                        if (!foundDeliveryDay && !inferenceFailureReason) {
                            inferenceFailureReason = 'None of the vendors have delivery_days configured';
                        }
                    }
                } else if (upOrder.service_type === 'Equipment') {
                    // Equipment orders might have vendor info in notes
                    inferenceFailureReason = 'Equipment orders require manual delivery_day configuration';
                } else {
                    inferenceFailureReason = `Unknown service type: ${upOrder.service_type}`;
                }
            }

            // Validate delivery_day before attempting to calculate date
            if (!deliveryDay || deliveryDay.trim() === '') {
                let errorMsg: string;
                let skipReason: string;
                
                if (inferenceAttempted) {
                    errorMsg = `Cannot calculate delivery date for order ${upOrder.id}: delivery_day is null. Inference failed - ${inferenceFailureReason || 'Unknown reason'}.`;
                    skipReason = `Order ${upOrder.id}: Missing delivery_day. ${inferenceFailureReason || 'Could not infer from vendor data'}. Please set delivery_day manually in the upcoming order or ensure vendors have delivery_days configured.`;
                } else {
                    errorMsg = `Cannot calculate delivery date for order ${upOrder.id}: delivery_day is null or empty.`;
                    skipReason = `Order ${upOrder.id}: Missing delivery_day. Please set delivery_day manually in the upcoming order.`;
                }
                
                console.warn(`[Simulate Delivery] SKIPPED: ${errorMsg}`);
                errors.push(errorMsg);
                skippedReasons.push(skipReason);
                skippedCount++;
                continue;
            }

            const nextDeliveryDate = getNextOccurrence(deliveryDay || '', currentTime);

            if (!nextDeliveryDate) {
                // This should rarely happen if delivery_day is valid, but handle it anyway
                const errorMsg = `Cannot calculate delivery date for order ${upOrder.id}: delivery_day "${deliveryDay}" is not a valid day name (must be one of: Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday)`;
                console.warn(`[Simulate Delivery] SKIPPED: ${errorMsg}`);
                errors.push(errorMsg);
                skippedReasons.push(`Order ${upOrder.id}: Invalid delivery_day "${deliveryDay}" - must be a valid day name`);
                skippedCount++;
                continue;
            }

            const deliveryDateStr = formatDateToYYYYMMDD(nextDeliveryDate);
            const deliveryDateLog = nextDeliveryDate.toDateString();

            // 2. JIT Cutoff Check
            // Rule: Create order ONLY if (DeliveryDate - Now) <= Max(VendorCutoffs)
            // If we are "too early" (TimeRemaining > Cutoff), we SKIP.
            // If we are "within window" (TimeRemaining <= Cutoff), we CREATE.

            // Calculate 'Time Remaining' until the delivery date (using 00:00 of delivery day as target, or end of day?)
            // User requirement: "Orders that are too early will be skipped."
            // "Create order if (DeliveryDate - Now) <= VendorCutoff"
            // Let's treat "DeliveryDate" as the start of the delivery day (00:00).
            // So if Delivery is Friday 00:00, and Cutoff is 48h. We trigger at Wednesday 00:00.

            const timeRemainingMs = nextDeliveryDate.getTime() - currentTime.getTime();
            const timeRemainingHours = timeRemainingMs / (1000 * 60 * 60);

            let maxCutoffHours = 0;
            let hasValidVendor = false; // To ensure we don't proceed without any vendor info

            // Determine max cutoff based on vendors
            if (upOrder.service_type === 'Food') {
                const { data: vendorSelections } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('vendor_id')
                    .eq('upcoming_order_id', upOrder.id);

                if (vendorSelections && vendorSelections.length > 0) {
                    const uniqueVendorIds = Array.from(new Set(vendorSelections.map(vs => vs.vendor_id)));
                    for (const vId of uniqueVendorIds) {
                        const vendor = vendors.find(v => v.id === vId);
                        if (vendor) {
                            hasValidVendor = true;
                            // Track the MAXIMUM cutoff (earliest requirement wins? No, lenient one?)
                            // Wait. User logic: "Create order if (Delivery - Now) <= VendorCutoff"
                            // If Cutoff A = 48h (Trigger 2 days before).
                            // If Cutoff B = 24h (Trigger 1 day before).
                            // If we are 36h away.
                            // 36 <= 48 (A) -> True.
                            // 36 <= 24 (B) -> False.
                            // If we create now, we satisfy A. B gets order early. This is OK.
                            // We must use MAX logic to catch the earliest trigger.
                            const cutoff = vendor.cutoffHours ?? 0;
                            if (cutoff > maxCutoffHours) {
                                maxCutoffHours = cutoff;
                            }
                        }
                    }
                }
            } else if (upOrder.service_type === 'Boxes') {
                const { data: boxSelections } = await supabase
                    .from('upcoming_order_box_selections')
                    .select('vendor_id')
                    .eq('upcoming_order_id', upOrder.id);

                if (!boxSelections || boxSelections.length === 0 || !boxSelections[0].vendor_id) {
                    const skipMsg = `Order ${upOrder.id} (Boxes): No vendor assigned. Skipped.`;
                    console.warn(`[Simulate Delivery] SKIPPED: ${skipMsg}`);
                    skippedReasons.push(skipMsg);
                    skippedCount++;
                    continue;
                }

                const uniqueVendorIds = Array.from(new Set(boxSelections.map(bs => bs.vendor_id).filter(Boolean)));
                for (const vId of uniqueVendorIds) {
                    // @ts-ignore
                    const vendor = vendors.find(v => v.id === vId);
                    if (vendor) {
                        hasValidVendor = true;
                        const cutoff = vendor.cutoffHours ?? 0;
                        if (cutoff > maxCutoffHours) {
                            maxCutoffHours = cutoff;
                        }
                    }
                }
            }

            if (!hasValidVendor) {
                const skipMsg = `Order ${upOrder.id}: No valid vendors found to determine cutoff. Skipped safety.`;
                console.warn(`[Simulate Delivery] SKIPPED: ${skipMsg}`);
                skippedReasons.push(skipMsg);
                skippedCount++;
                continue;
            }

            // Client Age Check
            if (clientData && clientData.created_at) {
                const clientCreatedAt = new Date(clientData.created_at);
                const clientAgeMs = currentTime.getTime() - clientCreatedAt.getTime();
                const clientAgeHours = clientAgeMs / (1000 * 60 * 60);

                // "If the client was created within 48 hours... I mean within the cutoff time."
                // So if Client Age < Max Cutoff Hours, SKIP.
                // e.g. Cutoff 48h. Client created 10h ago. 10 < 48. SKIP.
                if (clientAgeHours < maxCutoffHours) {
                    const skipMsg = `Order ${upOrder.id}: Client created too recently (${clientAgeHours.toFixed(1)}h ago). Requires ${maxCutoffHours}h maturity (Client Cutoff Check).`;
                    console.warn(`[Simulate Delivery] SKIPPED (Client Age): ${skipMsg}`);
                    skippedReasons.push(skipMsg);
                    skippedCount++;
                    continue;
                }
            }

            // Check: Is it too early?
            // If TimeRemaining > MaxCutoff, we generate NOTHING.
            // Example: 96h remaining. MaxCutoff 48h. 96 > 48. Too early.

            // Note: If timeRemaining is negative (Delivery is in past or today), we definitely proceed (it's <= cutoff).
            // But if it's WAY in the past, maybe we should skip? 
            // "Simulate" usually deals with future. But if we missed it?
            // User didn't specify "Too Late" logic here, only "Too Early".
            // Assuming "Too Late" is handled by the fact that `nextDeliveryDate` scans from Today.
            // If `nextDeliveryDate` is Today (0h remaining). 0 <= 48. Create.

            if (timeRemainingHours > maxCutoffHours) {
                const skipMsg = `Order ${upOrder.id}: Too early. Delivery: ${deliveryDateLog} (${timeRemainingHours.toFixed(1)}h away). Max Cutoff: ${maxCutoffHours}h.`;
                console.log(`[Simulate Delivery] SKIPPED (JIT): ${skipMsg}`);
                // Not a warning, just "Waiting".
                // skippedReasons.push(skipMsg); 
                // Don't clutter skippedReasons with "Waiting" unless requested? 
                // User said "Orders that are too early will be skipped."
                // I'll log it but maybe not count as "Skipped" in the error report sense?
                // Let's count it as valid skip.
                skippedCount++;
                continue;
            }

            console.log(`[Simulate Delivery] Order ${upOrder.id}: JIT Triggered! Delivery: ${deliveryDateLog} (${timeRemainingHours.toFixed(1)}h away) <= Cutoff: ${maxCutoffHours}h`);


            // If we get here, the order is valid for Creation
            const deliveryDate = nextDeliveryDate; // Set for downstream usage

            const logMsg = `[Simulate Delivery] Upcoming order ${upOrder.id} has total_value: ${upOrder.total_value}, total_items: ${upOrder.total_items}`;
            console.log(logMsg);
            debugLogs.push(logMsg);

            // For Food orders, create a separate order for each vendor
            // For Box orders, create one order (typically one vendor per box order)
            if (upOrder.service_type === 'Food') {
                const { data: vendorSelections } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('*')
                    .eq('upcoming_order_id', upOrder.id);

                const logMsg3 = `[Simulate Delivery] Processing Food order - found ${vendorSelections?.length || 0} vendor selections`;
                console.log(logMsg3);
                debugLogs.push(logMsg3);

                if (!vendorSelections || vendorSelections.length === 0) {
                    const skipMsg = `Order ${upOrder.id}: No vendor selections found for Food order`;
                    console.warn(`[Simulate Delivery] SKIPPED: ${skipMsg}`);
                    skippedReasons.push(skipMsg);
                    skippedCount++;
                    continue;
                }

                // Create a separate order for each vendor
                for (const vs of vendorSelections) {
                    // Check for duplicates: Does an order with this client_id, delivery date, and vendor already exist?
                    // First, get all orders for this client and delivery date
                    const { data: existingOrders, error: ordersError } = await supabase
                        .from('orders')
                        .select('id')
                        .eq('client_id', upOrder.client_id)
                        .eq('scheduled_delivery_date', deliveryDateStr)
                        .eq('service_type', 'Food');

                    if (ordersError) {
                        errors.push(`Error checking duplicates for order ${upOrder.id} vendor ${vs.vendor_id}: ${ordersError.message}`);
                    }

                    // If orders exist, check if any have a vendor selection for this vendor
                    if (existingOrders && existingOrders.length > 0) {
                        const orderIds = existingOrders.map(o => o.id);
                        const { data: existingVendorSelections, error: vsError } = await supabase
                            .from('order_vendor_selections')
                            .select('order_id')
                            .in('order_id', orderIds)
                            .eq('vendor_id', vs.vendor_id)
                            .limit(1);

                        if (vsError) {
                            errors.push(`Error checking vendor selections for order ${upOrder.id} vendor ${vs.vendor_id}: ${vsError.message}`);
                        }

                        if (existingVendorSelections && existingVendorSelections.length > 0) {
                            const skipMsg = `Order ${upOrder.id}: Duplicate order already exists for client ${upOrder.client_id}, vendor ${vs.vendor_id} on ${deliveryDateStr}`;
                            console.warn(`[Simulate Delivery] SKIPPED: ${skipMsg}`);
                            skippedReasons.push(skipMsg);
                            skippedCount++;
                            continue;
                        }
                    }

                    const logMsg5 = `[Simulate Delivery] Creating separate order for vendor selection ${vs.id} (vendor: ${vs.vendor_id})`;
                    console.log(logMsg5);
                    debugLogs.push(logMsg5);

                    // Get items for this vendor selection to calculate total
                    const { data: items } = await supabase
                        .from('upcoming_order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);

                    // Calculate total for this vendor's items
                    let vendorTotal = 0;
                    let vendorItemCount = 0;
                    if (items) {
                        for (const item of items) {
                            if (item.menu_item_id === null) continue; // Skip total items
                            const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                            const correctPrice = menuItem?.priceEach ?? parseFloat(item.unit_value?.toString() || '0');
                            vendorTotal += correctPrice * item.quantity;
                            vendorItemCount += item.quantity;
                        }
                    }

                    // Create Order for this vendor
                    const orderData: any = {
                        id: randomUUID(),
                        client_id: upOrder.client_id,
                        service_type: upOrder.service_type,
                        case_id: upOrder.case_id || `CASE-${Date.now()}-${processedCount}-${vs.vendor_id.substring(0, 8)}`,
                        status: 'scheduled',
                        scheduled_delivery_date: deliveryDateStr,
                        delivery_distribution: upOrder.delivery_distribution,
                        total_value: vendorTotal, // Will be recalculated after items are copied
                        total_items: vendorItemCount,
                        notes: upOrder.notes,
                        order_number: nextOrderNumber,
                        created_at: (await getCurrentTime()).toISOString(),
                        last_updated: (await getCurrentTime()).toISOString(),
                        updated_by: upOrder.updated_by
                    };

                    const { data: newOrder, error: insertError } = await supabase
                        .from('orders')
                        .insert(orderData)
                        .select()
                        .single();

                    if (insertError || !newOrder) {
                        const errorMsg = `Failed to create order for client ${upOrder.client_id}, vendor ${vs.vendor_id}: ${insertError?.message}`;
                        console.error(`[Simulate Delivery] ERROR: ${errorMsg}`);
                        errors.push(errorMsg);
                        skippedReasons.push(`Order ${upOrder.id}: Failed to create for vendor ${vs.vendor_id} - ${insertError?.message || 'Unknown error'}`);
                        skippedCount++;
                        continue;
                    }

                    console.log(`[Simulate Delivery] SUCCESS: Created order ${newOrder.id} (Order #${nextOrderNumber}) for client ${upOrder.client_id}, vendor ${vs.vendor_id} with delivery date ${deliveryDateStr}`);

                    // Create vendor selection for this order
                    const vendorSelectionId = randomUUID();
                    
                    // Validate UUID was generated and is a valid string
                    if (!vendorSelectionId || typeof vendorSelectionId !== 'string' || vendorSelectionId.trim() === '') {
                        const errorMsg = `[Simulate Delivery] Failed to generate UUID for vendor selection (order ${newOrder.id}, vendor ${vs.vendor_id}). Generated value: ${vendorSelectionId}`;
                        console.error(errorMsg);
                        debugLogs.push(errorMsg);
                        errors.push(errorMsg);
                        continue;
                    }
                    
                    // Ensure UUID is trimmed and valid format (should be 36 chars with dashes)
                    const trimmedId = vendorSelectionId.trim();
                    if (trimmedId.length !== 36 || !trimmedId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
                        const errorMsg = `[Simulate Delivery] Invalid UUID format for vendor selection (order ${newOrder.id}, vendor ${vs.vendor_id}). Generated: ${trimmedId}`;
                        console.error(errorMsg);
                        debugLogs.push(errorMsg);
                        errors.push(errorMsg);
                        continue;
                    }
                    
                    console.log(`[Simulate Delivery] Creating vendor selection with id: ${trimmedId} for order ${newOrder.id}, vendor ${vs.vendor_id}`);
                    
                    const insertData = {
                        id: trimmedId,
                        order_id: newOrder.id,
                        vendor_id: vs.vendor_id
                    };
                    
                    console.log(`[Simulate Delivery] Insert data:`, JSON.stringify(insertData));
                    
                    const { data: newVs, error: vsError } = await supabase
                        .from('order_vendor_selections')
                        .insert(insertData)
                        .select()
                        .single();

                    if (vsError || !newVs) {
                        const errorMsg = `[Simulate Delivery] Error creating vendor selection (id: ${trimmedId}, order: ${newOrder.id}, vendor: ${vs.vendor_id}): ${vsError?.message || 'Unknown error'}`;
                        console.error(errorMsg);
                        console.error(`[Simulate Delivery] Insert data was:`, insertData);
                        console.error(`[Simulate Delivery] Full error object:`, vsError);
                        debugLogs.push(errorMsg);
                        errors.push(errorMsg);
                        continue;
                    }

                    // Copy items for this vendor
                    let calculatedTotalFromItems = 0;
                    if (items) {
                        for (const item of items) {
                            // Skip total items (menu_item_id is null)
                            if (item.menu_item_id === null) {
                                const skipMsg = `[Simulate Delivery] Skipping total item with null menu_item_id: total_value=${item.total_value}`;
                                console.log(skipMsg);
                                debugLogs.push(skipMsg);
                                continue;
                            }

                            // Find the menu item to get the correct price
                            const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                            const correctPrice = menuItem?.priceEach ?? parseFloat(item.unit_value?.toString() || '0');

                            const itemInfo = {
                                menu_item_id: item.menu_item_id,
                                menuItemName: menuItem?.name || 'Unknown',
                                quantity: item.quantity,
                                stored_unit_value: item.unit_value,
                                correct_price: correctPrice,
                                menuItemPriceEach: menuItem?.priceEach,
                                menuItemValue: menuItem?.value,
                                stored_total_value: item.total_value
                            };
                            const logMsg7 = `[Simulate Delivery] Copying item: ${JSON.stringify(itemInfo)}`;
                            console.log(logMsg7);
                            debugLogs.push(logMsg7);

                            // Recalculate item total using correct price (priceEach) and quantity
                            const itemTotal = correctPrice * item.quantity;
                            calculatedTotalFromItems += itemTotal;

                            const logMsg8 = `[Simulate Delivery] Calculated item total: ${correctPrice} * ${item.quantity} = ${itemTotal}`;
                            console.log(logMsg8);
                            debugLogs.push(logMsg8);

                            const logMsg9 = `[Simulate Delivery] Running total from items: ${calculatedTotalFromItems}`;
                            console.log(logMsg9);
                            debugLogs.push(logMsg9);

                            const newItem = {
                                order_id: newOrder.id,
                                vendor_selection_id: newVs.id,
                                menu_item_id: item.menu_item_id,
                                quantity: item.quantity,
                                unit_value: correctPrice,
                                total_value: itemTotal
                            };

                            const { error: itemError } = await supabase.from('order_items').insert(newItem);
                            if (itemError) {
                                const errorMsg2 = `[Simulate Delivery] Error inserting item: ${itemError.message}`;
                                console.error(errorMsg2);
                                debugLogs.push(errorMsg2);
                                errors.push(errorMsg2);
                            }
                        }
                    }

                    // Update order total_value if it doesn't match calculated total
                    if (calculatedTotalFromItems > 0 && calculatedTotalFromItems !== vendorTotal) {
                        const logMsg12 = `[Simulate Delivery] Mismatch detected! Updating order total_value from ${vendorTotal} to ${calculatedTotalFromItems}`;
                        console.log(logMsg12);
                        debugLogs.push(logMsg12);

                        const { error: updateError } = await supabase
                            .from('orders')
                            .update({ total_value: calculatedTotalFromItems })
                            .eq('id', newOrder.id);

                        if (updateError) {
                            const errorMsg3 = `[Simulate Delivery] Error updating total_value: ${updateError.message}`;
                            console.error(errorMsg3);
                            debugLogs.push(errorMsg3);
                            errors.push(errorMsg3);
                        } else {
                            const logMsg13 = `[Simulate Delivery] Successfully updated order total_value to ${calculatedTotalFromItems}`;
                            console.log(logMsg13);
                            debugLogs.push(logMsg13);
                        }
                    } else {
                        const logMsg14 = `[Simulate Delivery] Total values match or calculated total is 0, no update needed`;
                        console.log(logMsg14);
                        debugLogs.push(logMsg14);
                    }

                    // Increment order number for next order
                    nextOrderNumber++;
                    processedCount++;
                }
            } else {
                // For Box orders, use the original logic (one order per upcoming order)
                // Check for duplicates: Does an order with this client_id and delivery date already exist?
                const { count: duplicateCount, error: duplicateError } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact', head: true })
                    .eq('client_id', upOrder.client_id)
                    .eq('scheduled_delivery_date', deliveryDateStr);

                if (duplicateError) {
                    errors.push(`Error checking duplicates for order ${upOrder.id}: ${duplicateError.message}`);
                }

                if (duplicateCount && duplicateCount > 0) {
                    const skipMsg = `Order ${upOrder.id}: Duplicate order already exists for client ${upOrder.client_id} on ${deliveryDateStr}`;
                    console.warn(`[Simulate Delivery] SKIPPED: ${skipMsg}`);
                    skippedReasons.push(skipMsg);
                    skippedCount++;
                    continue;
                }

                // Create Order with calculated delivery date
                const orderData: any = {
                    id: randomUUID(),
                    client_id: upOrder.client_id,
                    service_type: upOrder.service_type,
                    case_id: upOrder.case_id || `CASE-${Date.now()}-${processedCount}`,
                    status: 'scheduled',
                    scheduled_delivery_date: deliveryDateStr,
                    delivery_distribution: upOrder.delivery_distribution,
                    total_value: upOrder.total_value,
                    total_items: upOrder.total_items,
                    notes: upOrder.notes,
                    order_number: nextOrderNumber,
                    created_at: (await getCurrentTime()).toISOString(),
                    last_updated: (await getCurrentTime()).toISOString(),
                    updated_by: upOrder.updated_by
                };

                const logMsg2 = `[Simulate Delivery] Creating order with initial total_value: ${orderData.total_value}`;
                console.log(logMsg2);
                debugLogs.push(logMsg2);

                const { data: newOrder, error: insertError } = await supabase
                    .from('orders')
                    .insert(orderData)
                    .select()
                    .single();

                if (insertError || !newOrder) {
                    const errorMsg = `Failed to create order for client ${upOrder.client_id}: ${insertError?.message}`;
                    console.error(`[Simulate Delivery] ERROR: ${errorMsg}`);
                    errors.push(errorMsg);
                    skippedReasons.push(`Order ${upOrder.id}: Failed to create - ${insertError?.message || 'Unknown error'}`);
                    skippedCount++;
                    continue;
                }

                console.log(`[Simulate Delivery] SUCCESS: Created order ${newOrder.id} (Order #${nextOrderNumber}) for client ${upOrder.client_id} with delivery date ${deliveryDateStr}`);

                // 2. Box Selections (Boxes)
                const { data: boxSelections } = await supabase
                    .from('upcoming_order_box_selections')
                    .select('*')
                    .eq('upcoming_order_id', upOrder.id);

                if (boxSelections) {
                    let calculatedTotalFromBoxes = 0;

                    const newBoxSelections = boxSelections.map(bs => {
                        // Calculate value based on contents
                        let boxValue = 0;
                        if (bs.items) {
                            Object.entries(bs.items).forEach(([itemId, qty]) => {
                                // Look up item in menuItems
                                const menuItem = menuItems.find(mi => mi.id === itemId);
                                if (menuItem) {
                                    // Use stored price if available in itemPrices (not yet standard), or current price
                                    // Since we don't have itemPrices on box selection usually, use current price
                                    // Note: bs might have itemPrices if it was stored? The type definition says it might
                                    // But usually it's just {itemId: qty}
                                    const price = menuItem.priceEach || menuItem.value || 0;
                                    boxValue += price * (qty as number);
                                }
                            });
                        }

                        // If no items or value 0, fallback to existing logic or maybe it's a fixed price box?
                        // Assuming strictly per-item value for now based on request.
                        // Only override if we calculated something (or if it was 0 and we want to enforce it)
                        const finalValue = Math.max(boxValue, 0); // Ensure non-negative
                        calculatedTotalFromBoxes += finalValue;

                        return {
                            order_id: newOrder.id,
                            vendor_id: bs.vendor_id,
                            quantity: bs.quantity,
                            unit_value: finalValue, // Set calculated value
                            total_value: finalValue, // Assuming quantity 1 usually? If quantity > 1, multiply?
                            // Wait, bs.quantity is number of boxes.
                            // If boxValue is per box:
                            // total_value = boxValue * bs.quantity
                            items: bs.items
                        };
                    });

                    // Correct the total value calculation for multiple boxes
                    let finalBoxTotal = 0;
                    newBoxSelections.forEach(nbs => {
                        const lineTotal = nbs.unit_value * nbs.quantity; // unit * quantity
                        nbs.total_value = lineTotal;
                        finalBoxTotal += lineTotal;
                    });


                    await supabase.from('order_box_selections').insert(newBoxSelections);

                    // Update order total if needed
                    if (finalBoxTotal > 0 && finalBoxTotal !== upOrder.total_value) {
                        const logMsgBox = `[Simulate Delivery] Box Order Mismatch! Updating total_value from ${upOrder.total_value} to ${finalBoxTotal}`;
                        console.log(logMsgBox);
                        debugLogs.push(logMsgBox);
                        await supabase.from('orders').update({ total_value: finalBoxTotal }).eq('id', newOrder.id);
                    }
                }

                // Increment order number for next order
                nextOrderNumber++;
                processedCount++;
            }
        }

        console.log(`[Simulate Delivery] Complete: ${processedCount} created, ${skippedCount} skipped, ${errors.length} errors`);

        const totalFound = upcomingOrders.length;
        const message = totalFound === 0
            ? 'No scheduled upcoming orders found.'
            : `Simulation complete. Found ${totalFound} upcoming order(s). Created ${processedCount} order(s). Skipped ${skippedCount} order(s). (Ignored ${ineligibleCount} ineligible).`;

        return NextResponse.json({
            success: true,
            message,
            totalFound,
            processedCount,
            skippedCount,
            ineligibleCount,
            errors: errors.length > 0 ? errors : undefined,
            skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined,
            debugLogs: debugLogs.length > 0 ? debugLogs : undefined
        });

    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}

