"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

type SignatureSlot = 1 | 2 | 3 | 4 | 5;
type Pt = { x: number; y: number; t: number };
type Stroke = Pt[];
type StrokesPayload = Stroke[];

/** Simple signature pad with persistent visible strokes */
function SignaturePad({
    width = 600,
    height = 160,
    strokes,
    setStrokes,
    disabled,
}: {
    width?: number;
    height?: number;
    strokes: StrokesPayload;
    setStrokes: (next: StrokesPayload) => void;
    disabled?: boolean;
}) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const current = useRef<Stroke>([]);
    const drawing = useRef(false);

    const paint = React.useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        for (const s of strokes) {
            ctx.beginPath();
            s.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
            ctx.stroke();
        }

        if (current.current.length) {
            ctx.beginPath();
            current.current.forEach((p, i) =>
                i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
            );
            ctx.stroke();
        }
    }, [strokes, width, height]);

    useEffect(() => paint(), [paint]);

    const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top, t: Date.now() };
    };

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (disabled) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drawing.current = true;
        current.current = [pointFromEvent(e)];
        paint();
    };

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawing.current || disabled) return;
        current.current.push(pointFromEvent(e));
        paint();
    };

    const onPointerUp = () => {
        if (!drawing.current || disabled) return;
        drawing.current = false;
        if (current.current.length) {
            setStrokes([...strokes, current.current]);
            current.current = [];
        }
    };

    return (
        <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            style={{
                display: "block",
                width,
                height,
                background: "#fafafa",
                borderRadius: 8,
                border: "1px dashed #bbb",
                touchAction: "none",
            }}
        />
    );
}

export default function SignPage() {
    const { token } = useParams<{ token: string }>();
    const [user, setUser] = useState<{ id: string; first: string; last: string } | null>(null);
    const [collected, setCollected] = useState<number>(0);
    const [busy, setBusy] = useState(false);
    const [existingSlots, setExistingSlots] = useState<number[]>([]);

    const [pad1, setPad1] = useState<StrokesPayload>([]);
    const [pad2, setPad2] = useState<StrokesPayload>([]);
    const [pad3, setPad3] = useState<StrokesPayload>([]);
    const [pad4, setPad4] = useState<StrokesPayload>([]);
    const [pad5, setPad5] = useState<StrokesPayload>([]);

    /** Legal consent statements for each signature slot */
    const labels = useMemo(
        () => [
            "Authorization to Apply Signature for Meal Delivery Attestations",
            "Consent for Electronic Record Storage and Use",
            "Acknowledgment of Information Accuracy",
            "Privacy and Data Use Authorization",
            "Ongoing Authorization for Signature Reuse",
        ],
        []
    );

    const statements = useMemo(
        () => [
            "I hereby authorize Diet Combo to apply my electronic signature to future attestations confirming that I have personally received my medically tailored meals.",
            "I consent to the electronic storage and secure use of my signature for documentation, reimbursement, and compliance purposes.",
            "I affirm that all information associated with my meal deliveries is true, accurate, and complete to the best of my knowledge.",
            "I understand and authorize that my signature and related information may be securely stored and shared only with authorized program administrators, auditors, or payers as required by law.",
            "I understand that this authorization will remain in effect until I revoke it in writing and that I may withdraw my consent at any time by contacting Diet Combo.",
        ],
        []
    );

    useEffect(() => {
        if (!token) return;
        (async () => {
            try {
                const res = await fetch(`/api/signatures/${token}`, { cache: "no-store" });
                if (!res.ok) return;
                const data = await res.json();
                setUser(data.user);
                setCollected(data.collected ?? 0);
                setExistingSlots(data.slots ?? []);
            } catch {}
        })();
    }, [token]);

    const clearSlot = (slot: SignatureSlot) => {
        if (existingSlots.includes(slot)) return;
        const setterBySlot: Record<number, (s: StrokesPayload) => void> = {
            1: setPad1, 2: setPad2, 3: setPad3, 4: setPad4, 5: setPad5,
        };
        setterBySlot[slot]([]);
    };

    const submitAll = async () => {
        if (!user) return;

        const pads: Record<number, StrokesPayload> = { 1: pad1, 2: pad2, 3: pad3, 4: pad4, 5: pad5 };
        const pending = (Object.keys(pads) as unknown as SignatureSlot[])
            .filter((slot) => !existingSlots.includes(slot))
            .filter((slot) => pads[slot]?.length);

        if (pending.length === 0) return;

        setBusy(true);
        try {
            for (const slot of pending) {
                const res = await fetch(`/api/signatures/${token}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ slot, strokes: pads[slot] }),
                });
                if (!res.ok) throw new Error(await res.text());
                const j = await res.json();
                setCollected(j.collected);
                setExistingSlots(j.slots ?? []);
            }

            // auto-close parent sheet (no alerts)
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ type: "signatures:done" }, "*");
            }
        } catch {
            // silent per your preference
        } finally {
            setBusy(false);
        }
    };

    if (!user) {
        return <div style={{ padding: 24 }}>Loading…</div>;
    }

    const slotBlock = (
        slot: SignatureSlot,
        strokes: StrokesPayload,
        setStrokes: (s: StrokesPayload) => void,
        label: string,
        text: string
    ) => {
        const done = existingSlots.includes(slot);
        return (
            <div key={slot} style={{ marginBottom: 28 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
                    {label} {done ? "✓" : ""}
                </h3>
                <p style={{ fontSize: 14, color: "#444", marginBottom: 8 }}>{text}</p>
                <SignaturePad strokes={strokes} setStrokes={setStrokes} disabled={busy || done} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                        onClick={() => clearSlot(slot)}
                        disabled={busy || done}
                        style={{
                            padding: "6px 10px",
                            borderRadius: 8,
                            border: "1px solid #ddd",
                            background: "#f5f5f5",
                            cursor: busy || done ? "not-allowed" : "pointer",
                        }}
                    >
                        Clear
                    </button>
                    {done && (
                        <span style={{ alignSelf: "center", fontSize: 12, color: "#666" }}>
                            Saved — read-only
                        </span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div
            style={{
                maxWidth: 760,
                margin: "36px auto",
                padding: 16,
                fontFamily: "ui-sans-serif, system-ui",
            }}
        >
            <h1 style={{ fontSize: 24, marginBottom: 8 }}>
                {user.first} {user.last} — Signature Authorization Form ({collected}/5)
            </h1>
            <p style={{ marginBottom: 16, color: "#444" }}>
                By signing the following sections, I give Diet Combo permission to securely store and
                apply my electronic signature for future medically tailored meal delivery attestations,
                billing, and compliance documentation.
            </p>

            {slotBlock(1, pad1, setPad1, labels[0], statements[0])}
            {slotBlock(2, pad2, setPad2, labels[1], statements[1])}
            {slotBlock(3, pad3, setPad3, labels[2], statements[2])}
            {slotBlock(4, pad4, setPad4, labels[3], statements[3])}
            {slotBlock(5, pad5, setPad5, labels[4], statements[4])}

            <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
                <button
                    onClick={submitAll}
                    disabled={busy}
                    style={{
                        padding: "10px 14px",
                        borderRadius: 8,
                        border: "1px solid #06f",
                        background: "#06f",
                        color: "white",
                        cursor: busy ? "not-allowed" : "pointer",
                        fontWeight: 600,
                    }}
                >
                    {busy ? "Submitting…" : "Submit All"}
                </button>
            </div>
        </div>
    );
}

