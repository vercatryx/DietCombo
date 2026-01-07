export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import { query, queryOne } from "@/lib/mysql";
import { geocodeIfNeeded } from "@/lib/geocodeOneClient";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const client = await queryOne<any>(`
        SELECT 
            id,
            first_name as first,
            last_name as last,
            address,
            apt,
            city,
            state,
            zip,
            phone,
            lat,
            lng,
            dislikes,
            paused,
            delivery,
            complex
        FROM clients
        WHERE id = ?
    `, [id]);
    
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    
    return NextResponse.json({
        id: client.id,
        first: client.first || "",
        last: client.last || "",
        address: client.address || "",
        apt: client.apt || null,
        city: client.city || "",
        state: client.state || "",
        zip: client.zip || "",
        phone: client.phone || null,
        lat: client.lat ? Number(client.lat) : null,
        lng: client.lng ? Number(client.lng) : null,
        dislikes: client.dislikes || null,
        paused: Boolean(client.paused),
        delivery: client.delivery !== undefined ? Boolean(client.delivery) : true,
        complex: Boolean(client.complex),
    });
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const userId = id;
    const b = await req.json();
    
    const clearGeocode = !!b.clearGeocode;
    const cascadeStopsFlag = !!b.cascadeStops;
    
    // Get current client
    const current = await queryOne<any>(`
        SELECT lat, lng, address, apt, city, state, zip, phone, first_name, last_name
        FROM clients WHERE id = ?
    `, [userId]);
    
    if (!current) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    
    // Detect address changes
    const addressChanged =
        (current?.address ?? "") !== (b.address ?? "") ||
        (current?.apt ?? "") !== (b.apt ?? "") ||
        (current?.city ?? "") !== (b.city ?? "") ||
        (current?.state ?? "") !== (b.state ?? "") ||
        (current?.zip ?? "") !== (b.zip ?? "");
    
    // Determine final coordinates
    let finalLat = clearGeocode ? null : (b.lat !== undefined ? Number(b.lat) : null);
    let finalLng = clearGeocode ? null : (b.lng !== undefined ? Number(b.lng) : null);
    
    // Geocode if needed
    if (!clearGeocode && (finalLat == null || finalLng == null)) {
        const result = await geocodeIfNeeded(
            {
                address: b.address ?? current.address,
                apt: b.apt ?? current.apt,
                city: b.city ?? current.city,
                state: b.state ?? current.state,
                zip: b.zip ?? current.zip,
            },
            addressChanged
        );
        if (result && result.lat && result.lng) {
            finalLat = Number(result.lat);
            finalLng = Number(result.lng);
        }
    }
    
    // Build update fields
    const updateFields: string[] = [];
    const updateValues: any[] = [];
    
    if (b.first !== undefined) {
        updateFields.push("first_name = ?");
        updateValues.push(b.first);
    }
    if (b.last !== undefined) {
        updateFields.push("last_name = ?");
        updateValues.push(b.last);
    }
    if (b.address !== undefined) {
        updateFields.push("address = ?");
        updateValues.push(b.address ?? null);
    }
    if (b.apt !== undefined) {
        updateFields.push("apt = ?");
        updateValues.push(b.apt ?? null);
    }
    if (b.city !== undefined) {
        updateFields.push("city = ?");
        updateValues.push(b.city ?? null);
    }
    if (b.state !== undefined) {
        updateFields.push("state = ?");
        updateValues.push(b.state ?? null);
    }
    if (b.zip !== undefined) {
        updateFields.push("zip = ?");
        updateValues.push(b.zip ?? null);
    }
    if (b.phone !== undefined) {
        updateFields.push("phone = ?");
        updateValues.push(b.phone ?? null);
    }
    if (b.dislikes !== undefined) {
        updateFields.push("dislikes = ?");
        updateValues.push(b.dislikes ?? null);
    }
    if (b.paused !== undefined) {
        updateFields.push("paused = ?");
        updateValues.push(b.paused ? 1 : 0);
    }
    if (b.delivery !== undefined) {
        updateFields.push("delivery = ?");
        updateValues.push(b.delivery ? 1 : 0);
    }
    if (b.complex !== undefined) {
        updateFields.push("complex = ?");
        updateValues.push(b.complex ? 1 : 0);
    }
    if (finalLat !== undefined) {
        updateFields.push("lat = ?");
        updateValues.push(finalLat);
    }
    if (finalLng !== undefined) {
        updateFields.push("lng = ?");
        updateValues.push(finalLng);
    }
    
    if (updateFields.length > 0) {
        updateValues.push(userId);
        await query(`
            UPDATE clients
            SET ${updateFields.join(", ")}
            WHERE id = ?
        `, updateValues);
    }
    
    // Cascade to stops if needed
    if (cascadeStopsFlag && (finalLat !== null || finalLng !== null)) {
        const stopUpdateFields: string[] = [];
        const stopUpdateValues: any[] = [];
        
        if (b.first !== undefined || b.last !== undefined) {
            const firstName = b.first ?? current.first_name ?? "";
            const lastName = b.last ?? current.last_name ?? "";
            stopUpdateFields.push("name = ?");
            stopUpdateValues.push(`${firstName} ${lastName}`.trim());
        }
        if (b.address !== undefined) {
            stopUpdateFields.push("address = ?");
            stopUpdateValues.push(b.address ?? null);
        }
        if (b.apt !== undefined) {
            stopUpdateFields.push("apt = ?");
            stopUpdateValues.push(b.apt ?? null);
        }
        if (b.city !== undefined) {
            stopUpdateFields.push("city = ?");
            stopUpdateValues.push(b.city ?? null);
        }
        if (b.state !== undefined) {
            stopUpdateFields.push("state = ?");
            stopUpdateValues.push(b.state ?? null);
        }
        if (b.zip !== undefined) {
            stopUpdateFields.push("zip = ?");
            stopUpdateValues.push(b.zip ?? null);
        }
        if (b.phone !== undefined) {
            stopUpdateFields.push("phone = ?");
            stopUpdateValues.push(b.phone ?? null);
        }
        if (finalLat !== null) {
            stopUpdateFields.push("lat = ?");
            stopUpdateValues.push(finalLat);
        }
        if (finalLng !== null) {
            stopUpdateFields.push("lng = ?");
            stopUpdateValues.push(finalLng);
        }
        
        if (stopUpdateFields.length > 0) {
            stopUpdateValues.push(userId);
            await query(`
                UPDATE stops
                SET ${stopUpdateFields.join(", ")}
                WHERE client_id = ?
            `, stopUpdateValues).catch(err => {
                console.error("Failed to cascade to stops:", err);
            });
        }
    }
    
    // Return updated client
    const updated = await queryOne<any>(`
        SELECT 
            id,
            first_name as first,
            last_name as last,
            address,
            apt,
            city,
            state,
            zip,
            phone,
            lat,
            lng,
            dislikes,
            paused,
            delivery,
            complex
        FROM clients
        WHERE id = ?
    `, [userId]);
    
    return NextResponse.json({
        id: updated.id,
        first: updated.first || "",
        last: updated.last || "",
        address: updated.address || "",
        apt: updated.apt || null,
        city: updated.city || "",
        state: updated.state || "",
        zip: updated.zip || "",
        phone: updated.phone || null,
        lat: updated.lat ? Number(updated.lat) : null,
        lng: updated.lng ? Number(updated.lng) : null,
        dislikes: updated.dislikes || null,
        paused: Boolean(updated.paused),
        delivery: updated.delivery !== undefined ? Boolean(updated.delivery) : true,
        complex: Boolean(updated.complex),
    });
}

