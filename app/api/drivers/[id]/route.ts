export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        
        if (!id) {
            return NextResponse.json(
                { error: "Driver ID is required" },
                { status: 400 }
            );
        }

        const { data: driver, error } = await supabase
            .from('drivers')
            .select('id, name, color, day')
            .eq('id', id)
            .single();

        if (error) {
            // If not found in drivers table, check routes table (legacy)
            const { data: route, error: routeError } = await supabase
                .from('routes')
                .select('id, name, color')
                .eq('id', id)
                .single();

            if (routeError || !route) {
                return NextResponse.json(
                    { error: "Driver not found" },
                    { status: 404 }
                );
            }

            return NextResponse.json({
                id: route.id,
                name: route.name,
                color: route.color,
                day: null
            });
        }

        return NextResponse.json(driver);
    } catch (error: any) {
        console.error('Error fetching driver:', error);
        return NextResponse.json(
            { error: error.message || "Internal server error" },
            { status: 500 }
        );
    }
}
