// app/api/stops/dates/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/stops/dates
 * 
 * Returns all unique delivery dates that have registered stops with their stop counts.
 * Used to show indicators and counts on calendar dates.
 */
export async function GET(req: Request) {
    try {
        // Get all stops with delivery_date
        // Only include dates that are not null
        const { data: stops, error } = await supabase
            .from('stops')
            .select('delivery_date')
            .not('delivery_date', 'is', null);

        if (error) {
            console.error("[/api/stops/dates] Error fetching stops:", error);
            return NextResponse.json(
                { error: error.message },
                { status: 500 }
            );
        }

        // Count stops per date and format them as YYYY-MM-DD strings
        const dateCounts = new Map<string, number>();
        
        (stops || []).forEach((stop: any) => {
            if (stop.delivery_date) {
                // Convert to YYYY-MM-DD format
                const date = new Date(stop.delivery_date);
                if (!isNaN(date.getTime())) {
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const dateKey = `${year}-${month}-${day}`;
                    
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
