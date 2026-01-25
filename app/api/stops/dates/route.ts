// app/api/stops/dates/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/stops/dates
 * 
 * Returns all unique delivery dates that have registered stops with their stop counts.
 * Used to show indicators and counts on calendar dates.
 * 
 * This matches the logic in /api/route/routes to ensure calendar counts match map counts:
 * - Only counts stops with valid lat/lng coordinates (map only shows geocoded stops)
 * - Only counts stops with explicit delivery_date (when day="all", routes API only filters by delivery_date)
 */
export async function GET(req: Request) {
    try {
        // Get all stops (both with and without delivery_date)
        // We need both to match the routes API logic
        // Also include lat/lng to filter out stops without geocoding (matching map behavior)
        const { data: allStops, error } = await supabase
            .from('stops')
            .select('delivery_date, day, lat, lng');

        if (error) {
            console.error("[/api/stops/dates] Error fetching stops:", error);
            return NextResponse.json(
                { error: error.message },
                { status: 500 }
            );
        }

        // Helper to format date as YYYY-MM-DD
        const formatDateKey = (date: Date): string => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        // Helper to check if stop has valid lat/lng (matching map's hasLL logic)
        // The map only shows stops with valid coordinates, so calendar should match
        const hasValidCoordinates = (stop: any): boolean => {
            if (!stop) return false;
            const lat = typeof stop.lat === 'number' ? stop.lat : (typeof stop.latitude === 'number' ? stop.latitude : null);
            const lng = typeof stop.lng === 'number' ? stop.lng : (typeof stop.longitude === 'number' ? stop.longitude : null);
            return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
        };

        // Count stops per date
        // Only count stops with:
        // 1. Valid coordinates (matching map behavior - map only shows geocoded stops)
        // 2. Explicit delivery_date (matching routes API when day="all" - it only filters by delivery_date)
        const dateCounts = new Map<string, number>();
        
        (allStops || []).forEach((stop: any) => {
            // Skip stops without geocoding (matching map's hasLL filter)
            if (!hasValidCoordinates(stop)) return;
            
            // Only count stops with explicit delivery_date
            // When day="all", routes API only filters by delivery_date, not NULL delivery_date stops
            if (stop.delivery_date) {
                // Convert to YYYY-MM-DD format
                const date = new Date(stop.delivery_date);
                if (!isNaN(date.getTime())) {
                    const dateKey = formatDateKey(date);
                    // Increment count for this date
                    dateCounts.set(dateKey, (dateCounts.get(dateKey) || 0) + 1);
                }
            }
        });

        // Convert Map to object format for easier consumption
        const datesWithCounts: Record<string, number> = {};
        dateCounts.forEach((count, dateKey) => {
            datesWithCounts[dateKey] = count;
        });

        return NextResponse.json(
            { dates: datesWithCounts },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (error: any) {
        console.error("[/api/stops/dates] Unexpected error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to fetch dates with stops" },
            { status: 500 }
        );
    }
}
