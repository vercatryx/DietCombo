export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * API endpoint to get clients formatted as "users" for routes feature compatibility
 * The routes feature expects a "users" API endpoint
 */
export async function GET(req: Request) {
    try {
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, dislikes, paused, delivery, complex, assigned_driver_id')
            .order('id', { ascending: true });

        if (clientsError) {
            console.error("[/api/users] Error fetching clients:", clientsError);
            return NextResponse.json({ error: `Failed to fetch clients: ${clientsError.message}` }, { status: 500 });
        }

        // Get schedules for clients
        const { data: schedules, error: schedulesError } = await supabase
            .from('schedules')
            .select('client_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday');

        if (schedulesError) {
            console.error("[/api/users] Error fetching schedules:", schedulesError);
            // Don't fail the request if schedules fail, just log it
        }

        const scheduleMap = new Map<string, any>();
        if (Array.isArray(schedules)) {
            for (const s of schedules) {
                scheduleMap.set(s.client_id, s);
            }
        }

        // Format clients as users with schedule
        const users = (clients || []).map(client => ({
            id: client.id,
            first: client.first_name || "",
            last: client.last_name || "",
            name: client.full_name || "",
            address: client.address || "",
            apt: client.apt || null,
            city: client.city || "",
            state: client.state || "",
            zip: client.zip || "",
            phone: client.phone_number || null,
            lat: client.lat ? Number(client.lat) : null,
            lng: client.lng ? Number(client.lng) : null,
            dislikes: client.dislikes || null,
            paused: Boolean(client.paused),
            delivery: client.delivery !== undefined ? Boolean(client.delivery) : true,
            complex: Boolean(client.complex),
            assignedDriverId: client.assigned_driver_id || null,
            schedule: scheduleMap.get(client.id) || {
                monday: true,
                tuesday: true,
                wednesday: true,
                thursday: true,
                friday: true,
                saturday: true,
                sunday: true,
            },
        }));

        return NextResponse.json(users, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        console.error("[/api/users] error:", e);
        return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    try {
        const body = await req.json();
        const { id, lat, lng, cascadeStops, ...otherFields } = body;

        if (!id) {
            return NextResponse.json({ error: "id is required" }, { status: 400 });
        }

        // Update client
        const updateFields: string[] = [];
        const updateValues: any[] = [];

        if (lat !== undefined) {
            updateFields.push("lat = ?");
            updateValues.push(Number(lat));
        }
        if (lng !== undefined) {
            updateFields.push("lng = ?");
            updateValues.push(Number(lng));
        }

        // Add other fields if needed
        if (updateFields.length > 0) {
            const payload: any = {};
            if (lat !== undefined) payload.lat = Number(lat);
            if (lng !== undefined) payload.lng = Number(lng);
            
            await supabase
                .from('clients')
                .update(payload)
                .eq('id', String(id));

            // If cascadeStops, update stops too
            if (cascadeStops && (lat !== undefined || lng !== undefined)) {
                await supabase
                    .from('stops')
                    .update({ lat: Number(lat ?? 0), lng: Number(lng ?? 0) })
                    .eq('client_id', String(id));
            }
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("[/api/users] PUT error:", e);
        return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
    }
}

