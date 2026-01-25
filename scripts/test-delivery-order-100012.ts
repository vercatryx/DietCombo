/**
 * Test script to process order 100012 through the delivery process
 * with a test URL (bypassing R2 upload)
 * 
 * This script uses the same logic as app/delivery/actions.ts
 * 
 * Usage: npx tsx scripts/test-delivery-order-100012.ts
 */

// Load environment variables FIRST before any other imports
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Try to load .env.local first, then .env
const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
    console.log('✓ Loaded .env.local');
}
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log('✓ Loaded .env');
}

// Verify required env vars
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
    process.exit(1);
}

// Now import other modules
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const TEST_PROOF_URL = 'https://d23xypyp2dkdqm.cloudfront.net/wp-content/uploads/2022/01/31034059/woman-hand-accepting-delivery-boxes-from-deliveryman-1.jpg';
const ORDER_NUMBER = 100012;

function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

async function processDeliveryProofForOrder(orderNumber: number, proofUrl: string) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Verify Order matches (same logic as delivery actions)
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
        if (uuidRegex.test(orderNumber.toString())) {
            const { data: orderById } = await supabaseAdmin
                .from('orders')
                .select('id')
                .eq('id', orderNumber.toString())
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
            if (uuidRegex.test(orderNumber.toString())) {
                const { data: upcomingById } = await supabaseAdmin
                    .from('upcoming_orders')
                    .select('id')
                    .eq('id', orderNumber.toString())
                    .maybeSingle();
                foundOrder = upcomingById;
            }
        }
    }

    if (!foundOrder) {
        throw new Error(`Order not found for OrderNumber: "${orderNumber}" in orders or upcoming_orders`);
    }

    let orderId = foundOrder.id;
    let wasProcessed = false;

    // 2. Process upcoming_orders (same logic as saveDeliveryProofUrlAndProcessOrder)
    if (table === 'upcoming_orders') {
        console.log('📝 Processing as upcoming_order (using saveDeliveryProofUrlAndProcessOrder logic)...');
        
        // Fetch the upcoming order
        const { data: upcomingOrder, error: fetchError } = await supabaseAdmin
            .from('upcoming_orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError || !upcomingOrder) {
            throw new Error('Upcoming order not found: ' + (fetchError?.message || 'Unknown error'));
        }

        // Check if already processed - look for order with same case_id
        if (upcomingOrder.case_id) {
            const { data: existingOrder } = await supabaseAdmin
                .from('orders')
                .select('id')
                .eq('case_id', upcomingOrder.case_id)
                .maybeSingle();

            if (existingOrder) {
                // Already processed, use the existing order ID
                orderId = existingOrder.id;
                wasProcessed = false;
                console.log(`ℹ️  Order already processed, using existing order ID: ${orderId}`);
            } else {
                // Not processed yet, process it now
                console.log(`📦 Creating new Order for Case ${upcomingOrder.case_id} with status 'billing_pending'`);
                console.log(`📋 Copying order_number from upcoming order: ${upcomingOrder.order_number}`);
                
                const currentTime = new Date();
                const orderData: any = {
                    id: randomUUID(),
                    client_id: upcomingOrder.client_id,
                    service_type: upcomingOrder.service_type,
                    case_id: upcomingOrder.case_id,
                    status: 'billing_pending',
                    last_updated: currentTime.toISOString(),
                    updated_by: 'Test Script',
                    scheduled_delivery_date: upcomingOrder.scheduled_delivery_date,
                    delivery_distribution: null,
                    total_value: upcomingOrder.total_value,
                    total_items: upcomingOrder.total_items,
                    notes: upcomingOrder.notes,
                    actual_delivery_date: currentTime.toISOString(),
                    order_number: upcomingOrder.order_number // Copy order_number directly from upcoming_orders
                };

                const { data: newOrder, error: orderError } = await supabaseAdmin
                    .from('orders')
                    .insert(orderData)
                    .select()
                    .single();

                if (orderError || !newOrder) {
                    throw new Error('Failed to create order: ' + (orderError?.message || 'Unknown error'));
                }

                orderId = newOrder.id;
                wasProcessed = true;
                console.log(`✅ Successfully created Order ${newOrder.id}`);

                // Create billing record for the processed order
                const { data: client } = await supabaseAdmin
                    .from('clients')
                    .select('navigator_id, full_name, authorized_amount')
                    .eq('id', upcomingOrder.client_id)
                    .single();

                // Check if billing record already exists for this order
                const { data: existingBilling } = await supabaseAdmin
                    .from('billing_records')
                    .select('id')
                    .eq('order_id', newOrder.id)
                    .maybeSingle();

                if (!existingBilling) {
                    console.log(`📄 Creating Billing Record for ${newOrder.id}`);
                    const { error: billingError } = await supabaseAdmin
                        .from('billing_records')
                        .insert([{
                            client_id: upcomingOrder.client_id,
                            order_id: newOrder.id,
                            status: 'pending',
                            amount: upcomingOrder.total_value || 0,
                            navigator: client?.navigator_id || null,
                            remarks: 'Auto-generated when order processed for delivery'
                        }]);

                    if (billingError) {
                        console.error('⚠️  Warning: Failed to create billing record:', billingError.message);
                    } else {
                        console.log('✅ Billing record created');
                    }
                }

                // Reduce client's authorized amount by the order amount (only if billing record didn't already exist)
                if (!existingBilling && client) {
                    console.log(`💰 Processing deduction for client ${upcomingOrder.client_id}`);
                    const currentAmount = client.authorized_amount ?? 0;
                    const orderAmount = upcomingOrder.total_value || 0;
                    const newAuthorizedAmount = currentAmount - orderAmount;

                    console.log(`   Deducting ${orderAmount} from ${currentAmount}. New amount: ${newAuthorizedAmount}`);

                    const { error: authAmountError } = await supabaseAdmin
                        .from('clients')
                        .update({ authorized_amount: newAuthorizedAmount })
                        .eq('id', upcomingOrder.client_id);

                    if (authAmountError) {
                        console.error('⚠️  Warning: Failed to update authorized amount:', authAmountError.message);
                    } else {
                        console.log('✅ Successfully updated authorized_amount');
                    }
                }

                // Copy vendor selections and items (for Food orders)
                if (upcomingOrder.service_type === 'Food') {
                    console.log('🍽️  Copying vendor selections and items for Food order...');
                    const { data: vendorSelections } = await supabaseAdmin
                        .from('upcoming_order_vendor_selections')
                        .select('*')
                        .eq('upcoming_order_id', upcomingOrder.id);

                    if (vendorSelections) {
                        for (const vs of vendorSelections) {
                            const { data: newVs, error: vsError } = await supabaseAdmin
                                .from('order_vendor_selections')
                                .insert({
                                    order_id: newOrder.id,
                                    vendor_id: vs.vendor_id
                                })
                                .select()
                                .single();

                            if (vsError || !newVs) {
                                console.error(`⚠️  Warning: Failed to copy vendor selection: ${vsError?.message}`);
                                continue;
                            }

                            // Copy items - use upcoming_vendor_selection_id to find items from upcoming orders
                            const { data: items } = await supabaseAdmin
                                .from('upcoming_order_items')
                                .select('*')
                                .eq('upcoming_vendor_selection_id', vs.id);

                            if (items) {
                                console.log(`   📦 Found ${items.length} items for vendor selection ${vs.id}`);
                                for (const item of items) {
                                    // Skip items with null menu_item_id and meal_item_id (these are total items, not actual menu items)
                                    if (!item.menu_item_id && !item.meal_item_id) {
                                        console.log(`   ⏭️  Skipping item with null menu_item_id and meal_item_id (likely a total item)`);
                                        continue;
                                    }

                                    // Build item data with all fields that should be copied
                                    const itemData: any = {
                                        id: randomUUID(),
                                        vendor_selection_id: newVs.id,
                                        quantity: item.quantity
                                    };

                                    // Copy menu_item_id if present (can be null for meal items)
                                    if (item.menu_item_id) {
                                        itemData.menu_item_id = item.menu_item_id;
                                    }

                                    // Copy meal_item_id if present
                                    if (item.meal_item_id) {
                                        itemData.meal_item_id = item.meal_item_id;
                                    }

                                    // Copy notes if present
                                    if (item.notes) {
                                        itemData.notes = item.notes;
                                    }

                                    // Copy custom_name if present
                                    if (item.custom_name) {
                                        itemData.custom_name = item.custom_name;
                                    }

                                    // Copy custom_price if present
                                    if (item.custom_price !== null && item.custom_price !== undefined) {
                                        itemData.custom_price = item.custom_price;
                                    }

                                    const { error: itemError } = await supabaseAdmin
                                        .from('order_items')
                                        .insert(itemData);

                                    if (itemError) {
                                        const errorMsg = `Failed to copy item ${item.menu_item_id || item.meal_item_id || 'unknown'}: ${itemError.message}`;
                                        console.error(`   ⚠️  ${errorMsg}`);
                                    } else {
                                        console.log(`   ✅ Successfully copied item ${item.menu_item_id || item.meal_item_id || 'custom'} (quantity: ${item.quantity})`);
                                    }
                                }
                            } else {
                                console.log(`   ℹ️  No items found for vendor selection ${vs.id}`);
                            }
                        }
                        console.log('✅ Vendor selections and items copied');
                    }
                }

                // Copy box selections (for Box orders)
                if (upcomingOrder.service_type === 'Boxes') {
                    console.log('📦 Copying box selections for Boxes order...');
                    const { data: boxSelections } = await supabaseAdmin
                        .from('upcoming_order_box_selections')
                        .select('*')
                        .eq('upcoming_order_id', upcomingOrder.id);

                    if (boxSelections && boxSelections.length > 0) {
                        // First, copy all box selections
                        for (const bs of boxSelections) {
                            const { error: bsError } = await supabaseAdmin
                                .from('order_box_selections')
                                .insert({
                                    order_id: newOrder.id,
                                    box_type_id: bs.box_type_id,
                                    vendor_id: bs.vendor_id,
                                    quantity: bs.quantity,
                                    unit_value: bs.unit_value || 0,
                                    total_value: bs.total_value || 0,
                                    items: bs.items || {}
                                });

                            if (bsError) {
                                console.error(`⚠️  Warning: Failed to copy box selection: ${bsError.message}`);
                            } else {
                                console.log(`✅ Successfully copied box selection for order ${newOrder.id}`);
                            }
                        }

                        // Then, copy box items from upcoming_order_items (only once, outside the loop)
                        // Box order items have null vendor_selection_id and upcoming_vendor_selection_id
                        const { data: boxItems } = await supabaseAdmin
                            .from('upcoming_order_items')
                            .select('*')
                            .eq('upcoming_order_id', upcomingOrder.id)
                            .is('upcoming_vendor_selection_id', null)
                            .is('vendor_selection_id', null);

                        if (boxItems && boxItems.length > 0) {
                            console.log(`   📦 Found ${boxItems.length} box items to copy for order ${newOrder.id}`);
                            
                            // Get unique vendor IDs from box selections to create vendor selections
                            const uniqueVendorIds = [...new Set(boxSelections.map(bs => bs.vendor_id).filter(Boolean))];
                            
                            // Create vendor selections for each unique vendor (needed for order_items)
                            const vendorSelectionMap = new Map<string, string>();
                            
                            for (const vendorId of uniqueVendorIds) {
                                // Check if vendor selection already exists
                                const { data: existingVs } = await supabaseAdmin
                                    .from('order_vendor_selections')
                                    .select('id')
                                    .eq('order_id', newOrder.id)
                                    .eq('vendor_id', vendorId)
                                    .maybeSingle();

                                if (existingVs) {
                                    vendorSelectionMap.set(vendorId, existingVs.id);
                                } else {
                                    // Create vendor selection for Box orders
                                    const { data: newBoxVs, error: vsError } = await supabaseAdmin
                                        .from('order_vendor_selections')
                                        .insert({
                                            order_id: newOrder.id,
                                            vendor_id: vendorId
                                        })
                                        .select()
                                        .single();

                                    if (vsError || !newBoxVs) {
                                        console.error(`⚠️  Warning: Failed to create vendor selection for vendor ${vendorId}: ${vsError?.message}`);
                                    } else {
                                        vendorSelectionMap.set(vendorId, newBoxVs.id);
                                        console.log(`   ✅ Created vendor selection ${newBoxVs.id} for vendor ${vendorId}`);
                                    }
                                }
                            }

                            // Copy box items to order_items
                            // For box items, we need to determine which vendor selection to use
                            // We'll use the first vendor selection if we can't determine the vendor from the item
                            const firstVendorId = uniqueVendorIds[0];
                            const defaultVsId = firstVendorId ? vendorSelectionMap.get(firstVendorId) : null;

                            if (defaultVsId) {
                                for (const item of boxItems) {
                                    // Skip items with null menu_item_id and meal_item_id
                                    if (!item.menu_item_id && !item.meal_item_id) {
                                        console.log(`   ⏭️  Skipping box item with null menu_item_id and meal_item_id`);
                                        continue;
                                    }

                                    // Try to find the vendor for this item to use the correct vendor selection
                                    // For now, use the default vendor selection (first vendor)
                                    // TODO: If items have vendor_id, use that to find the correct vendor selection
                                    const itemVsId = defaultVsId;

                                    const itemData: any = {
                                        id: randomUUID(),
                                        vendor_selection_id: itemVsId,
                                        quantity: item.quantity
                                    };

                                    if (item.menu_item_id) {
                                        itemData.menu_item_id = item.menu_item_id;
                                    }

                                    if (item.meal_item_id) {
                                        itemData.meal_item_id = item.meal_item_id;
                                    }

                                    if (item.notes) {
                                        itemData.notes = item.notes;
                                    }

                                    if (item.custom_name) {
                                        itemData.custom_name = item.custom_name;
                                    }

                                    if (item.custom_price !== null && item.custom_price !== undefined) {
                                        itemData.custom_price = item.custom_price;
                                    }

                                    const { error: itemError } = await supabaseAdmin
                                        .from('order_items')
                                        .insert(itemData);

                                    if (itemError) {
                                        const errorMsg = `Failed to copy box item ${item.menu_item_id || item.meal_item_id || 'unknown'}: ${itemError.message}`;
                                        console.error(`   ⚠️  ${errorMsg}`);
                                    } else {
                                        console.log(`   ✅ Successfully copied box item ${item.menu_item_id || item.meal_item_id || 'custom'} (quantity: ${item.quantity})`);
                                    }
                                }
                            } else {
                                console.error(`⚠️  Warning: Failed to create vendor selection for box items: No vendor selections available`);
                            }
                        } else {
                            console.log(`   ℹ️  No box items found to copy for order ${newOrder.id}`);
                        }
                        console.log('✅ Box selections copied');
                    } else {
                        console.log(`   ℹ️  No box selections found for upcoming order ${upcomingOrder.id}`);
                    }
                }

                // Update upcoming order status to processed
                await supabaseAdmin
                    .from('upcoming_orders')
                    .update({
                        status: 'processed',
                        processed_order_id: newOrder.id,
                        processed_at: new Date().toISOString()
                    })
                    .eq('id', upcomingOrder.id);
                
                console.log('✅ Updated upcoming_order status to processed');
            }
        } else {
            throw new Error('Upcoming order has no case_id, cannot safely process');
        }
    }

    // 3. Update the order with proof URL (same logic as delivery actions)
    const updateData: any = {
        proof_of_delivery_url: proofUrl,
        updated_by: 'Test Script',
        last_updated: new Date().toISOString()
    };

    // Only update status and actual_delivery_date if order wasn't just processed
    if (!wasProcessed) {
        updateData.status = 'billing_pending';
        updateData.actual_delivery_date = new Date().toISOString();
    }

    const { error: updateError } = await supabaseAdmin
        .from('orders')
        .update(updateData)
        .eq('id', orderId);

    if (updateError) {
        throw new Error('Failed to update order: ' + updateError.message);
    }

    console.log('✅ Order updated with proof URL');

    // 4. Create billing record if it doesn't exist (for orders table, same logic as delivery actions)
    if (table === 'orders' || wasProcessed) {
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
                console.log('📄 Creating billing record...');
                const { error: billingError } = await supabaseAdmin
                    .from('billing_records')
                    .insert([{
                        id: randomUUID(),
                        client_id: orderDetails.client_id,
                        order_id: orderId,
                        status: 'pending',
                        amount: orderDetails.total_value || 0,
                        navigator: client?.navigator_id || null,
                        remarks: 'Auto-generated upon proof upload'
                    }]);

                if (billingError) {
                    console.error('⚠️  Warning: Failed to create billing record:', billingError.message);
                } else {
                    console.log('✅ Billing record created');
                }
            } else {
                console.log('ℹ️  Billing record already exists, skipping creation');
            }

            if (!existingBilling && client) {
                console.log('💰 Updating client authorized amount...');
                const currentAmount = client.authorized_amount ?? 0;
                const orderAmount = orderDetails.total_value || 0;
                const newAuthorizedAmount = roundCurrency(currentAmount - orderAmount);

                const { error: deductionError } = await supabaseAdmin
                    .from('clients')
                    .update({ authorized_amount: newAuthorizedAmount })
                    .eq('id', orderDetails.client_id);

                if (deductionError) {
                    console.error('⚠️  Warning: Failed to update authorized amount:', deductionError.message);
                } else {
                    console.log(`✅ Client authorized amount updated: ${currentAmount} → ${newAuthorizedAmount}`);
                }
            }
        }
    }

    return orderId;
}

async function testDeliveryProcess() {
    console.log(`\n🚀 Starting delivery process test for order ${ORDER_NUMBER}...\n`);

    try {
        // Find the order first to show where it was found
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        console.log(`📋 Looking for order ${ORDER_NUMBER}...`);
        
        let foundOrder: { id: string; order_number: number } | null = null;
        let table: 'orders' | 'upcoming_orders' = 'orders';

        // Try finding in orders
        const { data: orderData } = await supabaseAdmin
            .from('orders')
            .select('id, order_number')
            .eq('order_number', ORDER_NUMBER)
            .maybeSingle();

        if (orderData) {
            foundOrder = orderData;
            console.log(`✅ Found order in 'orders' table: ${foundOrder.id}`);
        }

        // If not found, try upcoming_orders
        if (!foundOrder) {
            table = 'upcoming_orders';
            const { data: upcomingOrder } = await supabaseAdmin
                .from('upcoming_orders')
                .select('id, order_number')
                .eq('order_number', ORDER_NUMBER)
                .maybeSingle();

            if (upcomingOrder) {
                foundOrder = upcomingOrder;
                console.log(`✅ Found order in 'upcoming_orders' table: ${foundOrder.id}`);
            }
        }

        if (!foundOrder) {
            console.error(`❌ Order ${ORDER_NUMBER} not found in either 'orders' or 'upcoming_orders' table`);
            process.exit(1);
        }

        console.log(`\n📦 Processing order ID: ${foundOrder.id}`);
        console.log(`🔗 Using test proof URL: ${TEST_PROOF_URL}\n`);

        // Process the order using the same logic as delivery actions
        const finalOrderId = await processDeliveryProofForOrder(ORDER_NUMBER, TEST_PROOF_URL);

        // 5. Verify the update
        console.log('\n🔍 Verifying update...');
        const { data: updatedOrder } = await supabaseAdmin
            .from('orders')
            .select('id, order_number, proof_of_delivery_url, status, actual_delivery_date')
            .eq('id', finalOrderId)
            .single();

        if (updatedOrder) {
            console.log('\n✅ Verification successful!');
            console.log(`   Order Number: ${updatedOrder.order_number}`);
            console.log(`   Proof URL: ${updatedOrder.proof_of_delivery_url}`);
            console.log(`   Status: ${updatedOrder.status}`);
            console.log(`   Delivery Date: ${updatedOrder.actual_delivery_date}`);
        } else {
            console.log('⚠️  Could not verify update');
        }

        console.log('\n✨ Test completed successfully!\n');
        console.log(`📱 You can view the order at: /delivery/${ORDER_NUMBER}`);
        console.log(`🔗 Proof URL: ${TEST_PROOF_URL}\n`);

    } catch (error: any) {
        console.error('\n❌ Error during test:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run the test
testDeliveryProcess().catch(console.error);
