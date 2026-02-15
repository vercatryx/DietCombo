// app/api/mobile/stop/proof/route.ts
// POST: upload proof image for a stop (multipart file or JSON with dataUrl from camera).
// Updates stops.proof_url and returns the public URL.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { uploadFile } from "@/lib/storage";

const R2_DELIVERY_BUCKET = process.env.R2_DELIVERY_BUCKET_NAME;
const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_DOMAIN || "";

function getPublicUrl(key: string): string {
    const base = (R2_PUBLIC_BASE || "").replace(/\/$/, "");
    return base ? `${base}/${key}` : key;
}

export async function POST(req: Request) {
    const contentType = req.headers.get("content-type") || "";

    let stopId: string;
    let buffer: Buffer;
    let mimeType: string;

    if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        const stopIdParam = formData.get("stopId");
        const file = formData.get("file") as File | null;

        if (!stopIdParam || typeof stopIdParam !== "string") {
            return NextResponse.json({ ok: false, error: "stopId is required" }, { status: 400 });
        }
        stopId = String(stopIdParam).trim();
        if (!stopId) {
            return NextResponse.json({ ok: false, error: "stopId is required" }, { status: 400 });
        }
        if (!file || !(file instanceof File)) {
            return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });
        }
        const arr = await file.arrayBuffer();
        buffer = Buffer.from(arr);
        mimeType = file.type || "image/jpeg";
    } else if (contentType.includes("application/json")) {
        let body: { stopId?: string; dataUrl?: string };
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }
        const stopIdParam = body?.stopId;
        const dataUrl = body?.dataUrl;

        if (!stopIdParam || typeof stopIdParam !== "string") {
            return NextResponse.json({ ok: false, error: "stopId is required" }, { status: 400 });
        }
        stopId = String(stopIdParam).trim();
        if (!stopId) {
            return NextResponse.json({ ok: false, error: "stopId is required" }, { status: 400 });
        }
        if (!dataUrl || typeof dataUrl !== "string") {
            return NextResponse.json({ ok: false, error: "dataUrl is required for camera upload" }, { status: 400 });
        }
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!match) {
            return NextResponse.json({ ok: false, error: "Invalid dataUrl format" }, { status: 400 });
        }
        mimeType = match[1].trim();
        const b64 = match[2];
        buffer = Buffer.from(b64, "base64");
    } else {
        return NextResponse.json({ ok: false, error: "Content-Type must be multipart/form-data or application/json" }, { status: 400 });
    }

    if (!buffer.length) {
        return NextResponse.json({ ok: false, error: "Empty image" }, { status: 400 });
    }

    if (!R2_DELIVERY_BUCKET) {
        console.error("[mobile/stop/proof] R2_DELIVERY_BUCKET_NAME not set");
        return NextResponse.json({ ok: false, error: "Upload not configured" }, { status: 500 });
    }

    const ext = mimeType.includes("png") ? "png" : "jpg";
    const key = `stop-proof-${stopId}-${Date.now()}.${ext}`;

    try {
        await uploadFile(key, buffer, mimeType, R2_DELIVERY_BUCKET);
    } catch (err) {
        console.error("[mobile/stop/proof] Upload error:", err);
        return NextResponse.json({ ok: false, error: "Upload failed" }, { status: 500 });
    }

    const publicUrl = getPublicUrl(key);

    const { error } = await supabase.from("stops").update({ proof_url: publicUrl }).eq("id", stopId);
    if (error) {
        console.error("[mobile/stop/proof] DB update error:", error);
        return NextResponse.json({ ok: false, error: "Failed to save proof URL" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, proofUrl: publicUrl });
}
