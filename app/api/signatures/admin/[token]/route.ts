import { NextResponse } from "next/server";
import { query, queryOne, execute } from "@/lib/mysql";

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;
        if (!token) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        const user = await queryOne<{
            id: string;
            full_name: string;
            first_name: string | null;
            last_name: string | null;
            address: string | null;
            apt: string | null;
            city: string | null;
            state: string | null;
            zip: string | null;
        }>(
            `SELECT id, full_name, first_name, last_name, address, apt, city, state, zip FROM clients WHERE sign_token = ?`,
            [token]
        );

        if (!user) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
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

        const sigs = await query<{
            slot: number;
            strokes: string;
            signed_at: string;
            ip: string | null;
            user_agent: string | null;
        }>(
            `SELECT slot, strokes, signed_at, ip, user_agent FROM signatures WHERE client_id = ? ORDER BY slot ASC, signed_at ASC`,
            [user.id]
        );

        const slots = Array.from(new Set(sigs.map((s) => s.slot))).sort((a, b) => a - b);

        return NextResponse.json({
            user: {
                id: user.id,
                first: firstName,
                last: lastName,
                address: user.address,
                apt: user.apt,
                city: user.city,
                state: user.state,
                zip: user.zip,
            },
            collected: sigs.length,
            slots,
            signatures: sigs.map((s) => ({
                slot: s.slot,
                strokes: typeof s.strokes === 'string' ? JSON.parse(s.strokes) : s.strokes,
                signedAt: s.signed_at,
                ip: s.ip,
                userAgent: s.user_agent,
            })),
        });
    } catch (err: any) {
        console.error("[admin token GET] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}

export async function DELETE(
    _req: Request,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;
        if (!token) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        const user = await queryOne<{ id: string }>(
            `SELECT id FROM clients WHERE sign_token = ?`,
            [token]
        );

        if (!user) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        await execute(`DELETE FROM signatures WHERE client_id = ?`, [user.id]);
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error("[admin token DELETE] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}

