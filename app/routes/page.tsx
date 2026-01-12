'use client';

import React, { useState, useEffect } from 'react';
import { Route } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { fetchDrivers } from '@/lib/api';
import styles from './routes.module.css';

// Dynamically import DriversDialog to avoid SSR issues with Leaflet
const DriversDialog = dynamic(() => import('@/components/routes/DriversDialog'), { ssr: false });

export default function RoutesPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [routes, setRoutes] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        setError(null);
        try {
            // Load users for the map dialog
            const usersRes = await fetch('/api/users', { cache: 'no-store' });
            if (!usersRes.ok) {
                let errorMessage = 'Failed to load users';
                try {
                    const errorData = await usersRes.json();
                    errorMessage = errorData?.error || errorMessage;
                } catch {
                    // If response is not JSON, use default message
                }
                throw new Error(errorMessage);
            }
            const usersData = await usersRes.json();
            setUsers(Array.isArray(usersData) ? usersData : []);

            // Load routes
            const routesData = await fetchDrivers();
            setRoutes(Array.isArray(routesData) ? routesData : []);
        } catch (err: any) {
            console.error('Failed to load data:', err);
            setError(err?.message || 'Failed to load routes');
        } finally {
            setIsLoading(false);
        }
    }

    function handleUsersPatched(updates: any[]) {
        // Update local users state with patched data
        setUsers(prev => {
            const updated = [...prev];
            updates.forEach(u => {
                const idx = updated.findIndex(usr => String(usr.id) === String(u.id));
                if (idx >= 0) {
                    updated[idx] = { ...updated[idx], ...u };
                }
            });
            return updated;
        });
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <Route size={48} className={styles.loadingIcon} />
                    <p className={styles.loadingText}>Loading routes...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.container}>
                <div className={styles.errorContainer}>
                    <Route size={48} className={styles.errorIcon} />
                    <p className={styles.errorText}>{error}</p>
                    <button className={styles.retryButton} onClick={loadData}>
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <Route size={32} className={styles.headerIcon} />
                    <h1 className={styles.title}>Routes</h1>
                </div>
                <button
                    className={styles.openMapButton}
                    onClick={() => setDialogOpen(true)}
                >
                    <Route size={18} />
                    Open Routes Map
                </button>
            </div>

            {routes.length === 0 ? (
                <div className={styles.emptyState}>
                    <p className={styles.emptyStateTitle}>No routes found</p>
                    <p className={styles.emptyStateText}>
                        There are currently no delivery routes with stops assigned.
                    </p>
                    <p className={styles.emptyStateText}>
                        Click "Open Routes Map" to create and manage routes.
                    </p>
                </div>
            ) : (
                <>
                    <p className={styles.infoText}>
                        Showing <strong>{routes.length}</strong> route{routes.length !== 1 ? 's' : ''} with stops assigned.
                    </p>
                    <div className={styles.routesGrid}>
                        {routes.map((route) => {
                            const color = route.color || '#1976d2';
                            const progress = route.totalStops > 0 
                                ? (route.completedStops / route.totalStops) * 100 
                                : 0;
                            
                            return (
                                <Link
                                    key={route.id}
                                    href={`/drivers/${route.id}`}
                                    className={styles.routeCard}
                                >
                                    <div className={styles.routeHeader}>
                                        <div 
                                            className={styles.routeIcon}
                                            style={{ backgroundColor: color }}
                                        >
                                            R
                                        </div>
                                        <div className={styles.routeInfo}>
                                            <h3 className={styles.routeName}>
                                                {route.name}
                                            </h3>
                                            <p className={styles.routeStops}>
                                                {route.totalStops} stop{route.totalStops !== 1 ? 's' : ''}
                                            </p>
                                        </div>
                                    </div>
                                    <div className={styles.progressSection}>
                                        <div className={styles.progressHeader}>
                                            <span>Progress</span>
                                            <span>{route.completedStops} / {route.totalStops}</span>
                                        </div>
                                        <div className={styles.progressBar}>
                                            <div 
                                                className={styles.progressFill}
                                                style={{ 
                                                    width: `${progress}%`,
                                                    backgroundColor: color
                                                }}
                                            />
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </>
            )}

            <DriversDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                users={users}
                initialDriverCount={6}
                initialSelectedDay="all"
                onUsersPatched={handleUsersPatched}
            />
        </div>
    );
}
