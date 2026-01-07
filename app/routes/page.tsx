'use client';

import React, { useState, useEffect } from 'react';
import { Route } from 'lucide-react';
import { Button, Box } from '@mui/material';
import dynamic from 'next/dynamic';

// Dynamically import DriversDialog to avoid SSR issues with Leaflet
const DriversDialog = dynamic(() => import('@/components/routes/DriversDialog'), { ssr: false });

export default function RoutesPage() {
    const [mounted, setMounted] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);

    useEffect(() => {
        setMounted(true);
        loadUsers();
    }, []);

    async function loadUsers() {
        setIsLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/users', { cache: 'no-store' });
            if (!res.ok) {
                // Try to read error message from response
                let errorMessage = 'Failed to load users';
                try {
                    const errorData = await res.json();
                    errorMessage = errorData?.error || errorMessage;
                } catch {
                    // If response is not JSON, use default message
                }
                throw new Error(errorMessage);
            }
            const data = await res.json();
            setUsers(Array.isArray(data) ? data : []);
        } catch (err: any) {
            console.error('Failed to load users:', err);
            setError(err?.message || 'Failed to load users');
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
                    <Button variant="outlined" onClick={loadUsers} sx={{ mt: 2 }}>
                        Retry
                    </Button>
                </Box>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 4, maxWidth: 1200, margin: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Route size={32} style={{ color: '#1976d2' }} />
                <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>
                    Routes
                </h1>
            </Box>

            <Box sx={{ mb: 3 }}>
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

            <Box sx={{ 
                backgroundColor: '#f5f5f5', 
                border: '1px solid #ddd', 
                borderRadius: 2, 
                p: 3,
                mb: 3
            }}>
                <p style={{ color: '#666', marginBottom: '1rem' }}>
                    Loaded <strong>{users.length}</strong> users for route planning.
                </p>
                <p style={{ color: '#666', fontSize: '0.9rem' }}>
                    Click "Open Routes Map" to access the full routes management interface.
                </p>
            </Box>

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
