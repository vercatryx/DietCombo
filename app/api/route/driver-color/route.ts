export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Valid hex color: #RGB or #RRGGBB (optional #)
const HEX_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

function isValidHexColor(value: string): boolean {
    return HEX_REGEX.test(String(value).trim());
}

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const driverId = body?.driverId ? String(body.driverId) : null;
        let color = body?.color != null ? String(body.color).trim() : null;

        if (!driverId) {
            return NextResponse.json(
                { error: "driverId is required" },
                { status: 400 }
            );
        }

        if (color === "" || color === null || color === undefined) {
            return NextResponse.json(
                { error: "color is required" },
                { status: 400 }
            );
        }

        if (!isValidHexColor(color)) {
            return NextResponse.json(
                { error: "color must be a valid hex color (e.g. #1f77b4 or #f00)" },
                { status: 400 }
            );
        }

        const { data: driver } = await supabase
            .from("drivers")
            .select("id, name, color")
            .eq("id", driverId)
            .single();

        if (!driver) {
            return NextResponse.json(
                { error: "Driver not found" },
                { status: 404 }
            );
        }

        await supabase
            .from("drivers")
            .update({ color })
            .eq("id", driverId);

        return NextResponse.json(
            {
                success: true,
                message: `Driver color updated`,
                driverId,
                color,
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/driver-color] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}
