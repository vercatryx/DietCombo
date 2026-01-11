export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
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
        const { data: allClients } = await supabase
            .from('clients')
            .select('id, first_name, last_name, address, apt, city, state, zip, phone_number, lat, lng, paused, delivery')
            .order('id', { ascending: true });

        // Check which clients have stops for THIS day
        let stopsQuery = supabase
            .from('stops')
            .select('client_id');
        if (day !== "all") {
            stopsQuery = stopsQuery.eq('day', day);
        }
        const { data: stopsForDay } = await stopsQuery;
        
        const clientsWithStops = new Set<string>();
        for (const s of (stopsForDay || [])) {
            if (s.client_id) {
                clientsWithStops.add(String(s.client_id));
            }
        }

        // Get active orders to determine which clients need stops
        // Active order statuses: 'pending', 'scheduled', 'confirmed'
        const activeOrderStatuses = ["pending", "scheduled", "confirmed"];
        
        // Get orders with scheduled_delivery_date and extract day of week
        // Also check delivery_day field if present
        const { data: activeOrders } = await supabase
            .from('orders')
            .select('client_id, scheduled_delivery_date, delivery_day, status')
            .in('status', activeOrderStatuses)
            .or('scheduled_delivery_date.not.is.null,delivery_day.not.is.null');

        // Get upcoming_orders with delivery_day
        const { data: upcomingOrders } = await supabase
            .from('upcoming_orders')
            .select('client_id, delivery_day, status')
            .eq('status', 'scheduled')
            .not('delivery_day', 'is', null);

        // Build map of client_id -> set of delivery days they have orders for
        const clientDeliveryDays = new Map<string, Set<string>>();
        
        // Helper to convert day name to lowercase
        const normalizeDay = (dayName: string | null): string | null => {
            if (!dayName) return null;
            return dayName.toLowerCase();
        };

        // Helper to get day of week from date
        const getDayOfWeek = (dateStr: string | null): string | null => {
            if (!dateStr) return null;
            try {
                const date = new Date(dateStr);
                const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                return dayNames[date.getDay()];
            } catch {
                return null;
            }
        };

        // Process active orders
        for (const order of activeOrders) {
            const clientId = String(order.client_id);
            if (!clientDeliveryDays.has(clientId)) {
                clientDeliveryDays.set(clientId, new Set());
            }
            const daysSet = clientDeliveryDays.get(clientId)!;
            
            // Use delivery_day if available, otherwise extract from scheduled_delivery_date
            if (order.delivery_day) {
                const normalizedDay = normalizeDay(order.delivery_day);
                if (normalizedDay) daysSet.add(normalizedDay);
            } else if (order.scheduled_delivery_date) {
                const dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
                if (dayOfWeek) daysSet.add(dayOfWeek);
            }
        }

        // Process upcoming orders
        for (const order of upcomingOrders) {
            const clientId = String(order.client_id);
            if (!clientDeliveryDays.has(clientId)) {
                clientDeliveryDays.set(clientId, new Set());
            }
            const daysSet = clientDeliveryDays.get(clientId)!;
            
            if (order.delivery_day) {
                const normalizedDay = normalizeDay(order.delivery_day);
                if (normalizedDay) daysSet.add(normalizedDay);
            }
        }

        // Helper functions
        const isDeliverable = (c: any) => {
            const v = c?.delivery;
            return v === undefined || v === null ? true : Boolean(v);
        };

        const hasOrderForDay = (clientId: string, dayValue: string): boolean => {
            if (dayValue === "all") {
                // For "all" day, check if client has any orders
                const daysSet = clientDeliveryDays.get(String(clientId));
                return daysSet ? daysSet.size > 0 : false;
            }
            const daysSet = clientDeliveryDays.get(String(clientId));
            if (!daysSet || daysSet.size === 0) return false;
            return daysSet.has(dayValue.toLowerCase());
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
            const clientId = String(client.id);
            
            // Skip if client already has a stop for this day
            if (clientsWithStops.has(clientId)) {
                continue;
            }

            // Check if client should have a stop
            if (client.paused) {
                continue; // Paused clients don't get stops
            }
            if (!isDeliverable(client)) {
                continue; // Delivery disabled clients don't get stops
            }
            if (!hasOrderForDay(clientId, day)) {
                continue; // Client has no active order for this day
            }

            // Client should have a stop - create it
            const name = `${client.first_name || ""} ${client.last_name || ""}`.trim() || "Unnamed";
            stopsToCreate.push({
                id: uuidv4(),
                day: day,
                client_id: clientId,
                name: name || "(Unnamed)",
                address: s(client.address),
                apt: client.apt ? s(client.apt) : null,
                city: s(client.city),
                state: s(client.state),
                zip: s(client.zip),
                phone: client.phone_number ? s(client.phone_number) : null,
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
                        const { error: insertError } = await supabase
                            .from('stops')
                            .upsert({
                                id: stopData.id,
                                day: stopData.day,
                                client_id: stopData.client_id,
                                name: stopData.name,
                                address: stopData.address,
                                apt: stopData.apt,
                                city: stopData.city,
                                state: stopData.state,
                                zip: stopData.zip,
                                phone: stopData.phone,
                                lat: stopData.lat,
                                lng: stopData.lng,
                            }, { onConflict: 'id' });
                        if (insertError) throw insertError;
                            stopData.name,
                            stopData.address,
                            stopData.apt,
                            stopData.city,
                        stopsCreated++;
                    } catch (createError: any) {
                        // Skip if stop already exists (duplicate key)
                        if (createError?.code !== "23505" && !createError?.message?.includes('duplicate')) {
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

