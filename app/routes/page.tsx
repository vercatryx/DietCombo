'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Route, Calendar } from 'lucide-react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { fetchDrivers } from '@/lib/api';
import { DateFilter } from '@/components/routes/DateFilter';
import styles from './routes.module.css';

// Dynamically import DriversDialog to avoid SSR issues with Leaflet
const DriversDialog = dynamic(() => import('@/components/routes/DriversDialog'), { ssr: false });

function formatDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    } catch {
        return dateStr;
    }
}

export default function RoutesPage() {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [routes, setRoutes] = useState<any[]>([]);
    const [stopsByRouteId, setStopsByRouteId] = useState<Map<string, any[]>>(new Map());
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string>(() => {
        // Set default date to today in YYYY-MM-DD format
        const today = new Date();
        return today.toISOString().split('T')[0];
    });

    useEffect(() => {
        loadData();
    }, [selectedDate]);

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

            // Load routes for display
            const routesData = await fetchDrivers();
            setRoutes(Array.isArray(routesData) ? routesData : []);

            // Load detailed route data with stops (which includes delivery_date)
            // Include delivery_date parameter if a date is selected
            try {
                const apiUrl = selectedDate 
                    ? `/api/route/routes?day=all&delivery_date=${selectedDate}`
                    : '/api/route/routes?day=all';
                const routesDetailRes = await fetch(apiUrl, { cache: 'no-store' });
                if (routesDetailRes.ok) {
                    const routesDetailData = await routesDetailRes.json();
                    const routesWithStops = routesDetailData.routes || [];
                    
                    // Group stops by route (driverId) to match route.id from mobile/routes
                    const stopsMap = new Map<string, any[]>();
                    routesWithStops.forEach((route: any) => {
                        if (route.driverId && route.stops) {
                            const routeId = String(route.driverId);
                            // Filter stops by selected date if date is selected
                            let filteredStops = route.stops || [];
                            if (selectedDate) {
                                filteredStops = filteredStops.filter((stop: any) => {
                                    const stopDate = stop.delivery_date || stop.deliveryDate;
                                    if (!stopDate) return false;
                                    const dateStr = typeof stopDate === 'string' 
                                        ? stopDate.split('T')[0].split(' ')[0]
                                        : String(stopDate).split('T')[0].split(' ')[0];
                                    return dateStr === selectedDate;
                                });
                            }
                            stopsMap.set(routeId, filteredStops);
                        }
                    });
                    setStopsByRouteId(stopsMap);
                }
            } catch (stopsErr) {
                console.warn('Failed to load stops for date grouping:', stopsErr);
            }
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

    // Group routes by delivery date, filtering by selectedDate if provided
    const routesByDate = useMemo(() => {
        const grouped = new Map<string, typeof routes>();
        
        routes.forEach(route => {
            const routeStops = stopsByRouteId.get(String(route.id)) || [];
            
            // If date filter is selected, only show routes that have stops for that date
            // Also filter out routes with no stops after date filtering
            if (selectedDate && routeStops.length === 0) {
                return; // Skip routes with no stops for the selected date
            }
            
            const deliveryDates = new Set<string>();
            
            // Collect all unique delivery dates from stops for this route
            routeStops.forEach((stop: any) => {
                // Check both delivery_date field and deliveryDate field (from order mapping)
                const deliveryDate = stop.delivery_date || stop.deliveryDate;
                if (deliveryDate) {
                    const dateStr = typeof deliveryDate === 'string' 
                        ? deliveryDate.split('T')[0].split(' ')[0] // Get date part only
                        : String(deliveryDate).split('T')[0].split(' ')[0];
                    if (dateStr && dateStr !== 'null' && dateStr !== 'undefined') {
                        deliveryDates.add(dateStr);
                    }
                }
            });
            
            // If date filter is selected, only group by that date
            if (selectedDate) {
                if (deliveryDates.has(selectedDate)) {
                    if (!grouped.has(selectedDate)) {
                        grouped.set(selectedDate, []);
                    }
                    if (!grouped.get(selectedDate)!.some(r => r.id === route.id)) {
                        grouped.get(selectedDate)!.push(route);
                    }
                }
                return; // Skip other date groups when filtering
            }
            
            // If route has no stops with delivery dates, put it in "No Date" group
            if (deliveryDates.size === 0) {
                const key = 'no-date';
                if (!grouped.has(key)) {
                    grouped.set(key, []);
                }
                // Only add route once
                if (!grouped.get(key)!.some(r => r.id === route.id)) {
                    grouped.get(key)!.push(route);
                }
            } else {
                // Add route to each delivery date group it belongs to
                deliveryDates.forEach(dateStr => {
                    if (!grouped.has(dateStr)) {
                        grouped.set(dateStr, []);
                    }
                    // Only add route once per date
                    if (!grouped.get(dateStr)!.some(r => r.id === route.id)) {
                        grouped.get(dateStr)!.push(route);
                    }
                });
            }
        });
        
        // Convert to sorted array (dates in descending order, "No Date" at end)
        const sortedEntries = Array.from(grouped.entries()).sort((a, b) => {
            if (a[0] === 'no-date') return 1;
            if (b[0] === 'no-date') return -1;
            return b[0].localeCompare(a[0]); // Most recent first
        });
        
        return sortedEntries;
    }, [routes, stopsByRouteId, selectedDate]);

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

            <DateFilter
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
                onClear={() => setSelectedDate('')}
            />

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
                    {routesByDate.map(([dateKey, dateRoutes]) => (
                        <div key={dateKey} className={styles.dateSection}>
                            <div className={styles.dateHeader}>
                                <div className={styles.dateTitle}>
                                    <Calendar size={18} style={{ color: 'var(--color-primary)', marginRight: '8px' }} />
                                    {dateKey === 'no-date' ? 'No Delivery Date' : formatDate(dateKey)}
                                </div>
                                <div className={styles.dateCount}>
                                    <span className={styles.badge}>{dateRoutes.length} route{dateRoutes.length !== 1 ? 's' : ''}</span>
                                </div>
                            </div>
                            <div className={styles.routesGrid}>
                                {dateRoutes.map((route) => {
                                    const color = route.color || '#1976d2';
                                    
                                    // Calculate stop counts from filtered stops if date filter is active
                                    const routeStops = stopsByRouteId.get(String(route.id)) || [];
                                    const totalStops = selectedDate ? routeStops.length : (route.totalStops || 0);
                                    const completedStops = selectedDate 
                                        ? routeStops.filter((stop: any) => stop.completed === true).length
                                        : (route.completedStops || 0);
                                    
                                    const progress = totalStops > 0 
                                        ? (completedStops / totalStops) * 100 
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
                                                        {totalStops} stop{totalStops !== 1 ? 's' : ''}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className={styles.progressSection}>
                                                <div className={styles.progressHeader}>
                                                    <span>Progress</span>
                                                    <span>{completedStops} / {totalStops}</span>
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
                        </div>
                    ))}
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
