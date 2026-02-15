export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "all"];
    return days.includes(s) ? s : "all";
}

function toNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v as any);
    return Number.isFinite(n) ? n : null;
}

// Haversine formula - distance in km between two lat/lng points
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

type ClientWithCoords = { client_id: string; lat: number | null; lng: number | null };

// Nearest neighbor algorithm - start from southernmost stop (min latitude)
function optimizeRouteOrder(clients: ClientWithCoords[]): string[] {
    if (clients.length <= 1) {
        return clients.map((c) => c.client_id);
    }

    const valid = clients.filter(
        (c) =>
            c.lat != null &&
            c.lng != null &&
            Number.isFinite(c.lat) &&
            Number.isFinite(c.lng)
    );
    const invalid = clients.filter(
        (c) => !valid.some((v) => v.client_id === c.client_id)
    );

    if (valid.length === 0) {
        return clients.map((c) => c.client_id);
    }

    // Start from southernmost stop (min latitude)
    const sortedByLat = [...valid].sort((a, b) => (a.lat as number) - (b.lat as number));
    const start = sortedByLat[0];
    const visited = new Set<string>([start.client_id]);
    const ordered: string[] = [start.client_id];
    let current = start;

    while (visited.size < valid.length) {
        let nearest: ClientWithCoords | null = null;
        let minDist = Infinity;

        for (const c of valid) {
            if (visited.has(c.client_id)) continue;
            const dist = calculateDistance(
                current.lat!,
                current.lng!,
                c.lat!,
                c.lng!
            );
            if (dist < minDist) {
                minDist = dist;
                nearest = c;
            }
        }

        if (nearest) {
            ordered.push(nearest.client_id);
            visited.add(nearest.client_id);
            current = nearest;
        } else {
            break;
        }
    }

    ordered.push(...invalid.map((c) => c.client_id));
    return ordered;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const day = normalizeDay(body?.day);
        const driverId = body?.driverId ? String(body.driverId) : null;
        const deliveryDate = body?.delivery_date
            ? String(body.delivery_date).split("T")[0].split(" ")[0]
            : null;

        // 1) Get drivers (same sources as routes API)
        let driversQuery = supabase
            .from("drivers")
            .select("id")
            .order("id", { ascending: true });
        if (day !== "all") {
            driversQuery = driversQuery.eq("day", day);
        }
        const { data: driversRaw } = await driversQuery;

        const { data: routesRaw } = await supabase
            .from("routes")
            .select("id")
            .order("id", { ascending: true });

        const routesAsDrivers = (routesRaw || []).map((r: any) => ({
            ...r,
            id: r.id,
        }));

        const allDriversRaw = [...(driversRaw || []), ...routesAsDrivers];
        const driverIds = Array.from(
            new Set(allDriversRaw.map((d: any) => String(d.id)))
        ).filter(Boolean);

        if (driverIds.length === 0) {
            return NextResponse.json(
                { success: true, message: "No drivers found", driversOptimized: 0 },
                { headers: { "Cache-Control": "no-store" } }
            );
        }

        // Filter to single driver if requested
        const targetDriverIds = driverId ? driverIds.filter((id) => id === driverId) : driverIds;
        if (driverId && targetDriverIds.length === 0) {
            return NextResponse.json(
                { error: "Driver not found" },
                { status: 404 }
            );
        }

        // 2) Fetch driver_route_order for target drivers
        const { data: orderRows } = await supabase
            .from("driver_route_order")
            .select("driver_id, client_id, position")
            .in("driver_id", targetDriverIds)
            .order("position", { ascending: true })
            .order("client_id", { ascending: true });

        if (!orderRows || orderRows.length === 0) {
            return NextResponse.json(
                { success: true, message: "No route orders to reorganize", driversOptimized: 0 },
                { headers: { "Cache-Control": "no-store" } }
            );
        }

        // Group by driver
        const byDriver = new Map<string, { client_id: string }[]>();
        for (const row of orderRows) {
            const did = String(row.driver_id);
            if (!byDriver.has(did)) byDriver.set(did, []);
            byDriver.get(did)!.push({ client_id: String(row.client_id) });
        }

        // 3) Fetch clients with lat/lng
        const allClientIds = Array.from(
            new Set(orderRows.map((r) => String(r.client_id)))
        );
        const { data: clients } = await supabase
            .from("clients")
            .select("id, lat, lng")
            .in("id", allClientIds);

        const clientById = new Map(
            (clients || []).map((c: any) => [
                String(c.id),
                { lat: toNum(c.lat), lng: toNum(c.lng) },
            ])
        );

        // 4) Fallback: if client missing coords, try stops (for delivery_date if provided)
        const missingCoordIds = allClientIds.filter((cid) => {
            const c = clientById.get(cid);
            return !c || (c.lat == null && c.lng == null);
        });

        if (missingCoordIds.length > 0) {
            let stopsQuery = supabase
                .from("stops")
                .select("client_id, lat, lng")
                .in("client_id", missingCoordIds);
            if (deliveryDate) {
                stopsQuery = stopsQuery.or(
                    `delivery_date.eq.${deliveryDate},delivery_date.is.null`
                );
            }
            const { data: stops } = await stopsQuery;
            for (const s of stops || []) {
                const cid = String(s.client_id);
                const existing = clientById.get(cid);
                if (existing && (existing.lat == null || existing.lng == null)) {
                    const slat = toNum(s.lat);
                    const slng = toNum(s.lng);
                    if (slat != null || slng != null) {
                        clientById.set(cid, {
                            lat: existing.lat ?? slat,
                            lng: existing.lng ?? slng,
                        });
                    }
                } else if (!existing) {
                    clientById.set(cid, {
                        lat: toNum(s.lat),
                        lng: toNum(s.lng),
                    });
                }
            }
        }

        // 5) Optimize each driver and collect updates
        const updates: { driver_id: string; client_id: string; position: number }[] = [];

        for (const [did, list] of byDriver.entries()) {
            const withCoords: ClientWithCoords[] = list.map(({ client_id }) => ({
                client_id,
                lat: clientById.get(client_id)?.lat ?? null,
                lng: clientById.get(client_id)?.lng ?? null,
            }));

            const optimizedOrder = optimizeRouteOrder(withCoords);
            optimizedOrder.forEach((cid, pos) => {
                updates.push({ driver_id: did, client_id: cid, position: pos });
            });
        }

        // 6) Batch update driver_route_order
        await Promise.all(
            updates.map(({ driver_id, client_id, position }) =>
                supabase
                    .from("driver_route_order")
                    .update({ position })
                    .eq("driver_id", driver_id)
                    .eq("client_id", client_id)
            )
        );

        return NextResponse.json(
            {
                success: true,
                message: `Reorganized ${byDriver.size} route(s)`,
                driversOptimized: byDriver.size,
                stopsReordered: updates.length,
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/reorganize] error:", e);
        return NextResponse.json(
            { error: e?.message || "Reorganize failed" },
            { status: 500 }
        );
    }
}
