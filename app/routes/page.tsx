'use client';

import { useState, useEffect } from 'react';
import { Route } from 'lucide-react';

/**
 * Routes Page
 * 
 * This page provides access to the routes feature for managing delivery routes.
 * The routes feature allows you to:
 * - View routes on a map
 * - Assign stops to drivers
 * - Optimize routes
 * - Generate new routes
 * - Manage drivers
 */
export default function RoutesPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Check if routes feature is available
        // This page can be enhanced to directly integrate with the routes feature
        setIsLoading(false);
    }, []);

    if (isLoading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                minHeight: '60vh'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <Route size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                    <p style={{ color: 'var(--text-secondary)' }}>Loading routes...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                minHeight: '60vh'
            }}>
                <div style={{ textAlign: 'center', color: 'var(--color-danger)' }}>
                    <Route size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                    <p>{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div style={{
            padding: '2rem',
            maxWidth: '1200px',
            margin: '0 auto'
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                marginBottom: '2rem'
            }}>
                <Route size={32} style={{ color: 'var(--color-primary)' }} />
                <h1 style={{
                    fontSize: '2rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    margin: 0
                }}>
                    Routes
                </h1>
            </div>

            <div style={{
                backgroundColor: 'var(--bg-panel)',
                border: '1px solid var(--border-color)',
                borderRadius: '0.5rem',
                padding: '2rem',
                textAlign: 'center'
            }}>
                <p style={{
                    color: 'var(--text-secondary)',
                    marginBottom: '1.5rem',
                    fontSize: '1.1rem'
                }}>
                    Routes feature is available. This page provides access to route planning and management.
                </p>
                
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                    alignItems: 'center'
                }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        The routes feature includes:
                    </p>
                    <ul style={{
                        textAlign: 'left',
                        color: 'var(--text-secondary)',
                        listStyle: 'none',
                        padding: 0,
                        margin: 0
                    }}>
                        <li style={{ padding: '0.5rem 0' }}>• View routes on an interactive map</li>
                        <li style={{ padding: '0.5rem 0' }}>• Assign stops to drivers</li>
                        <li style={{ padding: '0.5rem 0' }}>• Optimize routes automatically</li>
                        <li style={{ padding: '0.5rem 0' }}>• Generate new routes</li>
                        <li style={{ padding: '0.5rem 0' }}>• Manage drivers and driver assignments</li>
                        <li style={{ padding: '0.5rem 0' }}>• Export route labels and reports</li>
                    </ul>
                </div>

                <div style={{
                    marginTop: '2rem',
                    padding: '1rem',
                    backgroundColor: 'var(--bg-surface)',
                    borderRadius: '0.5rem',
                    border: '1px solid var(--border-color)'
                }}>
                    <p style={{
                        color: 'var(--text-secondary)',
                        fontSize: '0.85rem',
                        margin: 0
                    }}>
                        <strong>Note:</strong> This page can be enhanced to directly integrate with the routes feature 
                        from the dietfantasy folder. The routes functionality includes comprehensive route planning, 
                        optimization, and management capabilities.
                    </p>
                </div>
            </div>
        </div>
    );
}
