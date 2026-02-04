/**
 * Utility script to create a complex client, order, and stop
 * 
 * Usage:
 *   npx tsx scripts/create-complete-stop.ts
 * 
 * Or modify the script to accept command-line arguments
 */

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface CreateComplexStopOptions {
    clientName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phoneNumber?: string;
    serviceType?: 'Food' | 'Boxes';
    deliveryDate?: Date;
    isComplex?: boolean;
    statusId?: string;
    navigatorId?: string;
}

/**
 * Creates a complex stop by:
 * 1. Creating a complex client (with complex: true)
 * 2. Creating an upcoming order
 * 3. Creating a stop (will be marked as complex during route processing)
 */
export async function createComplexStop(options: CreateComplexStopOptions) {
    const {
        clientName,
        address,
        city,
        state,
        zip,
        phoneNumber,
        serviceType = 'Food',
        deliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        isComplex = true,
        statusId,
        navigatorId
    } = options;

    try {
        // Get default status and navigator if not provided
        let finalStatusId = statusId;
        let finalNavigatorId = navigatorId;

        if (!finalStatusId) {
            const { data: statuses } = await supabase
                .from('client_statuses')
                .select('id')
                .limit(1)
                .single();
            finalStatusId = statuses?.id;
            if (!finalStatusId) {
                throw new Error('No client status found. Please create a status first or provide statusId.');
            }
        }

        if (!finalNavigatorId) {
            const { data: navigators } = await supabase
                .from('navigators')
                .select('id')
                .eq('is_active', true)
                .limit(1)
                .single();
            finalNavigatorId = navigators?.id || null;
        }

        // Step 1: Create client
        console.log('Step 1: Creating client...');
        const clientId = randomUUID();
        const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
        const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][deliveryDate.getDay()];

        const { data: client, error: clientError } = await supabase
            .from('clients')
            .insert({
                id: clientId,
                full_name: clientName,
                address: address,
                city: city,
                state: state,
                zip: zip,
                phone_number: phoneNumber || null,
                service_type: serviceType,
                status_id: finalStatusId,
                navigator_id: finalNavigatorId,
                delivery: true,  // Required for stops
                paused: false,   // Required for stops
                complex: isComplex,  // Set to true for complex stops
                approved_meals_per_week: serviceType === 'Food' ? 21 : null,
                upcoming_order: {}
            })
            .select()
            .single();

        if (clientError || !client) {
            throw new Error(`Failed to create client: ${clientError?.message}`);
        }

        console.log(`✓ Client created: ${client.id} (${client.full_name})`);

        // Step 2: Create upcoming order
        console.log('Step 2: Creating upcoming order...');
        const upcomingOrderId = randomUUID();

        const { data: upcomingOrder, error: orderError } = await supabase
            .from('upcoming_orders')
            .insert({
                id: upcomingOrderId,
                client_id: clientId,
                service_type: serviceType,
                scheduled_delivery_date: deliveryDateStr,
                delivery_day: dayOfWeek,
                status: 'pending',
                items: serviceType === 'Food' ? {} : null,
                box_orders: serviceType === 'Boxes' ? [] : null
            })
            .select()
            .single();

        if (orderError || !upcomingOrder) {
            throw new Error(`Failed to create upcoming order: ${orderError?.message}`);
        }

        console.log(`✓ Upcoming order created: ${upcomingOrder.id} (${deliveryDateStr})`);

        // Step 3: Create stop
        console.log('Step 3: Creating stop...');
        const stopId = randomUUID();

        const { data: stop, error: stopError } = await supabase
            .from('stops')
            .insert({
                id: stopId,
                day: dayOfWeek,
                delivery_date: deliveryDateStr,
                client_id: clientId,
                order_id: upcomingOrderId,
                name: clientName,
                address: address,
                city: city,
                state: state,
                zip: zip,
                phone: phoneNumber || null,
                completed: false, // Default to false
                assigned_driver_id: null
                // Note: Stop will be marked as complex during route processing based on client.complex
            })
            .select()
            .single();

        if (stopError || !stop) {
            // If duplicate key error, try to update existing stop
            if (stopError?.code === '23505' || stopError?.message?.includes('duplicate')) {
                console.log('Stop already exists, updating...');
                const { data: existingStop } = await supabase
                    .from('stops')
                    .select('id')
                    .eq('client_id', clientId)
                    .eq('delivery_date', deliveryDateStr)
                    .single();

                if (existingStop) {
                    const { data: updatedStop, error: updateError } = await supabase
                        .from('stops')
                        .update({
                            order_id: upcomingOrderId,
                            name: clientName,
                        address: address,
                        city: city,
                        state: state,
                        zip: zip,
                        phone: phoneNumber || null
                        // Note: Stop will be marked as complex during route processing
                        })
                        .eq('id', existingStop.id)
                        .select()
                        .single();

                    if (updateError || !updatedStop) {
                        throw new Error(`Failed to update existing stop: ${updateError?.message}`);
                    }

                    console.log(`✓ Stop updated: ${updatedStop.id} (completed: ${updatedStop.completed})`);
                    return {
                        client,
                        upcomingOrder,
                        stop: updatedStop
                    };
                }
            }
            throw new Error(`Failed to create stop: ${stopError?.message}`);
        }

        console.log(`✓ Stop created: ${stop.id} (will be marked as complex during route processing)`);

        return {
            client,
            upcomingOrder,
            stop
        };

    } catch (error: any) {
        console.error('Error creating complex stop:', error.message);
        throw error;
    }
}

// Example usage (uncomment to run directly)
/*
async function main() {
    try {
        const result = await createComplexStop({
            clientName: 'Test Complex Stop Client',
            address: '123 Test Street',
            city: 'Test City',
            state: 'NY',
            zip: '12345',
            phoneNumber: '555-1234',
            serviceType: 'Food',
            deliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
            isComplex: true
        });

        console.log('\n✅ Success! Created complex stop:');
        console.log('Client ID:', result.client.id);
        console.log('Client Complex:', result.client.complex);
        console.log('Order ID:', result.upcomingOrder.id);
        console.log('Stop ID:', result.stop.id);
        console.log('Note: Stop will be marked as complex during route processing');
    } catch (error) {
        console.error('Failed to create complex stop:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
*/

export default createComplexStop;
