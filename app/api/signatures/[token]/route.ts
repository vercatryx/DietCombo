import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, insert, execute } from "@/lib/mysql";
import { generateUUID } from "@/lib/mysql";

export async function GET(
    _req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;

        const user = await queryOne<{
            id: string;
            full_name: string;
            first_name: string | null;
            last_name: string | null;
        }>(
            `SELECT id, full_name, first_name, last_name FROM clients WHERE sign_token = ?`,
            [token]
        );

        if (!user) {
            return new NextResponse("Not found", { status: 404 });
        }

        // If first_name or last_name are null, parse from full_name
        let firstName = user.first_name || "";
        let lastName = user.last_name || "";
        if (!firstName && !lastName && user.full_name) {
            const nameParts = user.full_name.trim().split(/\s+/);
            if (nameParts.length > 0) {
                firstName = nameParts[0];
                lastName = nameParts.slice(1).join(" ") || "";
            }
        }

        const sigs = await query<{ slot: number }>(
            `SELECT slot FROM signatures WHERE client_id = ? ORDER BY slot ASC`,
            [user.id]
        );

        return NextResponse.json({
            user: {
                id: user.id,
                first: firstName,
                last: lastName,
            },
            collected: sigs.length,
            slots: sigs.map((s) => s.slot),
        });
    } catch (error: any) {
        console.error("[signatures GET] error:", error);
        return NextResponse.json(
            { error: "Internal error", detail: error?.message },
            { status: 500 }
        );
    }
}

export async function POST(
    req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;

        const user = await queryOne<{ id: string }>(
            `SELECT id FROM clients WHERE sign_token = ?`,
            [token]
        );

        if (!user) {
            return new NextResponse("Not found", { status: 404 });
        }

        const body = await req.json().catch(() => null);
        const slot = Number(body?.slot);
        const strokes = body?.strokes;

        if (![1, 2, 3, 4, 5].includes(slot)) {
            return new NextResponse("Invalid slot", { status: 400 });
        }
        if (!Array.isArray(strokes) || strokes.length === 0) {
            return new NextResponse("Invalid strokes", { status: 400 });
        }

        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
        const ua = req.headers.get("user-agent") || undefined;

        // Check if signature already exists
        const existing = await queryOne<{ id: string }>(
            `SELECT id FROM signatures WHERE client_id = ? AND slot = ?`,
            [user.id, slot]
        );

        if (existing) {
            // Update existing signature
            await execute(
                `UPDATE signatures SET strokes = ?, ip = ?, user_agent = ?, signed_at = CURRENT_TIMESTAMP WHERE client_id = ? AND slot = ?`,
                [JSON.stringify(strokes), ip || null, ua || null, user.id, slot]
            );
        } else {
            // Insert new signature
            const id = generateUUID();
            await insert(
                `INSERT INTO signatures (id, client_id, slot, strokes, ip, user_agent, signed_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [id, user.id, slot, JSON.stringify(strokes), ip || null, ua || null]
            );
        }

        const after = await query<{ slot: number }>(
            `SELECT slot FROM signatures WHERE client_id = ? ORDER BY slot ASC`,
            [user.id]
        );

        return NextResponse.json({
            ok: true,
            collected: after.length,
            slots: after.map((s) => s.slot),
        });
    } catch (error: any) {
        console.error("[signatures POST] error:", error);
        return NextResponse.json(
            { error: "Internal error", detail: error?.message },
            { status: 500 }
        );
    }
}

