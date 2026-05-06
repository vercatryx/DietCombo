'use client';

import { useState, useRef, useCallback, useEffect, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { processDeliveryProof } from '@/app/delivery/actions';
import { Camera, CheckCircle, Upload, AlertCircle, X } from 'lucide-react';
import { ProofStampPreviewOverlay } from '@/components/proof/ProofStampPreviewOverlay';

const Webcam = dynamic(
    () => import('react-webcam') as Promise<{ default: ComponentType<any> }>,
    { ssr: false }
);

type Step = 'CHECK' | 'CAPTURE' | 'PREVIEW' | 'UPLOADING' | 'SUCCESS' | 'ERROR' | 'NO_CAMERA';

interface TakeProofModalProps {
    open: boolean;
    onClose: () => void;
    stop: { id: string; name?: string; orderNumber?: number | string; orderId?: string | null } | null;
    onSuccess: (proofUrl: string, proofUrl2?: string | null) => void;
}

export function TakeProofModal({ open, onClose, stop, onSuccess }: TakeProofModalProps) {
    const [step, setStep] = useState<Step>('CHECK');
    const [proofImages, setProofImages] = useState<[string | null, string | null]>([null, null]);
    const [previewCapturedAt, setPreviewCapturedAt] = useState<[Date | null, Date | null]>([null, null]);
    const [captureIndex, setCaptureIndex] = useState<0 | 1>(0);
    const [error, setError] = useState('');
    const [hasCamera, setHasCamera] = useState<boolean | null>(null);
    const webcamRef = useRef<any>(null);

    const orderIdentifier = stop?.orderId ?? stop?.orderNumber ?? '';

    useEffect(() => {
        if (!open || !stop) return;
        setStep('CHECK');
        setProofImages([null, null]);
        setPreviewCapturedAt([null, null]);
        setCaptureIndex(0);
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
        const now = new Date();
        if (captureIndex === 0) {
            setProofImages([raw, null]);
            setPreviewCapturedAt([now, null]);
            setCaptureIndex(1);
        } else {
            setProofImages(([first]) => [first, raw]);
            setPreviewCapturedAt(([t0]) => [t0, now]);
            setStep('PREVIEW');
        }
    }, [captureIndex]);

    const handleUpload = async () => {
        const [img0, img1] = proofImages;
        if (!img0 || !img1 || !stop) return;
        setStep('UPLOADING');
        try {
            const res0 = await fetch(img0);
            const blob0 = await res0.blob();
            const file0 = new File([blob0], 'delivery-proof-1.jpg', { type: 'image/jpeg' });
            const res1 = await fetch(img1);
            const blob1 = await res1.blob();
            const file1 = new File([blob1], 'delivery-proof-2.jpg', { type: 'image/jpeg' });
            const formData = new FormData();
            formData.append('file', file0);
            formData.append('file2', file1);
            formData.append('orderNumber', String(orderIdentifier));
            const result = await processDeliveryProof(formData);
            if (result.success && result.url) {
                onSuccess(result.url, (result as any).url2 ?? null);
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
                        {captureIndex === 0 ? 'Photo 1 of 2 — then take a second picture' : 'Photo 2 of 2 — tap shutter'}
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: 16, right: 16, width: 44, height: 44, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <X size={24} />
                    </button>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '24px 16px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
                        <button type="button" onClick={capture} aria-label="Take photo" style={{ width: 72, height: 72, borderRadius: '50%', background: '#fff', border: '4px solid #d1d5db', cursor: 'pointer' }} />
                    </div>
                </div>
            </div>
        );
    }

    if (step === 'PREVIEW') {
        const [img0, img1] = proofImages;
        const [t0, t1] = previewCapturedAt;
        return (
            <div style={{ ...modalStyle, background: '#000' }}>
                <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', width: '100%', overflow: 'auto' }}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: '#000' }}>
                        {img0 && (
                            <div style={{ position: 'relative', minHeight: '32vh' }}>
                                <img src={img0} alt="Proof 1" style={{ width: '100%', maxHeight: '38vh', objectFit: 'contain' }} />
                                {t0 ? <ProofStampPreviewOverlay capturedAt={t0} /> : null}
                            </div>
                        )}
                        {img1 && (
                            <div style={{ position: 'relative', minHeight: '32vh' }}>
                                <img src={img1} alt="Proof 2" style={{ width: '100%', maxHeight: '38vh', objectFit: 'contain' }} />
                                {t1 ? <ProofStampPreviewOverlay capturedAt={t1} /> : null}
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 12, padding: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button type="button" onClick={handleUpload} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                            <Upload size={20} /> Submit proof (both photos)
                        </button>
                        <button type="button" onClick={() => { setProofImages([null, null]); setPreviewCapturedAt([null, null]); setCaptureIndex(0); setStep('CAPTURE'); }} style={{ padding: '12px 20px', borderRadius: 8, border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb', cursor: 'pointer' }}>Retake all</button>
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
                        <button type="button" onClick={() => { setProofImages([null, null]); setPreviewCapturedAt([null, null]); setCaptureIndex(0); setStep('CAPTURE'); setError(''); }} style={{ marginRight: 8, padding: '10px 18px', borderRadius: 8, border: '1px solid #4b5563', background: '#374151', color: '#e5e7eb', cursor: 'pointer' }}>Try again</button>
                        <button type="button" onClick={onClose} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#4b5563', color: '#fff', cursor: 'pointer' }}>Close</button>
                    </div>
                </div>
            </div>
        );
    }

    return null;
}
