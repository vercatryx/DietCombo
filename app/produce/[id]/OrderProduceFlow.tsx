'use client';

import { useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import { uploadProduceProofOnly, createProduceOrderWithProof } from '../actions';
import { Camera, CheckCircle, Upload, AlertCircle, MapPin, Phone, X, ExternalLink, ImageIcon } from 'lucide-react';
import '../produce.css';
import { ProofStampPreviewOverlay } from '@/components/proof/ProofStampPreviewOverlay';

interface ClientDetails {
    id: string;
    full_name: string;
    address: string;
    phoneNumber?: string | null;
    deliveryDateLabel: string;
    clientSignToken?: string | null;
}

export function OrderProduceFlow({ client }: { client: ClientDetails }) {
    const [step, setStep] = useState<'VERIFY' | 'CAPTURE' | 'PREVIEW' | 'UPLOADING' | 'SUCCESS' | 'ERROR'>('VERIFY');
    const [proofImages, setProofImages] = useState<string[]>([]);
    const [proofCapturedAt, setProofCapturedAt] = useState<Date[]>([]);
    const [uploadedProofUrls, setUploadedProofUrls] = useState<string[]>([]);
    const [createdOrderNumber, setCreatedOrderNumber] = useState<string | null>(null);
    const [error, setError] = useState<string>('');
    const webcamRef = useRef<Webcam>(null);

    const capture = useCallback(async () => {
        const raw = webcamRef.current?.getScreenshot();
        if (!raw) return;
        const now = new Date();
        setProofImages((prev) => [...prev, raw]);
        setProofCapturedAt((prev) => [...prev, now]);
    }, [webcamRef]);

    function removeProofAt(index: number) {
        setProofImages((prev) => prev.filter((_, i) => i !== index));
        setProofCapturedAt((prev) => prev.filter((_, i) => i !== index));
    }

    async function handleUpload() {
        if (proofImages.length === 0) return;

        setStep('UPLOADING');
        setError('');

        const formData = new FormData();
        for (let i = 0; i < proofImages.length; i++) {
            const res = await fetch(proofImages[i]);
            const blob = await res.blob();
            const file = new File([blob], `produce-proof-${i + 1}.jpg`, { type: 'image/jpeg' });
            formData.append('files', file);
        }
        formData.append('clientId', client.id);

        try {
            const uploadResult = await uploadProduceProofOnly(formData);
            if (!uploadResult.success || !uploadResult.urls?.length) {
                setError(uploadResult.error || 'Upload failed');
                setStep('ERROR');
                return;
            }

            const createResult = await createProduceOrderWithProof(client.id, uploadResult.urls);
            if (!createResult.success || !createResult.order) {
                setError(createResult.error || 'Failed to create order');
                setStep('ERROR');
                return;
            }

            setUploadedProofUrls(uploadResult.urls);
            setCreatedOrderNumber(createResult.order.orderNumber);
            setStep('SUCCESS');
        } catch (err: any) {
            setError(err?.message || 'Network or Server Error occurred');
            setStep('ERROR');
        }
    }

    if (step === 'VERIFY') {
        return (
            <div className="produce-card">
                <div className="text-center">
                    <span className="produce-badge">
                        Verify Produce Delivery
                    </span>
                    <h2 className="text-title">
                        {client.full_name}
                    </h2>
                    <p className="text-subtitle">
                        Scheduled: {new Date(client.deliveryDateLabel).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
                    </p>
                </div>

                <div className="info-panel">
                    <div className="info-row">
                        <div className="avatar">
                            {client.full_name.charAt(0)}
                        </div>
                        <div>
                            <p className="info-label">Client</p>
                            <p className="info-value">{client.full_name}</p>
                        </div>
                    </div>

                    <div className="divider" />

                    <div className="info-row">
                        <div className="info-label">
                            <Phone size={20} />
                        </div>
                        <div>
                            <p className="info-label">Phone</p>
                            <p className="info-value">
                                {client.phoneNumber ? (
                                    <a href={`tel:${client.phoneNumber.replace(/\s/g, '')}`} style={{ color: 'inherit', textDecoration: 'underline' }}>
                                        {client.phoneNumber}
                                    </a>
                                ) : (
                                    '—'
                                )}
                            </p>
                        </div>
                    </div>

                    <div className="divider" />

                    <div className="info-row">
                        <div className="info-label">
                            <MapPin size={20} />
                        </div>
                        <div>
                            <p className="info-label">Delivery Address</p>
                            <p className="info-value">{client.address}</p>
                        </div>
                    </div>
                </div>

                <p className="text-subtitle" style={{ marginTop: '0.5rem', opacity: 0.8 }}>
                    Take as many delivery proof photos as you need, then submit. The order is created only after you upload.
                </p>

                <button
                    onClick={() => {
                        setProofImages([]);
                        setProofCapturedAt([]);
                        setStep('CAPTURE');
                    }}
                    className="btn-primary"
                >
                    <Camera size={24} />
                    Take delivery photos
                </button>
            </div>
        );
    }

    if (step === 'CAPTURE') {
        return (
            <div className="camera-overlay-full">
                <div className="camera-view">
                    <Webcam
                        audio={false}
                        ref={webcamRef}
                        screenshotFormat="image/jpeg"
                        videoConstraints={{ facingMode: 'environment' }}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' }}
                    />

                    {/* Overlay Guides */}
                    <div className="absolute inset-0 border-[40px] border-black/50 pointer-events-none" style={{ position: 'absolute', inset: 0, border: '40px solid rgba(0,0,0,0.5)', pointerEvents: 'none' }}>
                        <div className="guide-box">
                            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white"></div>
                            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white"></div>
                            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white"></div>
                            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white"></div>
                        </div>
                    </div>

                    <div
                        style={{
                            position: 'absolute',
                            top: 'max(12px, env(safe-area-inset-top))',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            maxWidth: 'min(92vw, 420px)',
                            padding: '10px 14px',
                            borderRadius: '12px',
                            background: 'rgba(0,0,0,0.72)',
                            color: '#f8fafc',
                            fontSize: '0.875rem',
                            textAlign: 'center',
                            lineHeight: 1.35,
                            zIndex: 5,
                            pointerEvents: 'none'
                        }}
                    >
                        <div style={{ fontWeight: 600 }}>{client.full_name}</div>
                        {client.phoneNumber ? (
                            <a
                                href={`tel:${client.phoneNumber.replace(/\s/g, '')}`}
                                style={{ color: '#93c5fd', textDecoration: 'underline', pointerEvents: 'auto', display: 'inline-block', marginTop: '4px' }}
                            >
                                {client.phoneNumber}
                            </a>
                        ) : (
                            <div style={{ opacity: 0.75, marginTop: '4px' }}>No phone on file</div>
                        )}
                    </div>

                    <div
                        style={{
                            position: 'absolute',
                            top: 'calc(max(12px, env(safe-area-inset-top)) + 72px)',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            maxWidth: 'min(92vw, 420px)',
                            padding: '8px 14px',
                            borderRadius: '12px',
                            background: 'rgba(59, 130, 246, 0.92)',
                            color: '#f8fafc',
                            fontSize: '0.8125rem',
                            textAlign: 'center',
                            fontWeight: 600,
                            zIndex: 6,
                            pointerEvents: 'none'
                        }}
                    >
                        {proofImages.length === 0
                            ? 'Tap the shutter for each photo — as many as you need'
                            : `${proofImages.length} photo${proofImages.length === 1 ? '' : 's'} — keep shooting or open review`}
                    </div>

                    <button
                        onClick={() => {
                            setProofImages([]);
                            setProofCapturedAt([]);
                            setStep('VERIFY');
                        }}
                        className="close-btn"
                    >
                        <X size={32} />
                    </button>
                </div>

                <div className="camera-controls" style={{ flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
                    {proofImages.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setStep('PREVIEW')}
                            className="btn-secondary"
                            style={{
                                padding: '10px 18px',
                                borderRadius: '999px',
                                fontWeight: 600,
                                fontSize: '0.875rem',
                                border: '1px solid rgba(255,255,255,0.35)',
                                background: 'rgba(0,0,0,0.55)',
                                color: '#f8fafc',
                                cursor: 'pointer'
                            }}
                        >
                            Review {proofImages.length} photo{proofImages.length === 1 ? '' : 's'}
                        </button>
                    )}
                    <button type="button" onClick={capture} className="shutter-btn" aria-label="Take photo" />
                </div>
            </div>
        );
    }

    if (step === 'PREVIEW') {
        return (
            <div className="camera-overlay-full">
                <div className="camera-view" style={{ backgroundColor: 'black', position: 'relative', overflow: 'auto', flexDirection: 'column', display: 'flex', gap: 8, padding: 8 }}>
                    {proofImages.map((src, i) => (
                        <div key={i} style={{ position: 'relative', flex: 1, minHeight: '28vh' }}>
                            <img src={src} alt={`Proof ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            {proofCapturedAt[i] ? <ProofStampPreviewOverlay capturedAt={proofCapturedAt[i]} /> : null}
                            <div style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <span style={{ background: 'rgba(0,0,0,0.65)', color: '#fff', padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
                                    Photo {i + 1}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => removeProofAt(i)}
                                    style={{
                                        background: 'rgba(220,38,38,0.9)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 8,
                                        padding: '6px 12px',
                                        fontSize: 12,
                                        fontWeight: 600,
                                        cursor: 'pointer'
                                    }}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
                <div className="preview-actions">
                    <button
                        onClick={handleUpload}
                        disabled={proofImages.length === 0}
                        className="btn-primary"
                        style={{ backgroundColor: '#16a34a', opacity: proofImages.length === 0 ? 0.5 : 1 }}
                    >
                        <Upload size={24} />
                        {proofImages.length === 0
                            ? 'Submit photos'
                            : `Submit ${proofImages.length} photo${proofImages.length === 1 ? '' : 's'}`}
                    </button>
                    <button type="button" onClick={() => setStep('CAPTURE')} className="btn-secondary" style={{ backgroundColor: 'var(--bg-surface)' }}>
                        Add another photo
                    </button>
                    <button
                        onClick={() => {
                            setProofImages([]);
                            setProofCapturedAt([]);
                            setStep('CAPTURE');
                        }}
                        className="btn-secondary"
                        style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                        Clear all & retake
                    </button>
                </div>
            </div>
        );
    }

    if (step === 'UPLOADING') {
        return (
            <div className="produce-card text-center" style={{ marginTop: '2.5rem' }}>
                <div className="spinner" style={{ margin: '0 auto', width: '4rem', height: '4rem', borderTopColor: 'var(--color-primary)' }}></div>
                <div>
                    <h3 className="text-title" style={{ fontSize: '1.25rem' }}>Uploading...</h3>
                    <p className="text-subtitle">Saving photos and creating order…</p>
                </div>
            </div>
        );
    }

    if (step === 'SUCCESS') {
        return (
            <div className="produce-card text-center" style={{ marginTop: '2.5rem', borderColor: 'rgba(34, 197, 94, 0.3)' }}>
                <div className="success-icon">
                    <CheckCircle size={48} />
                </div>
                <div>
                    <h2 className="text-title">Processed!</h2>
                    {createdOrderNumber && (
                        <p className="text-subtitle" style={{ color: '#4ade80', fontSize: '1.125rem' }}>Order #{createdOrderNumber}</p>
                    )}
                    <p className="text-subtitle" style={{ marginTop: '1rem' }}>Proof has been securely saved and order created.</p>
                </div>



                <div className="divider" style={{ marginTop: '1rem' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <button
                        onClick={() => {
                            setProofImages([]);
                            setProofCapturedAt([]);
                            setUploadedProofUrls([]);
                            setStep('CAPTURE');
                        }}
                        style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontWeight: 500 }}
                    >
                        Update proof (re-take photos)
                    </button>
                    {uploadedProofUrls.map((href, i) => (
                        <a
                            key={href + i}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem',
                                padding: '0.75rem',
                                background: 'rgba(34, 197, 94, 0.1)',
                                border: '1px solid rgba(34, 197, 94, 0.3)',
                                borderRadius: '0.5rem',
                                color: '#4ade80',
                                textDecoration: 'none',
                                fontWeight: 500,
                                fontSize: '0.875rem'
                            }}
                        >
                            <ImageIcon size={16} />
                            Preview photo {i + 1}
                            <ExternalLink size={14} />
                        </a>
                    ))}
                    <p className="text-subtitle">You can close this window now.</p>
                </div>
            </div>
        );
    }

    // ERROR State
    return (
        <div className="produce-card text-center" style={{ marginTop: '2.5rem', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <div className="error-icon">
                <AlertCircle size={40} />
            </div>
            <div>
                <h2 className="text-title" style={{ color: '#fee2e2', fontSize: '1.25rem' }}>Upload Failed</h2>
                <p className="text-subtitle" style={{ color: '#f87171' }}>{error}</p>
            </div>
            <button
                onClick={() => {
                    setProofImages([]);
                    setProofCapturedAt([]);
                    setStep('CAPTURE');
                }}
                className="btn-secondary"
                style={{ width: '100%' }}
            >
                Try Again
            </button>
        </div>
    );
}
