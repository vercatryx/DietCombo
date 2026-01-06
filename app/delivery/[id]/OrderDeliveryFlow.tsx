'use client';

import { useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import { processDeliveryProof } from '../actions';
import { Camera, CheckCircle, Upload, RefreshCw, AlertCircle, MapPin, X } from 'lucide-react';
import '../delivery.css';

interface OrderDetails {
    id: string;
    orderNumber: string;
    clientName: string;
    address: string;
    deliveryDate: string;
    alreadyDelivered: boolean;
}

export function OrderDeliveryFlow({ order }: { order: OrderDetails }) {
    const [step, setStep] = useState<'VERIFY' | 'CAPTURE' | 'PREVIEW' | 'UPLOADING' | 'SUCCESS' | 'ERROR'>(
        order.alreadyDelivered ? 'SUCCESS' : 'VERIFY'
    );
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [error, setError] = useState<string>('');
    const webcamRef = useRef<Webcam>(null);

    const capture = useCallback(() => {
        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) {
            setImageSrc(imageSrc);
            setStep('PREVIEW');
        }
    }, [webcamRef]);

    async function handleUpload() {
        if (!imageSrc) return;

        setStep('UPLOADING');

        // Convert base64 to blob
        const res = await fetch(imageSrc);
        const blob = await res.blob();
        const file = new File([blob], "delivery-proof.jpg", { type: "image/jpeg" });

        const formData = new FormData();
        formData.append('file', file);
        formData.append('orderNumber', order.id);

        console.log('[Client Debug] Calling processDeliveryProof with:', {
            orderId: order.id,
            fileSize: file.size,
            orderNumber: order.orderNumber
        });

        try {
            const result = await processDeliveryProof(formData);
            console.log('[Client Debug] processDeliveryProof result:', result);

            if (result.success) {
                setStep('SUCCESS');
            } else {
                console.error('[Client Debug] Server returned error:', result.error);
                setError(result.error || 'Upload failed');
                setStep('ERROR');
            }
        } catch (err: any) {
            console.error('[Client Debug] FATAL ERROR calling processDeliveryProof:', err);
            setError(err?.message || 'Network or Server Error occurred');
            setStep('ERROR');
        }
    }

    if (step === 'VERIFY') {
        return (
            <div className="delivery-card">
                <div className="text-center">
                    <span className="delivery-badge">
                        Verify Delivery
                    </span>
                    <h2 className="text-title">
                        Order #{order.orderNumber}
                    </h2>
                    <p className="text-subtitle">
                        {new Date(order.deliveryDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}
                    </p>
                </div>

                <div className="info-panel">
                    <div className="info-row">
                        <div className="avatar">
                            {order.clientName.charAt(0)}
                        </div>
                        <div>
                            <p className="info-label">Client</p>
                            <p className="info-value">{order.clientName}</p>
                        </div>
                    </div>

                    <div className="divider" />

                    <div className="info-row">
                        <div className="info-label">
                            <MapPin size={20} />
                        </div>
                        <div>
                            <p className="info-label">Delivery Address</p>
                            <p className="info-value">{order.address}</p>
                        </div>
                    </div>
                </div>

                <button
                    onClick={() => setStep('CAPTURE')}
                    className="btn-primary"
                >
                    <Camera size={24} />
                    Take Photo using Camera
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

                    <button
                        onClick={() => setStep('VERIFY')}
                        className="close-btn"
                    >
                        <X size={32} />
                    </button>
                </div>

                <div className="camera-controls">
                    <button
                        onClick={capture}
                        className="shutter-btn"
                    />
                </div>
            </div>
        );
    }

    if (step === 'PREVIEW') {
        return (
            <div className="camera-overlay-full">
                <div className="camera-view" style={{ backgroundColor: 'black' }}>
                    {imageSrc && (
                        <img
                            src={imageSrc}
                            alt="Preview"
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                    )}
                </div>
                <div className="preview-actions">
                    <button
                        onClick={handleUpload}
                        className="btn-primary"
                        style={{ backgroundColor: '#16a34a' }}
                    >
                        <Upload size={24} />
                        Submit Proof
                    </button>
                    <button
                        onClick={() => {
                            setImageSrc(null);
                            setStep('CAPTURE');
                        }}
                        className="btn-secondary"
                        style={{ backgroundColor: 'var(--bg-surface)' }}
                    >
                        Retake
                    </button>
                </div>
            </div>
        );
    }

    if (step === 'UPLOADING') {
        return (
            <div className="delivery-card text-center" style={{ marginTop: '2.5rem' }}>
                <div className="spinner" style={{ margin: '0 auto', width: '4rem', height: '4rem', borderTopColor: 'var(--color-primary)' }}></div>
                <div>
                    <h3 className="text-title" style={{ fontSize: '1.25rem' }}>Uploading...</h3>
                    <p className="text-subtitle">Saving proof of delivery</p>
                </div>
            </div>
        );
    }

    if (step === 'SUCCESS') {
        return (
            <div className="delivery-card text-center" style={{ marginTop: '2.5rem', borderColor: 'rgba(34, 197, 94, 0.3)' }}>
                <div className="success-icon">
                    <CheckCircle size={48} />
                </div>
                <div>
                    <h2 className="text-title">Delivered!</h2>
                    <p className="text-subtitle" style={{ color: '#4ade80', fontSize: '1.125rem' }}>Order #{order.orderNumber}</p>
                    <p className="text-subtitle" style={{ marginTop: '1rem' }}>Proof has been securely saved.</p>
                </div>

                {order.alreadyDelivered && (
                    <div style={{ backgroundColor: 'rgba(234, 179, 8, 0.1)', color: '#eab308', padding: '0.75rem', borderRadius: '0.5rem', fontSize: '0.875rem' }}>
                        This order was already marked as delivered.
                    </div>
                )}

                <div className="divider" style={{ marginTop: '1rem' }} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <button
                        onClick={() => setStep('CAPTURE')}
                        style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontWeight: 500 }}
                    >
                        Update Proof (Re-take Photo)
                    </button>
                    <p className="text-subtitle">You can close this window now.</p>
                </div>
            </div>
        );
    }

    // ERROR State
    return (
        <div className="delivery-card text-center" style={{ marginTop: '2.5rem', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
            <div className="error-icon">
                <AlertCircle size={40} />
            </div>
            <div>
                <h2 className="text-title" style={{ color: '#fee2e2', fontSize: '1.25rem' }}>Upload Failed</h2>
                <p className="text-subtitle" style={{ color: '#f87171' }}>{error}</p>
            </div>
            <button
                onClick={() => setStep('CAPTURE')}
                className="btn-secondary"
                style={{ width: '100%' }}
            >
                Try Again
            </button>
        </div>
    );
}
