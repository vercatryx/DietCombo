'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel, CircularProgress, InputAdornment, Checkbox, Button } from '@mui/material';
import { Search } from 'lucide-react';
import StopPreviewDialog from './StopPreviewDialog';
import dynamic from 'next/dynamic';
const DriversMapLeaflet = dynamic(() => import('./DriversMapLeaflet'), { ssr: false });

interface Client {
    id: string;
    fullName: string;
    firstName?: string | null;
    lastName?: string | null;
    address?: string;
    city?: string;
    state?: string;
    phoneNumber?: string;
    lat?: number | null;
    lng?: number | null;
}

interface Driver {
    id: string;
    name: string;
    driverId?: string;
}

interface ClientDriverAssignmentProps {
    routes: any[];
    selectedDay: string;
    selectedDeliveryDate?: string;
    readOnly?: boolean;
    onDriverAssigned?: () => void;
}

export default function ClientDriverAssignment({
    routes,
    selectedDay,
    selectedDeliveryDate,
    readOnly = false,
    onDriverAssigned
}: ClientDriverAssignmentProps) {
    const [clients, setClients] = useState<Client[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [clientDriverMap, setClientDriverMap] = useState<Map<string, string>>(new Map());
    const [clientStopMap, setClientStopMap] = useState<Map<string, any>>(new Map()); // Store stop info for each client
    const [savingClientId, setSavingClientId] = useState<string | null>(null);
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
    const [bulkDriverId, setBulkDriverId] = useState<string>('');
    const [isBulkSaving, setIsBulkSaving] = useState(false);
    const [previewStop, setPreviewStop] = useState<any | null>(null);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);

    // Extract drivers from routes
    const drivers = useMemo(() => {
        return routes.map(route => ({
            id: route.driverId || route.id,
            name: route.driverName || route.name || 'Unknown Driver',
            driverId: route.driverId || route.id
        }));
    }, [routes]);

    useEffect(() => {
        loadClients();
    }, []);

    async function loadClients() {
        setIsLoading(true);
        try {
            const res = await fetch('/api/users', { cache: 'no-store' });
            if (!res.ok) {
                throw new Error('Failed to load clients');
            }
            const usersData = await res.json();
            
            // Map users to clients format
            const clientsList: Client[] = (usersData || []).map((user: any) => {
                // Build full name: prefer first+last, fallback to full_name, then 'Unnamed'
                const fullName = `${user.first || ''} ${user.last || ''}`.trim() || user.name || user.full_name || 'Unnamed';
                
                return {
                    id: user.id,
                    fullName: fullName,
                    firstName: user.first || null,
                    lastName: user.last || null,
                    address: user.address || '',
                    city: user.city || '',
                    state: user.state || '',
                    phoneNumber: user.phone || '',
                    lat: user.lat != null ? Number(user.lat) : null,
                    lng: user.lng != null ? Number(user.lng) : null
                };
            });

            setClients(clientsList);

            // Load current driver assignments for clients
            await loadClientDriverAssignments(clientsList);
        } catch (error) {
            console.error('Failed to load clients:', error);
        } finally {
            setIsLoading(false);
        }
    }

    async function loadClientDriverAssignments(clientsList: Client[]) {
        try {
            // Fetch clients directly to get their assigned_driver_id
            const res = await fetch('/api/users', { cache: 'no-store' });
            if (!res.ok) return;
            
            const usersData = await res.json();
            
            // Build a map of client ID to driver ID from clients table
            const assignments = new Map<string, string>();
            const stopInfoMap = new Map<string, any>();
            
            // Map users to get assigned_driver_id
            (usersData || []).forEach((user: any) => {
                if (user.id && user.assignedDriverId) {
                    assignments.set(user.id, user.assignedDriverId);
                }
            });
            
            // Also fetch stops to get stop info for status-based color coding
            const url = selectedDeliveryDate 
                ? `/api/route/routes?day=${selectedDay}&delivery_date=${selectedDeliveryDate}`
                : `/api/route/routes?day=${selectedDay}`;
            
            const routesRes = await fetch(url, { cache: 'no-store' });
            if (routesRes.ok) {
                const routesData = await routesRes.json();
                const routes = routesData.routes || [];
                const unroutedStops = routesData.unrouted || [];
                
                // Build stop info map from routes and unrouted stops
                routes.forEach((route: any) => {
                    const stops = route.stops || [];
                    stops.forEach((stop: any) => {
                        if (stop.userId || stop.clientId) {
                            const clientId = stop.userId || stop.clientId;
                            if (!stopInfoMap.has(clientId)) {
                                stopInfoMap.set(clientId, stop);
                            }
                        }
                    });
                });
                
                unroutedStops.forEach((stop: any) => {
                    if (stop.userId || stop.clientId) {
                        const clientId = stop.userId || stop.clientId;
                        if (!stopInfoMap.has(clientId)) {
                            stopInfoMap.set(clientId, stop);
                        }
                    }
                });
            }
            
            setClientDriverMap(assignments);
            setClientStopMap(stopInfoMap);
        } catch (error) {
            console.error('Failed to load client driver assignments:', error);
        }
    }

    async function handleDriverChange(clientId: string, driverId: string) {
        setSavingClientId(clientId);
        try {
            const res = await fetch('/api/route/assign-client-driver', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId,
                    driverId: driverId || null,
                    day: selectedDay,
                    delivery_date: selectedDeliveryDate || undefined
                })
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({ error: 'Failed to assign driver' }));
                throw new Error(errorData.error || 'Failed to assign driver');
            }

            // Update local state
            const newMap = new Map(clientDriverMap);
            if (driverId) {
                newMap.set(clientId, driverId);
            } else {
                newMap.delete(clientId);
            }
            setClientDriverMap(newMap);

            // Notify parent to refresh routes if callback provided
            if (onDriverAssigned) {
                onDriverAssigned();
            }
        } catch (error) {
            console.error('Failed to assign driver:', error);
            alert(`Failed to assign driver: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setSavingClientId(null);
        }
    }

    async function handleBulkDriverAssignment() {
        if (selectedClientIds.size === 0) {
            alert('Please select at least one client');
            return;
        }

        if (!bulkDriverId) {
            alert('Please select a driver');
            return;
        }

        setIsBulkSaving(true);
        const clientIdsArray = Array.from(selectedClientIds);
        let successCount = 0;
        let failCount = 0;

        try {
            // Assign driver to all selected clients
            const promises = clientIdsArray.map(async (clientId) => {
                try {
                    const res = await fetch('/api/route/assign-client-driver', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            clientId,
                            driverId: bulkDriverId,
                            day: selectedDay,
                            delivery_date: selectedDeliveryDate || undefined
                        })
                    });

                    if (res.ok) {
                        successCount++;
                        return { success: true, clientId };
                    } else {
                        failCount++;
                        return { success: false, clientId };
                    }
                } catch (error) {
                    failCount++;
                    return { success: false, clientId };
                }
            });

            await Promise.all(promises);

            // Update local state
            const newMap = new Map(clientDriverMap);
            clientIdsArray.forEach(clientId => {
                newMap.set(clientId, bulkDriverId);
            });
            setClientDriverMap(newMap);

            // Clear selection
            setSelectedClientIds(new Set());

            // Notify parent to refresh routes
            if (onDriverAssigned) {
                onDriverAssigned();
            }

            if (failCount > 0) {
                alert(`Assigned driver to ${successCount} client(s). Failed to assign to ${failCount} client(s).`);
            } else {
                alert(`Successfully assigned driver to ${successCount} client(s).`);
            }
        } catch (error) {
            console.error('Bulk assignment failed:', error);
            alert(`Failed to assign driver: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsBulkSaving(false);
        }
    }

    function handleSelectClient(clientId: string, checked: boolean) {
        const newSelected = new Set(selectedClientIds);
        if (checked) {
            newSelected.add(clientId);
        } else {
            newSelected.delete(clientId);
        }
        setSelectedClientIds(newSelected);
    }

    // Filter clients by search term
    const filteredClients = useMemo(() => {
        if (!searchTerm.trim()) return clients;
        
        const term = searchTerm.toLowerCase();
        return clients.filter(client => 
            client.fullName.toLowerCase().includes(term) ||
            client.address?.toLowerCase().includes(term) ||
            client.city?.toLowerCase().includes(term) ||
            client.phoneNumber?.toLowerCase().includes(term)
        );
    }, [clients, searchTerm]);

    function handleSelectAll(checked: boolean) {
        if (checked) {
            setSelectedClientIds(new Set(filteredClients.map(c => c.id)));
        } else {
            setSelectedClientIds(new Set());
        }
    }

    const allSelected = filteredClients.length > 0 && filteredClients.every(c => selectedClientIds.has(c.id));
    const someSelected = filteredClients.some(c => selectedClientIds.has(c.id));

    // Helper function to get color based on stop/order status
    // Only returns colors for specific statuses that should override default styling
    function getStopStatusColor(stop: any): string | null {
        if (!stop) return null;
        
        // Priority: Order status (only override for specific statuses)
        const orderStatus = stop?.orderStatus?.toLowerCase();
        if (orderStatus) {
            switch (orderStatus) {
                case "cancelled":
                    return "#ef4444"; // Red for cancelled orders
                case "waiting_for_proof":
                    return "#f59e0b"; // Orange/Amber for waiting for proof
                case "billing_pending":
                    return "#8b5cf6"; // Purple for billing pending
                case "completed":
                case "pending":
                case "scheduled":
                case "confirmed":
                default:
                    return null; // No special color - use default styling
            }
        }
        
        // Stop completed status without order status - no special color
        return null;
    }

    // Convert clients to stops format for the map
    // NOTE: All hooks must be called before any conditional returns
    const mapStops = useMemo(() => {
        return filteredClients
            .filter(client => {
                // Only include clients with geolocation from client table
                const lat = client.lat;
                const lng = client.lng;
                return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
            })
            .map(client => {
                const stopInfo = clientStopMap.get(client.id);
                const currentDriverId = clientDriverMap.get(client.id) || null;
                
                // Find which driver this client is assigned to
                const assignedDriver = currentDriverId 
                    ? routes.find(r => String(r.driverId || r.id) === String(currentDriverId))
                    : null;
                
                return {
                    id: client.id,
                    userId: client.id,
                    clientId: client.id,
                    name: client.fullName,
                    first: client.firstName,
                    last: client.lastName,
                    firstName: client.firstName,
                    lastName: client.lastName,
                    fullName: client.fullName,
                    full_name: client.fullName,
                    address: stopInfo?.address || client.address || '',
                    apt: stopInfo?.apt || '',
                    city: stopInfo?.city || client.city || '',
                    state: stopInfo?.state || client.state || '',
                    zip: stopInfo?.zip || '',
                    phone: stopInfo?.phone || client.phoneNumber || '',
                    lat: client.lat, // Use lat from client table
                    lng: client.lng, // Use lng from client table
                    __driverId: currentDriverId,
                    __driverName: assignedDriver?.driverName || assignedDriver?.name || null,
                    __driverColor: assignedDriver?.color || null,
                    orderId: stopInfo?.orderId || stopInfo?.order_id || null,
                    orderStatus: stopInfo?.orderStatus || stopInfo?.order?.status || null,
                    completed: stopInfo?.completed || false,
                    dislikes: stopInfo?.dislikes || null,
                };
            });
    }, [filteredClients, clientStopMap, clientDriverMap, routes]);

    // Convert routes to map drivers format
    const mapDrivers = useMemo(() => {
        const palette = [
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
            "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
            "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
        ];
        
        return routes.map((route, i) => {
            const driverId = String(route.driverId || route.id);
            const color = route.color || palette[i % palette.length];
            const driverName = route.driverName || route.name || `Driver ${i}`;
            
            // Get stops assigned to this driver from our map stops
            const driverStops = mapStops.filter(s => String(s.__driverId) === String(driverId));
            
            return {
                id: driverId,
                driverId: driverId,
                name: driverName,
                color: color,
                polygon: [],
                stops: driverStops
            };
        });
    }, [routes, mapStops]);

    // Unrouted stops (clients without driver assignment)
    const unroutedStops = useMemo(() => {
        return mapStops.filter(s => !s.__driverId);
    }, [mapStops]);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4 }}>
                <CircularProgress size={24} />
                <Typography sx={{ ml: 2 }}>Loading clients...</Typography>
            </Box>
        );
    }

    // Handle reassign from map
    const handleMapReassign = async (stop: any, toDriverId: string) => {
        const clientId = stop.userId || stop.clientId || stop.id;
        if (!clientId) {
            console.error('No client ID found in stop:', stop);
            return;
        }
        await handleDriverChange(clientId, toDriverId || '');
    };

    const clientsWithoutGeo = filteredClients.length - mapStops.length;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #e5e7eb', backgroundColor: 'white', zIndex: 10 }}>
                <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                    Client Driver Assignment
                </Typography>
                <Typography variant="body2" sx={{ color: '#6b7280', mb: 1 }}>
                    Showing {mapStops.length} of {filteredClients.length} clients with geolocation
                    {selectedClientIds.size > 0 && ` • ${selectedClientIds.size} selected`}
                </Typography>
                {clientsWithoutGeo > 0 && (
                    <Typography variant="caption" sx={{ color: '#f59e0b', display: 'block', mb: 1 }}>
                        ⚠️ {clientsWithoutGeo} client{clientsWithoutGeo !== 1 ? 's' : ''} without geolocation {clientsWithoutGeo !== 1 ? 'are' : 'is'} not shown on map
                    </Typography>
                )}
            </Box>

            {/* Map View */}
            <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
                <DriversMapLeaflet
                    drivers={mapDrivers}
                    unrouted={unroutedStops}
                    onReassign={readOnly ? undefined : handleMapReassign}
                    busy={isBulkSaving}
                    readonly={readOnly}
                    initialCenter={[40.7128, -74.006]}
                    initialZoom={10}
                />
            </Box>

            {/* Stop Preview Dialog */}
            <StopPreviewDialog
                open={previewDialogOpen}
                onClose={() => {
                    setPreviewDialogOpen(false);
                    setPreviewStop(null);
                }}
                stop={previewStop}
                drivers={drivers}
                onDriverChange={async (stop: any, driverId: string) => {
                    const clientId = stop.userId || stop.clientId || stop.id;
                    if (clientId) {
                        await handleDriverChange(clientId, driverId);
                    }
                }}
            />
        </Box>
    );
}
