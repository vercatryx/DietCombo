export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

// Calculate distance between two lat/lng points (Haversine formula)
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Nearest neighbor algorithm to optimize route order
function optimizeRouteOrder(stops: Array<{ id: string; lat: number | null; lng: number | null }>): string[] {
    if (stops.length <= 1) {
        return stops.map(s => s.id);
    }

    // Filter out stops without valid coordinates
    const validStops = stops.filter(s => 
        s.lat !== null && s.lng !== null && 
        Number.isFinite(s.lat) && Number.isFinite(s.lng)
    );

    if (validStops.length === 0) {
        return stops.map(s => s.id);
    }

    // Use nearest neighbor algorithm
    const visited = new Set<string>();
    const ordered: string[] = [];
    
    // Start with first stop (or could use a "start" location if useDietFantasyStart is true)
    let current = validStops[0];
    ordered.push(current.id);
    visited.add(current.id);

    while (visited.size < validStops.length) {
        let nearest: typeof current | null = null;
        let minDistance = Infinity;

        for (const stop of validStops) {
            if (visited.has(stop.id)) continue;
            
            const distance = calculateDistance(
                current.lat!, current.lng!,
                stop.lat!, stop.lng!
            );

            if (distance < minDistance) {
                minDistance = distance;
                nearest = stop;
            }
        }

        if (nearest) {
            ordered.push(nearest.id);
            visited.add(nearest.id);
            current = nearest;
        } else {
            break;
        }
    }

    // Add any stops without coordinates at the end
    const invalidStops = stops.filter(s => 
        !validStops.some(vs => vs.id === s.id)
    );
    ordered.push(...invalidStops.map(s => s.id));

    return ordered;
}

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const day = normalizeDay(body?.day);
        const driverId = body?.driverId ? String(body.driverId) : null;
        const consolidateDuplicates = Boolean(body?.consolidateDuplicates);
        const useDietFantasyStart = Boolean(body?.useDietFantasyStart);

        if (consolidateDuplicates) {
            // STEP A: Consolidate duplicate stops across all drivers
            // Find stops with the same client_id assigned to multiple drivers
            const { data: allDrivers } = await supabase
                .from('drivers')
                .select('id, name, stop_ids')
                .eq('day', day);

            // Build a map of client_id -> list of (driverId, stopId) pairs
            const clientToStops = new Map<string, Array<{ driverId: string; stopId: string }>>();

            if (!allDrivers) {
                return NextResponse.json({ error: "Failed to fetch drivers" }, { status: 500 });
            }

            for (const driver of allDrivers) {
                const stopIds = Array.isArray(driver.stop_ids) 
                    ? driver.stop_ids 
                    : (typeof driver.stop_ids === "string" ? JSON.parse(driver.stop_ids || "[]") : []);

                for (const stopId of stopIds) {
                    const { data: stop } = await supabase
                        .from('stops')
                        .select('id, client_id')
                        .eq('id', stopId)
                        .eq('day', day)
                        .limit(1)
                        .maybeSingle();

                    if (stop && stop.client_id) {
                        const clientId = String(stop.client_id);
                        if (!clientToStops.has(clientId)) {
                            clientToStops.set(clientId, []);
                        }
                        clientToStops.get(clientId)!.push({
                            driverId: driver.id,
                            stopId: String(stopId)
                        });
                    }
                }
            }

            // For each client with multiple stops, keep only one (prefer Driver 0, then first driver)
            for (const [clientId, stops] of clientToStops.entries()) {
                if (stops.length <= 1) continue;

                // Sort by driver (Driver 0 first)
                stops.sort((a, b) => {
                    const driverA = allDrivers.find(d => d.id === a.driverId);
                    const driverB = allDrivers.find(d => d.id === b.driverId);
                    const isA0 = driverA?.name?.toLowerCase().includes("driver 0");
                    const isB0 = driverB?.name?.toLowerCase().includes("driver 0");
                    if (isA0 && !isB0) return -1;
                    if (!isA0 && isB0) return 1;
                    return 0;
                });

                // Keep first stop, remove others from their drivers
                const keepStop = stops[0];
                for (let i = 1; i < stops.length; i++) {
                    const removeStop = stops[i];
                    const driver = allDrivers.find(d => d.id === removeStop.driverId);
                    if (driver) {
                        const stopIds = Array.isArray(driver.stop_ids) 
                            ? driver.stop_ids 
                            : (typeof driver.stop_ids === "string" ? JSON.parse(driver.stop_ids || "[]") : []);
                        const filtered = stopIds.filter((id: any) => String(id) !== removeStop.stopId);
                        await supabase
                            .from('drivers')
                            .update({ stop_ids: filtered })
                            .eq('id', driver.id);
                    }
                }
            }
        }

        if (driverId) {
            // STEP B: Optimize a specific driver's route order
            const { data: driver } = await supabase
                .from('drivers')
                .select('id, stop_ids')
                .eq('id', driverId)
                .eq('day', day)
                .single();

            if (!driver) {
                return NextResponse.json(
                    { error: "Driver not found" },
                    { status: 404 }
                );
            }

            const stopIds = Array.isArray(driver.stop_ids) 
                ? driver.stop_ids 
                : (typeof driver.stop_ids === "string" ? JSON.parse(driver.stop_ids || "[]") : []);

            if (stopIds.length === 0) {
                return NextResponse.json({ success: true, message: "No stops to optimize" });
            }

            // Fetch stop details with coordinates
            const { data: stops } = await supabase
                .from('stops')
                .select('id, lat, lng')
                .in('id', stopIds);

            // Optimize order
            const optimizedOrder = optimizeRouteOrder(stops || []);

            // Update driver with optimized order
            await supabase
                .from('drivers')
                .update({ stop_ids: optimizedOrder })
                .eq('id', driverId);

            return NextResponse.json(
                { 
                    success: true, 
                    message: `Route optimized for driver ${driverId}`,
                    stopsReordered: optimizedOrder.length
                },
                { headers: { "Cache-Control": "no-store" } }
            );
        } else {
            // If no driverId, just return success (consolidation was done)
            return NextResponse.json(
                { 
                    success: true, 
                    message: "Duplicates consolidated" 
                },
                { headers: { "Cache-Control": "no-store" } }
            );
        }
    } catch (e: any) {
        console.error("[/api/route/optimize] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

