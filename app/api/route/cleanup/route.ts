export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";
import { v4 as uuidv4 } from "uuid";

const sid = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (typeof v === "number" ? v : null);

export async function POST(req: Request) {
    try {
        // Try to get day from body first, then fall back to query string
        let day = "all";
        const { searchParams } = new URL(req.url);
        const queryDay = searchParams.get("day");
        
        try {
            const body = await req.json().catch(() => null);
            if (body?.day) {
                day = String(body.day).toLowerCase();
            } else if (queryDay) {
                day = queryDay.toLowerCase();
            }
        } catch {
            // If body parsing fails, use query string
            if (queryDay) {
                day = queryDay.toLowerCase();
            }
        }

        // Get all clients
        const allClients = await query<any[]>(`
            SELECT id, first_name as first, last_name as last, address, apt, city, state, zip, phone, lat, lng, paused, delivery
            FROM clients
            ORDER BY id ASC
        `);

        // Get schedules for clients
        const schedulesMap = new Map<string, any>();
        const clientIds = allClients.map(c => String(c.id));
        if (clientIds.length) {
            const schedules = await query<any[]>(`
                SELECT client_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday
                FROM schedules
                WHERE client_id IN (${clientIds.map(() => "?").join(",")})
            `, clientIds);
            for (const s of schedules) {
                schedulesMap.set(s.client_id, s);
            }
        }

        // Check which clients have stops for THIS day
        const dayWhere = day === "all" ? "" : `WHERE day = ?`;
        const dayParams = day === "all" ? [] : [day];
        const stopsForDay = await query<any[]>(
            `SELECT client_id FROM stops ${dayWhere}`,
            dayParams
        );
        const clientsWithStops = new Set<string>();
        for (const s of stopsForDay) {
            if (s.client_id) {
                clientsWithStops.add(String(s.client_id));
            }
        }

        // Helper functions
        const isDeliverable = (c: any) => {
            const v = c?.delivery;
            return v === undefined || v === null ? true : Boolean(v);
        };

        const isOnDay = (c: any, dayValue: string) => {
            if (dayValue === "all") return true;
            const sc = schedulesMap.get(c.id);
            if (!sc) return true; // back-compat: no schedule means all days
            const dayMap: Record<string, string> = {
                monday: "monday",
                tuesday: "tuesday",
                wednesday: "wednesday",
                thursday: "thursday",
                friday: "friday",
                saturday: "saturday",
                sunday: "sunday",
            };
            return !!sc[dayMap[dayValue]];
        };

        // Build list of stops to create for clients who should have them
        const stopsToCreate: Array<{
            id: string;
            day: string;
            client_id: string;
            name: string;
            address: string;
            apt: string | null;
            city: string;
            state: string;
            zip: string;
            phone: string | null;
            lat: number | null;
            lng: number | null;
        }> = [];

        for (const client of allClients) {
            // Skip if client already has a stop for this day
            if (clientsWithStops.has(String(client.id))) {
                continue;
            }

            // Check if client should have a stop
            if (client.paused) {
                continue; // Paused clients don't get stops
            }
            if (!isDeliverable(client)) {
                continue; // Delivery disabled clients don't get stops
            }
            if (!isOnDay(client, day)) {
                continue; // Client not scheduled for this day
            }

            // Client should have a stop - create it
            const name = `${client.first || ""} ${client.last || ""}`.trim() || "Unnamed";
            stopsToCreate.push({
                id: uuidv4(),
                day: day,
                client_id: String(client.id),
                name: name || "(Unnamed)",
                address: s(client.address),
                apt: client.apt ? s(client.apt) : null,
                city: s(client.city),
                state: s(client.state),
                zip: s(client.zip),
                phone: client.phone ? s(client.phone) : null,
                lat: n(client.lat),
                lng: n(client.lng),
            });
        }

        // Create missing stops
        let stopsCreated = 0;
        if (stopsToCreate.length > 0) {
            try {
                // Insert stops one at a time to handle duplicates gracefully
                for (const stopData of stopsToCreate) {
                    try {
                        await query(`
                            INSERT INTO stops (id, day, client_id, name, address, apt, city, state, zip, phone, lat, lng)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE name = VALUES(name)
                        `, [
                            stopData.id,
                            stopData.day,
                            stopData.client_id,
                            stopData.name,
                            stopData.address,
                            stopData.apt,
                            stopData.city,
                            stopData.state,
                            stopData.zip,
                            stopData.phone,
                            stopData.lat,
                            stopData.lng,
                        ]);
                        stopsCreated++;
                    } catch (createError: any) {
                        // Skip if stop already exists (duplicate key)
                        if (createError?.code !== "ER_DUP_ENTRY") {
                            console.error(`[route/cleanup] Failed to create stop for client ${stopData.client_id}:`, createError?.message);
                        }
                    }
                }
            } catch (e: any) {
                console.warn(`[route/cleanup] Error creating stops:`, e?.message);
            }
        }

        return NextResponse.json(
            { stopsCreated, message: `Created ${stopsCreated} missing stops for day "${day}"` },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("cleanup POST error", e);
        return NextResponse.json(
            { error: e?.message || "Server error", stopsCreated: 0 },
            { status: 500 }
        );
    }
}

