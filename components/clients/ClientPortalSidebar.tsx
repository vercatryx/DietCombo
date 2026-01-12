'use client';

import React from 'react';
import { logout } from '@/lib/auth-actions';
import { User, Mail, Phone, MapPin, Package, Truck, Info, CreditCard, LogOut } from 'lucide-react';
import { ClientProfile } from '@/lib/types';
import styles from './ClientPortal.module.css';

interface Props {
    client: ClientProfile;
}

export default function ClientPortalSidebar({ client }: Props) {
    return (
        <div className={styles.sidebarColumn} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
                {/* Header / Avatar */}
                <div style={{ marginBottom: '32px', textAlign: 'center' }}>
                    <div style={{
                        width: '80px',
                        height: '80px',
                        background: 'var(--color-primary-light)',
                        borderRadius: '50%',
                        margin: '0 auto 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-primary)',
                        fontSize: '2rem',
                        fontWeight: 600
                    }}>
                        {client.fullName.charAt(0)}
                    </div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 4px', color: 'var(--text-primary)' }}>
                        {client.fullName}
                    </h2>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Client Portal
                    </div>
                </div>

                {/* Info Sections */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                    {/* Contact Info */}
                    <div className="section">
                        <h3 style={{
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: 'var(--text-tertiary)',
                            marginBottom: '12px',
                            fontWeight: 600
                        }}>
                            Contact Details
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {client.email && (
                                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    <Mail size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                                    <span style={{ wordBreak: 'break-all' }}>{client.email}</span>
                                </div>
                            )}
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                <Phone size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                                <span>{client.phoneNumber}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                <MapPin size={16} style={{ marginTop: '2px', flexShrink: 0 }} />
                                <span>{client.address}</span>
                            </div>
                        </div>
                    </div>

                    {/* Service Info */}
                    <div className="section">
                        <h3 style={{
                            fontSize: '0.75rem',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            color: 'var(--text-tertiary)',
                            marginBottom: '12px',
                            fontWeight: 600
                        }}>
                            Service Plan
                        </h3>
                        <div style={{
                            padding: '16px',
                            background: 'var(--bg-app)',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                {client.serviceType === 'Food' ? <UtensilsIcon /> : <Package size={18} />}
                                <span>{client.serviceType} Service</span>
                            </div>

                            {client.serviceType === 'Food' ? (
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <CreditCard size={14} />
                                    <span>Approved: <strong>{client.approvedMealsPerWeek || 0}</strong> meals/week</span>
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <CreditCard size={14} />
                                    <span>Authorized: <strong>{client.authorizedAmount || 'Standard'}</strong> boxes</span>
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>

            {/* Logout Button */}
            <div style={{ padding: '24px', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
                <form action={logout}>
                    <button
                        type="submit"
                        className="btn btn-ghost" // Assuming this class exists, otherwise basic styles
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: '12px',
                            padding: '10px 12px',
                            color: 'var(--text-secondary)',
                            borderRadius: '8px',
                            transition: 'all 0.2s',
                            cursor: 'pointer',
                            border: 'none',
                            background: 'transparent',
                            fontSize: '0.95rem'
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-app)'; e.currentTarget.style.color = 'var(--color-danger)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >
                        <LogOut size={18} />
                        <span>Sign Out</span>
                    </button>
                </form>
            </div>
        </div>
    );
}

function UtensilsIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" />
            <path d="M7 2v20" />
            <path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />
        </svg>
    )
}
