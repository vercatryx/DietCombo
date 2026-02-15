// app/api/stops/dates/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { toCalendarDateKeyInAppTz } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/stops/dates
 *
 * Returns all unique delivery dates that have registered stops with their stop counts.
 * Used to show indicators and counts on calendar dates.
 *
 * Uses app timezone (America/New_York) so calendar dates match what the routes API uses.
 * - Only counts stops with valid lat/lng (matching map behavior)
 * - Only counts stops with explicit delivery_date
 */
export async function GET(req: Request) {
    try {
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

        const hasValidCoordinates = (stop: any): boolean => {
            if (!stop) return false;
            const lat = typeof stop.lat === 'number' ? stop.lat : (typeof stop.latitude === 'number' ? stop.latitude : null);
            const lng = typeof stop.lng === 'number' ? stop.lng : (typeof stop.longitude === 'number' ? stop.longitude : null);
            return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
        };

        /** Normalize DB delivery_date to YYYY-MM-DD in app timezone (no UTC shift). */
        const toDateKey = (raw: string | null | undefined): string | null => {
            if (raw == null || typeof raw !== 'string') return null;
            const s = raw.trim();
            if (DATE_ONLY_REGEX.test(s)) return s;
            return toCalendarDateKeyInAppTz(s);
        };

        const dateCounts = new Map<string, number>();

        (allStops || []).forEach((stop: any) => {
            if (!hasValidCoordinates(stop)) return;
            if (!stop.delivery_date) return;
            const dateKey = toDateKey(stop.delivery_date);
            if (dateKey) {
                dateCounts.set(dateKey, (dateCounts.get(dateKey) || 0) + 1);
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
