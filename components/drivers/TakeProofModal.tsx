'use client';

import { useState, useRef, useCallback, useEffect, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { processDeliveryProof } from '@/app/delivery/actions';
import { Camera, CheckCircle, Upload, AlertCircle, X } from 'lucide-react';
import { ProofStampPreviewOverlay } from '@/components/proof/ProofStampPreviewOverlay';
import { previewUrlFromScreenshotDataUrl, revokeProofPreviewUrl, revokeProofPreviewUrls } from '@/lib/proof-capture-preview';

const Webcam = dynamic(
    () => import('react-webcam') as Promise<{ default: ComponentType<any> }>,
    { ssr: false }
);

type Step = 'CHECK' | 'CAPTURE' | 'PREVIEW' | 'UPLOADING' | 'SUCCESS' | 'ERROR' | 'NO_CAMERA';

interface TakeProofModalProps {
    open: boolean;
    onClose: () => void;
    stop: { id: string; name?: string; orderNumber?: number | string; orderId?: string | null } | null;
    /** All uploaded proof URLs (same order as captured). Primary is urls[0]. */
    onSuccess: (urls: string[]) => void;
}

export function TakeProofModal({ open, onClose, stop, onSuccess }: TakeProofModalProps) {
    const [step, setStep] = useState<Step>('CHECK');
    const [proofImages, setProofImages] = useState<string[]>([]);
    const [previewCapturedAt, setPreviewCapturedAt] = useState<Date[]>([]);
    const [error, setError] = useState('');
    const [hasCamera, setHasCamera] = useState<boolean | null>(null);
    const webcamRef = useRef<any>(null);
    const proofImagesRef = useRef<string[]>([]);
    proofImagesRef.current = proofImages;

    const orderIdentifier = stop?.orderId ?? stop?.orderNumber ?? '';

    const clearCapturedProofs = useCallback(() => {
        setProofImages((prev) => {
            revokeProofPreviewUrls(prev);
            return [];
        });
        setPreviewCapturedAt([]);
    }, []);

    useEffect(() => () => revokeProofPreviewUrls(proofImagesRef.current), []);

    useEffect(() => {
        if (!open || !stop) return;
        setStep('CHECK');
        setProofImages((prev) => {
            revokeProofPreviewUrls(prev);
            return [];
        });
        setPreviewCapturedAt([]);
        setError('');
        setHasCamera(null);
    }, [open, stop?.id]);

    useEffect(() => {
        if (!open || step !== 'CHECK') return;
        let cancelled = false;
        (async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    if (!cancelled) setHasCamera(false);
                    return;
                }
                const devices = await navigator.mediaDevices.enumerateDevices();
                const videoInputs = devices.filter((d) => d.kind === 'videoinput');
                if (videoInputs.length === 0) {
                    if (!cancelled) setHasCamera(false);
                    return;
                }
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                stream.getTracks().forEach((t) => t.stop());
                if (!cancelled) setHasCamera(true);
            } catch {
                if (!cancelled) setHasCamera(false);
            }
        })();
        return () => { cancelled = true; };
    }, [open, step]);

    useEffect(() => {
        if (hasCamera === true) setStep('CAPTURE');
        if (hasCamera === false) setStep('NO_CAMERA');
    }, [hasCamera]);

    const capture = useCallback(async () => {
        const raw = webcamRef.current?.getScreenshot?.();
        if (!raw) return;
        const preview = await previewUrlFromScreenshotDataUrl(raw);
        const now = new Date();
        setProofImages((prev) => [...prev, preview]);
        setPreviewCapturedAt((prev) => [...prev, now]);
    }, []);

    function removeProofAt(index: number) {
        setProofImages((prev) => {
            revokeProofPreviewUrl(prev[index]);
            return prev.filter((_, i) => i !== index);
        });
        setPreviewCapturedAt((prev) => prev.filter((_, i) => i !== index));
    }

    const handleUpload = async () => {
        if (proofImages.length === 0 || !stop) return;
        setStep('UPLOADING');
        try {
            const formData = new FormData();
            for (let i = 0; i < proofImages.length; i++) {
                const res = await fetch(proofImages[i]);
                const blob = await res.blob();
                formData.append('files', new File([blob], `delivery-proof-${i + 1}.jpg`, { type: 'image/jpeg' }));
            }
            formData.append('orderNumber', String(orderIdentifier));
            const result = await processDeliveryProof(formData);
            const urls = (result as any)?.urls as string[] | undefined;
            const list =
                Array.isArray(urls) && urls.length > 0 ? urls : result.success && (result as any).url ? [(result as any).url as string] : [];
            if (result.success && list.length > 0) {
                onSuccess(list);
                setStep('SUCCESS');
            } else {
                setError(result.error || 'Upload failed');
                setStep('ERROR');
            }
        } catch (err: any) {
            setError(err?.message || 'Upload failed');
            setStep('ERROR');
        }
    };

    if (!open) return null;

    const modalStyle: React.CSSProperties = {
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    };
    const cardStyle: React.CSSProperties = {
        background: '#1f2937',
        borderRadius: 12,
        maxWidth: 420,
        width: '100%',
        maxHeight: '90vh',
        overflow: 'auto',
        color: '#e5e7eb',
        padding: 24,
    };

    if (step === 'CHECK') {
        return (
            <div style={modalStyle} onClick={onClose}>
                <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
                    <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                        <div className="spinner" style={{ margin: '0 auto', width: 40, height: 40, borderWidth: 3, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#60a5fa', borderRadius: '50%' }} />
                        <p style={{ marginTop: 16 }}>Checking for camera…</p>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'NO_CAMERA') {
        return (
            <div style={modalStyle} onClick={onClose}>
                <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
                    <div style={{ textAlign: 'center' }}>
                        <Camera size={40} style={{ color: '#fbbf24', marginBottom: 12 }} />
                        <h3 style={{ fontSize: '1.1rem', marginBottom: 8 }}>No camera available</h3>
                        <p style={{ color: '#9ca3af', fontSize: 14 }}>Use a device with a camera to take delivery proof.</p>
                        <button type="button" onClick={onClose} style={{ marginTop: 20, padding: '10px 20px', borderRadius: 8, border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb', cursor: 'pointer' }}>Close</button>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'CAPTURE') {
        return (
            <div style={{ ...modalStyle, background: '#000' }}>
                <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', maxHeight: '100vh' }}>
                    <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ facingMode: 'environment' }}
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', padding: '8px 14px', borderRadius: 12, background: 'rgba(59, 130, 246, 0.92)', color: '#f8fafc', fontSize: 13, fontWeight: 600, zIndex: 6, pointerEvents: 'none', maxWidth: '90vw', textAlign: 'center' }}>
                        {proofImages.length === 0
                            ? 'Tap shutter for each photo — as many as you need'
                            : `${proofImages.length} saved — add more or tap Review`}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 16, right: 16, width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={24} />
                    </button>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '16px 16px calc(24px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, background: 'linear-gradient(transparent, rgba(0,0,0,0.75))' }}>
                        {proofImages.length > 0 && (
                            <button type="button" onClick={() => setStep('PREVIEW')} style={{ padding: '10px 20px', borderRadius: 999, border: '1px solid rgba(255,255,255,0.35)', background: 'rgba(0,0,0,0.55)', color: '#f8fafc', fontWeight: 600, cursor: 'pointer', fontSize: 14 }}>
                                Review {proofImages.length} photo{proofImages.length === 1 ? '' : 's'}
                            </button>
                        )}
                        <button type="button" onClick={capture} aria-label="Take photo" style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', border: '4px solid #d1d5db', cursor: 'pointer' }} />
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'PREVIEW') {
        return (
            <div style={{ ...modalStyle, background: '#000' }}>
                <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: '#000' }}>
                        {proofImages.map((src, i) => (
                            <div key={i} style={{ position: 'relative', minHeight: '28vh' }}>
                                <img src={src} alt={`Proof ${i + 1}`} style={{ width: '100%', maxHeight: '38vh', objectFit: 'contain' }} />
                                {previewCapturedAt[i] ? <ProofStampPreviewOverlay capturedAt={previewCapturedAt[i]} /> : null}
                                <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>Photo {i + 1}</span>
                                    <button type="button" onClick={() => removeProofAt(i)} style={{ background: 'rgba(220,38,38,0.9)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Remove</button>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: 12, padding: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button type="button" disabled={proofImages.length === 0} onClick={handleUpload} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 8, border: 'none', background: proofImages.length === 0 ? '#4b5563' : '#16a34a', color: '#fff', cursor: proofImages.length === 0 ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: proofImages.length === 0 ? 0.7 : 1 }}>
                            <Upload size={20} /> Submit {proofImages.length || ''} photo{proofImages.length === 1 ? '' : 's'}
                        </button>
                        <button type="button" onClick={() => setStep('CAPTURE')} style={{ padding: '12px 20px', borderRadius: 8, border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb', cursor: 'pointer' }}>Add more</button>
                        <button type="button" onClick={() => { clearCapturedProofs(); setStep('CAPTURE'); }} style={{ padding: '12px 20px', borderRadius: 8, border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb', cursor: 'pointer' }}>Clear all</button>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'UPLOADING') {
        return (
            <div style={modalStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
                <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
                    <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                        <div className="spinner" style={{ margin: '0 auto', width: 48, height: 48, borderWidth: 3, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#60a5fa', borderRadius: '50%' }} />
                        <p style={{ marginTop: 16 }}>Saving proof…</p>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'SUCCESS') {
        return (
            <div style={modalStyle} onClick={(e) => e.target === e.currentTarget && onClose()}>
                <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
                    <div style={{ textAlign: 'center' }}>
                        <CheckCircle size={48} style={{ color: '#22c55e', marginBottom: 12 }} />
                        <h3 style={{ fontSize: '1.25rem', marginBottom: 4 }}>Proof saved</h3>
                        <p style={{ color: '#9ca3af', fontSize: 14 }}>You can close this.</p>
                        <button type="button" onClick={onClose} style={{ marginTop: 20, padding: '12px 24px', borderRadius: 8, border: 'none', background: 'var(--brand, #3665F3)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Done</button>
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'ERROR') {
        return (
            <div style={modalStyle} onClick={onClose}>
                <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
                    <div style={{ textAlign: 'center' }}>
                        <AlertCircle size={40} style={{ color: '#f87171', marginBottom: 12 }} />
                        <h3 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Upload failed</h3>
                        <p style={{ color: '#fca5a5', fontSize: 14, marginBottom: 16 }}>{error}</p>
                        <button type="button" onClick={() => { clearCapturedProofs(); setStep('CAPTURE'); setError(''); }} style={{ marginRight: 8, padding: '10px 18px', borderRadius: 8, border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb', cursor: 'pointer' }}>Try again</button>
                        <button type="button" onClick={onClose} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#4b5563', color: '#fff', cursor: 'pointer' }}>Close</button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}
