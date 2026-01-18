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

        // Build query to find stops for this client
        let query = supabase
            .from('stops')
            .select('id')
            .eq('client_id', clientId);

        // Filter by day if provided
        if (day && day !== 'all') {
            query = query.eq('day', day);
        }

        // Filter by delivery_date if provided
        if (delivery_date) {
            query = query.eq('delivery_date', delivery_date);
        }

        const { data: stops, error: stopsError } = await query;

        if (stopsError) {
            console.error('[assign-client-driver] Error fetching stops:', stopsError);
            return NextResponse.json(
                { error: `Failed to fetch stops: ${stopsError.message}` },
                { status: 500 }
            );
        }

        if (!stops || stops.length === 0) {
            return NextResponse.json({
                message: 'No stops found for this client',
                stopsUpdated: 0
            });
        }

        // Update all stops to assign/unassign the driver
        const stopIds = stops.map(s => s.id);
        const updatePayload: any = {};

        if (driverId) {
            updatePayload.assigned_driver_id = driverId;
        } else {
            // If driverId is null/empty, unassign the driver
            updatePayload.assigned_driver_id = null;
        }

        const { error: updateError } = await supabase
            .from('stops')
            .update(updatePayload)
            .in('id', stopIds);

        if (updateError) {
            console.error('[assign-client-driver] Error updating stops:', updateError);
            return NextResponse.json(
                { error: `Failed to update stops: ${updateError.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            stopsUpdated: stopIds.length,
            message: `Updated ${stopIds.length} stop(s) for client ${clientId}`
        });
    } catch (error: any) {
        console.error('[assign-client-driver] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Unknown error occurred' },
            { status: 500 }
        );
    }
}
