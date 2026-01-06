'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package, ArrowRight } from 'lucide-react';
import './delivery.css';

export default function DeliveryManualEntryPage() {
    const [orderNum, setOrderNum] = useState('');
    const router = useRouter();

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (orderNum.trim()) {
            router.push(`/delivery/${orderNum.trim()}`);
        }
    }

    return (
        <main className="delivery-page">
            <div className="delivery-container">
                <div className="delivery-card">
                    <div className="text-center">
                        <div className="avatar" style={{ margin: '0 auto 1rem auto', width: '5rem', height: '5rem', backgroundColor: 'rgba(37, 99, 235, 0.1)', color: 'var(--color-primary)' }}>
                            <Package size={40} />
                        </div>
                        <h1 className="text-title">Driver Delivery</h1>
                        <p className="text-subtitle" style={{ marginTop: '0.5rem' }}>Enter Order Number manually if QR code fails.</p>
                    </div>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <input
                                type="text"
                                value={orderNum}
                                onChange={(e) => setOrderNum(e.target.value)}
                                placeholder="Enter Order #"
                                style={{
                                    width: '100%',
                                    backgroundColor: 'var(--bg-panel)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '0.75rem',
                                    padding: '1rem',
                                    textAlign: 'center',
                                    fontSize: '1.25rem',
                                    fontWeight: 'bold',
                                    letterSpacing: '0.05em',
                                    color: 'var(--text-primary)',
                                    outline: 'none'
                                }}
                                autoFocus
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={!orderNum.trim()}
                            className="btn-primary"
                            style={{ opacity: !orderNum.trim() ? 0.5 : 1, cursor: !orderNum.trim() ? 'not-allowed' : 'pointer' }}
                        >
                            Find Order <ArrowRight size={20} />
                        </button>
                    </form>
                </div>
            </div>
        </main>
    );
}
