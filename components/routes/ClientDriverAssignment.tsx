'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel, InputAdornment, Checkbox, Button } from '@mui/material';
import { Search } from 'lucide-react';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import StopPreviewDialog from './StopPreviewDialog';
import dynamic from 'next/dynamic';
const DriversMapLeaflet = dynamic(() => import('./DriversMapLeaflet'), { ssr: false });

/** True if client has food delivery (show on routes map). Produce-only clients are excluded. */
function hasFoodServiceType(serviceType: string | null | undefined): boolean {
    const st = (serviceType ?? '').trim().toLowerCase();
    if (!st) return false;
    return st.includes('food');
}

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
    /** Dependants have a parent. Map shows food clients (primaries + dependants); produce-only are hidden. */
    parentClientId?: string | null;
    serviceType?: string | null;
    service_type?: string | null;
}

interface Driver {
    id: string;
    name: string;
    driverId?: string;
}

interface DriverInfo {
    id: string;
    name: string;
    color?: string | null;
}

export interface ClientStatsForRoutes {
    total_clients: number;
    total_dependants: number;
    total_primaries_food: number;
    total_produce: number;
    primary_paused_or_delivery_off: number;
    primary_food_missing_geo: number;
    /** Delivery-eligible dependants missing lat/lng (shown in Needs Geocoding tab). */
    dependant_missing_geo?: number;
}

interface ClientDriverAssignmentProps {
    /** Clients from assignment-data API (with assigned_driver_id). No fetch inside. */
    initialClients: any[];
    /** Drivers from assignment-data API: id, name, color. */
    drivers: DriverInfo[];
    /** Summary counts for routes page (all clients, dependants, primaries food, produce, etc.). */
    stats?: ClientStatsForRoutes | null;
    assignmentDataLoading?: boolean;
    selectedDay: string;
    selectedDeliveryDate?: string;
    readOnly?: boolean;
    onDriverAssigned?: () => void;
}

const DEFAULT_PALETTE = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
    "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
];

export default function ClientDriverAssignment({
    initialClients,
    drivers,
    stats = null,
    assignmentDataLoading = false,
    selectedDay,
    selectedDeliveryDate,
    readOnly = false,
    onDriverAssigned
}: ClientDriverAssignmentProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [savingClientId, setSavingClientId] = useState<string | null>(null);
    const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
    const [bulkDriverId, setBulkDriverId] = useState<string>('');
    const [isBulkSaving, setIsBulkSaving] = useState(false);
    const [previewStop, setPreviewStop] = useState<any | null>(null);
    const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
    /** Optimistic overrides for assigned_driver_id after user assigns (before parent refreshes) */
    const [assignmentOverride, setAssignmentOverride] = useState<Map<string, string>>(new Map());

    // Map initialClients to Client[] and build base clientDriverMap from assigned_driver_id
    const { clients, baseDriverMap } = useMemo(() => {
        const list: Client[] = (initialClients || []).map((user: any) => {
            const fullName = `${user.first || ''} ${user.last || ''}`.trim() || user.name || user.full_name || 'Unnamed';
            return {
                id: user.id,
                fullName,
                firstName: user.first ?? null,
                lastName: user.last ?? null,
                address: user.address ?? '',
                city: user.city ?? '',
                state: user.state ?? '',
                phoneNumber: user.phone ?? '',
                lat: user.lat != null ? Number(user.lat) : null,
                lng: user.lng != null ? Number(user.lng) : null,
                parentClientId: user.parent_client_id ?? user.parentClientId ?? null,
                serviceType: user.service_type ?? user.serviceType ?? null,
                service_type: user.service_type ?? user.serviceType ?? null,
            };
        });
        const map = new Map<string, string>();
        (initialClients || []).forEach((user: any) => {
            const did = user.assigned_driver_id ?? user.assignedDriverId;
            if (user.id && did) map.set(user.id, String(did));
        });
        return { clients: list, baseDriverMap: map };
    }, [initialClients]);

    const clientDriverMap = useMemo(() => {
        const m = new Map<string, string>(baseDriverMap);
        assignmentOverride.forEach((driverId, clientId) => {
            if (driverId) m.set(clientId, driverId);
            else m.delete(clientId);
        });
        return m;
    }, [baseDriverMap, assignmentOverride]);

    const driversForDropdown = useMemo(() => drivers.map(d => ({
        id: d.id,
        name: d.name,
        driverId: d.id
    })), [drivers]);
    // When parent refreshes assignment data, clear optimistic overrides
    useEffect(() => {
        setAssignmentOverride(new Map());
    }, [initialClients]);

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

            setAssignmentOverride(prev => {
                const next = new Map(prev);
                if (driverId) next.set(clientId, driverId);
                else next.delete(clientId);
                return next;
            });

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

            setAssignmentOverride(prev => {
                const next = new Map(prev);
                clientIdsArray.forEach(cid => next.set(cid, bulkDriverId));
                return next;
            });

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

    // NOTE: Marker colors are ALWAYS determined by driver assignment, NEVER by order status
    // Order status is only used for display in popups/dialogs, not for map marker colors
    // The __driverColor property on stops is set from assignedDriver?.color and is used for all marker coloring

    // Convert clients to stops format for the map. Show food clients (primaries + dependants); hide produce-only only.
    const mapStops = useMemo(() => {
        return filteredClients
            .filter(client => hasFoodServiceType(client.serviceType ?? client.service_type))
            .filter(client => {
                const lat = client.lat;
                const lng = client.lng;
                return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
            })
            .map(client => {
                const currentDriverId = clientDriverMap.get(client.id) || null;
                const assignedDriver = currentDriverId
                    ? drivers.find(d => String(d.id) === String(currentDriverId))
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
                    address: client.address ?? '',
                    apt: '',
                    city: client.city ?? '',
                    state: client.state ?? '',
                    zip: '',
                    phone: client.phoneNumber ?? '',
                    lat: client.lat,
                    lng: client.lng,
                    __driverId: currentDriverId,
                    __driverName: assignedDriver?.name ?? null,
                    __driverColor: assignedDriver?.color ?? null,
                    orderId: null,
                    orderStatus: null,
                    completed: false,
                    dislikes: null,
                };
            });
    }, [filteredClients, clientDriverMap, drivers]);

    // Build map drivers from props (id, name, color) and mapStops
    const mapDrivers = useMemo(() => {
        return (drivers || []).map((d, i) => {
            const driverId = String(d.id);
            const color = (d.color && d.color !== "#666") ? d.color : DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];
            const driverStops = mapStops.filter(s => String(s.__driverId) === String(driverId));
            return {
                id: driverId,
                driverId,
                name: d.name || `Driver ${i}`,
                color,
                polygon: [],
                stops: driverStops
            };
        });
    }, [drivers, mapStops]);

    // Unrouted stops (clients without driver assignment)
    const unroutedStops = useMemo(() => {
        return mapStops.filter(s => !s.__driverId);
    }, [mapStops]);

    if (assignmentDataLoading) {
        return (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 120 }}>
                <LoadingIndicator message="Loading clients..." />
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

    const primaryFoodMissingGeo = stats?.primary_food_missing_geo ?? 0;
    const dependantMissingGeo = stats?.dependant_missing_geo ?? 0;
    const totalMissingGeo = primaryFoodMissingGeo + dependantMissingGeo;

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid #e5e7eb', backgroundColor: 'white', position: 'relative' }}>
                <Typography variant="h6" sx={{ mb: 1, fontWeight: 600 }}>
                    Client Driver Assignment
                </Typography>
                {stats != null ? (
                    <>
                        <Typography variant="body2" sx={{ color: '#6b7280', mb: 1 }}>
                            <strong>Delivery eligible clients:</strong> {mapStops.length}
                            {' · '}
                            <strong>Total clients:</strong> {stats.total_clients}
                            {' · '}
                            <strong>Primaries (food only):</strong> {stats.total_primaries_food}
                            {' · '}
                            <strong>Primary paused or delivery off</strong> (not produce): {stats.primary_paused_or_delivery_off}
                            {selectedClientIds.size > 0 && ` · ${selectedClientIds.size} selected`}
                        </Typography>
                        {totalMissingGeo > 0 && (
                            <Typography variant="caption" sx={{ color: '#f59e0b', display: 'block', mb: 1 }}>
                                ⚠️ <strong>Need geocoding:</strong> {totalMissingGeo} client{totalMissingGeo !== 1 ? 's' : ''} without geolocation {totalMissingGeo !== 1 ? 'are' : 'is'} not shown on map
                                {primaryFoodMissingGeo > 0 && dependantMissingGeo > 0
                                    ? ` (${primaryFoodMissingGeo} primary, ${dependantMissingGeo} dependant${dependantMissingGeo !== 1 ? 's' : ''}).`
                                    : primaryFoodMissingGeo > 0
                                        ? ' (primaries only).'
                                        : ` (${dependantMissingGeo} dependant${dependantMissingGeo !== 1 ? 's' : ''}).`
                                }
                                {' '}Use &quot;Needs geocoding&quot; to fix.
                            </Typography>
                        )}
                    </>
                ) : (
                    <>
                        <Typography variant="body2" sx={{ color: '#6b7280', mb: 1 }}>
                            Showing {mapStops.length} of {filteredClients.length} clients with geolocation on map
                            {selectedClientIds.size > 0 && ` · ${selectedClientIds.size} selected`}
                        </Typography>
                    </>
                )}
            </Box>

            {/* Orders View */}
            <Box sx={{ flex: 1, position: 'relative', minHeight: 0 }}>
                {(() => {
                    const Component = DriversMapLeaflet as any;
                    return <Component
                        drivers={mapDrivers}
                        unrouted={unroutedStops}
                        onReassign={readOnly ? undefined : handleMapReassign}
                        driversForAssignment={driversForDropdown}
                        onDriverChange={async (stop: any, driverId: any) => {
                            const clientId = stop.userId || stop.clientId || stop.id;
                            if (clientId) {
                                await handleDriverChange(clientId, driverId);
                            }
                        }}
                        onBulkAssignComplete={async () => {
                            if (onDriverAssigned) onDriverAssigned();
                        }}
                        busy={isBulkSaving}
                        readonly={readOnly}
                        initialCenter={[40.7128, -74.006]}
                        initialZoom={10}
                    />;
                })()}
            </Box>

            {/* Stop Preview Dialog */}
            <StopPreviewDialog
                open={previewDialogOpen}
                onClose={() => {
                    setPreviewDialogOpen(false);
                    setPreviewStop(null);
                }}
                stop={previewStop}
                drivers={driversForDropdown}
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
