import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientId, driverId, day, delivery_date } = body;

        if (!clientId) {
            return NextResponse.json(
                { error: 'clientId is required' },
                { status: 400 }
            );
        }

        if (!day) {
            return NextResponse.json(
                { error: 'day is required' },
                { status: 400 }
            );
        }

        // Update the client's assigned_driver_id
        const updatePayload: any = {};

        if (driverId) {
            updatePayload.assigned_driver_id = driverId;
        } else {
            // If driverId is null/empty, unassign the driver
            updatePayload.assigned_driver_id = null;
        }

        const { error: updateError } = await supabase
            .from('clients')
            .update(updatePayload)
            .eq('id', clientId);

        if (updateError) {
            console.error('[assign-client-driver] Error updating client:', updateError);
            return NextResponse.json(
                { error: `Failed to update client: ${updateError.message}` },
                { status: 500 }
            );
        }

        // Now update all existing stops for this client to match the client's driver assignment
        // Build query to find stops for this client
        let stopsQuery = supabase
            .from('stops')
            .select('id')
            .eq('client_id', clientId);

        // Filter by day if provided
        if (day && day !== 'all') {
            stopsQuery = stopsQuery.eq('day', day);
        }

        // Filter by delivery_date if provided
        if (delivery_date) {
            stopsQuery = stopsQuery.eq('delivery_date', delivery_date);
        }

        const { data: stops, error: stopsError } = await stopsQuery;

        if (stopsError) {
            console.warn('[assign-client-driver] Error fetching stops (non-critical):', stopsError);
        }

        // Update all stops to match the client's driver assignment
        let stopsUpdated = 0;
        if (stops && stops.length > 0) {
            const stopIds = stops.map(s => s.id);
            const stopUpdatePayload: any = {};

            if (driverId) {
                stopUpdatePayload.assigned_driver_id = driverId;
            } else {
                stopUpdatePayload.assigned_driver_id = null;
            }

            const { error: stopUpdateError } = await supabase
                .from('stops')
                .update(stopUpdatePayload)
                .in('id', stopIds);

            if (stopUpdateError) {
                console.warn('[assign-client-driver] Error updating stops (non-critical):', stopUpdateError);
            } else {
                stopsUpdated = stopIds.length;
            }
        }

        // driver_route_order: delete from any driver first, then add to new driver (delete-before-add)
        const { error: deleteOrderError } = await supabase
            .from('driver_route_order')
            .delete()
            .eq('client_id', clientId);

        if (deleteOrderError) {
            console.warn('[assign-client-driver] Error deleting from driver_route_order (non-critical):', deleteOrderError);
        }

        if (driverId) {
            // Get next position for this driver (allow duplicate positions; tie-breaker ORDER BY position, client_id)
            const { data: maxRow } = await supabase
                .from('driver_route_order')
                .select('position')
                .eq('driver_id', driverId)
                .order('position', { ascending: false })
                .limit(1)
                .maybeSingle();

            const nextPosition = (maxRow?.position != null ? Number(maxRow.position) + 1 : 1);

            const { error: insertOrderError } = await supabase
                .from('driver_route_order')
                .insert({ driver_id: driverId, client_id: clientId, position: nextPosition });

            if (insertOrderError) {
                console.warn('[assign-client-driver] Error inserting into driver_route_order (non-critical):', insertOrderError);
            }
        }

        return NextResponse.json({
            success: true,
            stopsUpdated: stopsUpdated,
            message: `Updated client assignment${stopsUpdated > 0 ? ` and ${stopsUpdated} existing stop(s)` : ''}`
        });
    } catch (error: any) {
        console.error('[assign-client-driver] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Unknown error occurred' },
            { status: 500 }
        );
    }
}
