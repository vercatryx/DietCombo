'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel, CircularProgress, InputAdornment, Checkbox, Button } from '@mui/material';
import { Search } from 'lucide-react';

interface Client {
    id: string;
    fullName: string;
    firstName?: string | null;
    lastName?: string | null;
    address?: string;
    city?: string;
    state?: string;
    phoneNumber?: string;
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
    const [savingClientId, setSavingClientId] = useState<string | null>(null);
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
    const [bulkDriverId, setBulkDriverId] = useState<string>('');
    const [isBulkSaving, setIsBulkSaving] = useState(false);

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
            const clientsList: Client[] = (usersData || []).map((user: any) => ({
                id: user.id,
                fullName: `${user.first || ''} ${user.last || ''}`.trim() || user.name || 'Unnamed',
                firstName: user.first || null,
                lastName: user.last || null,
                address: user.address || '',
                city: user.city || '',
                state: user.state || '',
                phoneNumber: user.phone || ''
            }));

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
            // Fetch stops to see which driver is assigned to each client
            const url = selectedDeliveryDate 
                ? `/api/route/routes?day=${selectedDay}&delivery_date=${selectedDeliveryDate}`
                : `/api/route/routes?day=${selectedDay}`;
            
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return;
            
            const data = await res.json();
            const routesData = data.routes || [];
            
            // Build a map of client ID to driver ID from stops
            const assignments = new Map<string, string>();
            
            routesData.forEach((route: any) => {
                const driverId = route.driverId || route.id;
                const stops = route.stops || [];
                
                stops.forEach((stop: any) => {
                    if (stop.userId || stop.clientId) {
                        const clientId = stop.userId || stop.clientId;
                        // If client has multiple stops with different drivers, keep the first one
                        if (!assignments.has(clientId)) {
                            assignments.set(clientId, driverId);
                        }
                    }
                });
            });
            
            setClientDriverMap(assignments);
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

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 4 }}>
                <CircularProgress size={24} />
                <Typography sx={{ ml: 2 }}>Loading clients...</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #e5e7eb' }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
                    Client Driver Assignment
                </Typography>
                <TextField
                    fullWidth
                    size="small"
                    placeholder="Search clients by name, address, city, or phone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <Search size={18} style={{ color: '#6b7280' }} />
                            </InputAdornment>
                        )
                    }}
                    sx={{ mb: 2 }}
                />
                
                {/* Bulk Assignment Controls */}
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1, flexWrap: 'wrap' }}>
                    <FormControl size="small" sx={{ minWidth: 200 }}>
                        <InputLabel>Assign Driver to Selected</InputLabel>
                        <Select
                            value={bulkDriverId}
                            label="Assign Driver to Selected"
                            onChange={(e) => setBulkDriverId(e.target.value)}
                            disabled={readOnly || isBulkSaving || drivers.length === 0 || selectedClientIds.size === 0}
                        >
                            <MenuItem value="">
                                <em>Select Driver</em>
                            </MenuItem>
                            {drivers.map((driver) => (
                                <MenuItem key={driver.id} value={driver.id}>
                                    {driver.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Button
                        variant="contained"
                        size="small"
                        onClick={handleBulkDriverAssignment}
                        disabled={readOnly || isBulkSaving || selectedClientIds.size === 0 || !bulkDriverId}
                        sx={{ minWidth: 120 }}
                    >
                        {isBulkSaving ? (
                            <>
                                <CircularProgress size={16} sx={{ mr: 1 }} />
                                Assigning...
                            </>
                        ) : (
                            `Apply to ${selectedClientIds.size}`
                        )}
                    </Button>
                    {selectedClientIds.size > 0 && (
                        <Button
                            variant="outlined"
                            size="small"
                            onClick={() => setSelectedClientIds(new Set())}
                            disabled={readOnly || isBulkSaving}
                        >
                            Clear Selection
                        </Button>
                    )}
                </Box>
                
                <Typography variant="body2" sx={{ color: '#6b7280', mt: 1 }}>
                    Showing {filteredClients.length} of {clients.length} clients
                    {selectedClientIds.size > 0 && ` • ${selectedClientIds.size} selected`}
                </Typography>
            </Box>

            <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
                {filteredClients.length === 0 ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                        <Typography variant="body2" sx={{ color: '#6b7280' }}>
                            {searchTerm ? 'No clients found matching your search.' : 'No clients available.'}
                        </Typography>
                    </Box>
                ) : (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        {/* Select All Checkbox */}
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                p: 1,
                                border: '1px solid #e5e7eb',
                                borderRadius: 1,
                                backgroundColor: '#f9fafb',
                                position: 'sticky',
                                top: 0,
                                zIndex: 1
                            }}
                        >
                            <Checkbox
                                checked={allSelected}
                                indeterminate={someSelected && !allSelected}
                                onChange={(e) => handleSelectAll(e.target.checked)}
                                disabled={readOnly}
                                size="small"
                            />
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                Select All ({filteredClients.length} clients)
                            </Typography>
                        </Box>

                        {/* Client List */}
                        {filteredClients.map((client) => {
                            const currentDriverId = clientDriverMap.get(client.id) || '';
                            const isSaving = savingClientId === client.id;
                            const isSelected = selectedClientIds.has(client.id);

                            return (
                                <Box
                                    key={client.id}
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 2,
                                        p: 1.5,
                                        border: '1px solid #e5e7eb',
                                        borderRadius: 1,
                                        backgroundColor: isSelected 
                                            ? '#e3f2fd' 
                                            : isSaving 
                                                ? '#f9fafb' 
                                                : 'white',
                                        '&:hover': {
                                            backgroundColor: isSelected ? '#e3f2fd' : '#f9fafb'
                                        }
                                    }}
                                >
                                    <Checkbox
                                        checked={isSelected}
                                        onChange={(e) => handleSelectClient(client.id, e.target.checked)}
                                        disabled={readOnly}
                                        size="small"
                                    />
                                    
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>
                                            {client.fullName}
                                        </Typography>
                                        {(client.address || client.city) && (
                                            <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                                                {[client.address, client.city, client.state].filter(Boolean).join(', ')}
                                            </Typography>
                                        )}
                                        {client.phoneNumber && (
                                            <Typography variant="caption" sx={{ color: '#6b7280', display: 'block' }}>
                                                {client.phoneNumber}
                                            </Typography>
                                        )}
                                    </Box>

                                    <FormControl size="small" sx={{ minWidth: 200 }}>
                                        <InputLabel>Driver</InputLabel>
                                        <Select
                                            value={currentDriverId}
                                            label="Driver"
                                            onChange={(e) => handleDriverChange(client.id, e.target.value)}
                                            disabled={readOnly || isSaving || drivers.length === 0}
                                        >
                                            <MenuItem value="">
                                                <em>None</em>
                                            </MenuItem>
                                            {drivers.map((driver) => (
                                                <MenuItem key={driver.id} value={driver.id}>
                                                    {driver.name}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>

                                    {isSaving && (
                                        <CircularProgress size={16} sx={{ ml: 1 }} />
                                    )}
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </Box>
        </Box>
    );
}
