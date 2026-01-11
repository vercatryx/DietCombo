'use client';

import React, { useState, useEffect } from 'react';
import { Route } from 'lucide-react';
import { Button, Box } from '@mui/material';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { fetchDrivers } from '@/lib/api';

// Dynamically import DriversDialog to avoid SSR issues with Leaflet
const DriversDialog = dynamic(() => import('@/components/routes/DriversDialog'), { ssr: false });

export default function RoutesPage() {
    const [mounted, setMounted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [routes, setRoutes] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
        setMounted(true);
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

    // Prevent hydration mismatch by not rendering MUI components during SSR
    if (!mounted) {
        return null;
    }

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <Box sx={{ textAlign: 'center' }}>
                    <Route size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                    <p style={{ color: '#666' }}>Loading routes...</p>
                </Box>
            </Box>
        );
    }

    if (error) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                <Box sx={{ textAlign: 'center', color: '#d32f2f' }}>
                    <Route size={48} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
                    <p>{error}</p>
                    <Button variant="outlined" onClick={loadData} sx={{ mt: 2 }}>
                        Retry
                    </Button>
                </Box>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 4, maxWidth: 1200, margin: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Route size={32} style={{ color: '#1976d2' }} />
                    <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>
                        Routes
                    </h1>
                </Box>
                <Button
                    variant="contained"
                    size="large"
                    onClick={() => setDialogOpen(true)}
                    startIcon={<Route />}
                    sx={{ fontWeight: 700 }}
                >
                    Open Routes Map
                </Button>
            </Box>

            {routes.length === 0 ? (
                <Box sx={{ 
                    backgroundColor: '#f5f5f5', 
                    border: '1px solid #ddd', 
                    borderRadius: 2, 
                    p: 3,
                    textAlign: 'center'
                }}>
                    <p style={{ color: '#666', marginBottom: '0.5rem', fontSize: '1.1rem' }}>
                        No routes found
                    </p>
                    <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem' }}>
                        There are currently no delivery routes with stops assigned.
                    </p>
                    <p style={{ color: '#666', fontSize: '0.9rem' }}>
                        Click "Open Routes Map" to create and manage routes.
                    </p>
                </Box>
            ) : (
                <>
                    <Box sx={{ mb: 2 }}>
                        <p style={{ color: '#666', fontSize: '0.9rem' }}>
                            Showing <strong>{routes.length}</strong> route{routes.length !== 1 ? 's' : ''} with stops assigned.
                        </p>
                    </Box>
                    <Box sx={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
                        gap: 2,
                        mb: 3
                    }}>
                        {routes.map((route) => {
                            const color = route.color || '#1976d2';
                            const progress = route.totalStops > 0 
                                ? (route.completedStops / route.totalStops) * 100 
                                : 0;
                            
                            return (
                                <Link
                                    key={route.id}
                                    href={`/drivers/${route.id}`}
                                    style={{ textDecoration: 'none', color: 'inherit' }}
                                >
                                    <Box sx={{
                                        border: '1px solid #ddd',
                                        borderRadius: 2,
                                        p: 2,
                                        backgroundColor: '#fff',
                                        cursor: 'pointer',
                                        transition: 'box-shadow 0.2s',
                                        '&:hover': {
                                            boxShadow: 2
                                        }
                                    }}>
                                        <Box sx={{ 
                                            display: 'flex', 
                                            alignItems: 'center', 
                                            gap: 1.5,
                                            mb: 1.5
                                        }}>
                                            <Box sx={{
                                                width: 40,
                                                height: 40,
                                                borderRadius: 1,
                                                backgroundColor: color,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: '#fff',
                                                fontWeight: 600
                                            }}>
                                                R
                                            </Box>
                                            <Box sx={{ flex: 1 }}>
                                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
                                                    {route.name}
                                                </h3>
                                                <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#666' }}>
                                                    {route.totalStops} stop{route.totalStops !== 1 ? 's' : ''}
                                                </p>
                                            </Box>
                                        </Box>
                                        <Box sx={{ mt: 1.5 }}>
                                            <Box sx={{ 
                                                display: 'flex', 
                                                justifyContent: 'space-between',
                                                fontSize: '0.85rem',
                                                color: '#666',
                                                mb: 0.5
                                            }}>
                                                <span>Progress</span>
                                                <span>{route.completedStops} / {route.totalStops}</span>
                                            </Box>
                                            <Box sx={{
                                                width: '100%',
                                                height: 8,
                                                backgroundColor: '#e0e0e0',
                                                borderRadius: 4,
                                                overflow: 'hidden'
                                            }}>
                                                <Box sx={{
                                                    width: `${progress}%`,
                                                    height: '100%',
                                                    backgroundColor: color,
                                                    transition: 'width 0.3s'
                                                }} />
                                            </Box>
                                        </Box>
                                    </Box>
                                </Link>
                            );
                        })}
                    </Box>
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
        </Box>
    );
}
