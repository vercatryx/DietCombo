// app/api/signatures/status/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

export async function GET() {
    try {
        // Check if signatures table exists, if not return empty array
        const rows = await query<any[]>(
            `SELECT client_id as userId, COUNT(*) as collected 
             FROM signatures 
             GROUP BY client_id`
        ).catch(() => []);

        // Return as an easy map list
        return NextResponse.json(
            rows.map(r => ({ userId: r.userId, collected: Number(r.collected) }))
        );
    } catch (error) {
        // If table doesn't exist or any error, return empty array
        console.log("[signatures/status] No signatures table or error:", error);
        return NextResponse.json([]);
    }
}

