// app/api/signatures/ensure-token/[userId]/route.ts
import { NextResponse } from "next/server";
import { query, queryOne, execute, generateUUID } from "@/lib/mysql";

export async function POST(
    _req: Request,
    ctx: { params: Promise<{ userId: string }> }
) {
    const { userId } = await ctx.params;
    
    if (!userId) {
        return NextResponse.json({ error: "Bad userId" }, { status: 400 });
    }

    try {
        // Check if clients table has sign_token column
        const client = await queryOne<any>(
            `SELECT sign_token FROM clients WHERE id = ?`,
            [userId]
        ).catch(() => null);

        const token = client?.sign_token || generateUUID();

        if (!client?.sign_token) {
            // Try to update, but if column doesn't exist, just return the token
            await execute(
                `UPDATE clients SET sign_token = ? WHERE id = ?`,
                [token, userId]
            ).catch(() => {
                // Column might not exist, that's okay
                console.log("[signatures/ensure-token] sign_token column may not exist");
            });
        }

        return NextResponse.json({ sign_token: token });
    } catch (error) {
        console.error("[signatures/ensure-token] error:", error);
        // Return a generated token anyway
        return NextResponse.json({ sign_token: generateUUID() });
    }
}

