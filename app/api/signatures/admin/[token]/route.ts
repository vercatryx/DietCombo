import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(
    _req: Request,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;
        if (!token) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        const { data: user } = await supabase
            .from('clients')
            .select('id, full_name, first_name, last_name, address, apt, city, state, zip')
            .eq('sign_token', token)
            .single();

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

        // Query signatures (try with order_id first, fall back if column doesn't exist)
        let sigs: any[];
        try {
            const { data, error } = await supabase
                .from('signatures')
                .select('slot, strokes, signed_at, ip, user_agent, order_id')
                .eq('client_id', user.id)
                .order('slot', { ascending: true })
                .order('signed_at', { ascending: true });
            
            if (error) throw error;
            sigs = data || [];
        } catch (err: any) {
            // If error is about missing order_id column, query without it
            if (err.message?.includes('order_id') || err.code === 'PGRST116') {
                const { data, error: retryError } = await supabase
                    .from('signatures')
                    .select('slot, strokes, signed_at, ip, user_agent')
                    .eq('client_id', user.id)
                    .order('slot', { ascending: true })
                    .order('signed_at', { ascending: true });
                
                if (retryError) throw retryError;
                // Add order_id as null for all rows
                sigs = (data || []).map(r => ({ ...r, order_id: null }));
            } else {
                throw err;
            }
        }

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
            signatures: sigs.map((s: any) => {
                // Parse strokes if it's a string, ensure it's always an array
                let strokes = s.strokes;
                if (typeof strokes === 'string') {
                    try {
                        strokes = JSON.parse(strokes);
                    } catch {
                        strokes = [];
                    }
                }
                // Ensure strokes is an array
                if (!Array.isArray(strokes)) {
                    strokes = [];
                }
                return {
                    slot: s.slot,
                    strokes,
                    signedAt: s.signed_at,
                    ip: s.ip,
                    userAgent: s.user_agent,
                    orderId: s.order_id || null,
                };
            }),
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

        const { data: user } = await supabase
            .from('clients')
            .select('id')
            .eq('sign_token', token)
            .single();

        if (!user) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        await supabase
            .from('signatures')
            .delete()
            .eq('client_id', user.id);
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error("[admin token DELETE] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}

