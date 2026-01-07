export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

/**
 * API endpoint to get clients formatted as "users" for routes feature compatibility
 * The routes feature expects a "users" API endpoint
 */
export async function GET(req: Request) {
    try {
        const clients = await query<any[]>(`
            SELECT 
                id,
                first_name as first,
                last_name as last,
                address,
                apt,
                city,
                state,
                zip,
                phone_number as phone,
                lat,
                lng,
                dislikes,
                paused,
                delivery,
                complex
            FROM clients
            ORDER BY id ASC
        `);

        // Get schedules for clients
        const schedules = await query<any[]>(`
            SELECT 
                client_id,
                monday,
                tuesday,
                wednesday,
                thursday,
                friday,
                saturday,
                sunday
            FROM schedules
        `);

        const scheduleMap = new Map<string, any>();
        for (const s of schedules) {
            scheduleMap.set(s.client_id, s);
        }

        // Format clients as users with schedule
        const users = clients.map(client => ({
            id: client.id,
            first: client.first || "",
            last: client.last || "",
            address: client.address || "",
            apt: client.apt || null,
            city: client.city || "",
            state: client.state || "",
            zip: client.zip || "",
            phone: client.phone || null,
            lat: client.lat ? Number(client.lat) : null,
            lng: client.lng ? Number(client.lng) : null,
            dislikes: client.dislikes || null,
            paused: Boolean(client.paused),
            delivery: client.delivery !== undefined ? Boolean(client.delivery) : true,
            complex: Boolean(client.complex),
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
            updateValues.push(String(id));
            await query(`
                UPDATE clients 
                SET ${updateFields.join(", ")}
                WHERE id = ?
            `, updateValues);

            // If cascadeStops, update stops too
            if (cascadeStops && (lat !== undefined || lng !== undefined)) {
                await query(`
                    UPDATE stops 
                    SET lat = ?, lng = ?
                    WHERE client_id = ?
                `, [Number(lat ?? 0), Number(lng ?? 0), String(id)]);
            }
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("[/api/users] PUT error:", e);
        return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
    }
}

