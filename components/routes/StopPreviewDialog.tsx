'use client';

import React, { useEffect, useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Divider,
    FormControl,
    InputLabel,
    Select,
    MenuItem
} from '@mui/material';
import { X } from 'lucide-react';
import { getBoxTypes, getMenuItems } from '@/lib/cached-data';

interface StopPreviewDialogProps {
    open: boolean;
    onClose: () => void;
    stop: any | null;
    boxTypes?: any[];
    menuItems?: any[];
    drivers?: Array<{ id: string; name: string }>;
    onDriverChange?: (stop: any, driverId: string) => Promise<void>;
}

export default function StopPreviewDialog({ open, onClose, stop, boxTypes: propBoxTypes, menuItems: propMenuItems, drivers, onDriverChange }: StopPreviewDialogProps) {
    const [boxTypes, setBoxTypes] = useState<any[]>(propBoxTypes || []);
    const [menuItems, setMenuItems] = useState<any[]>(propMenuItems || []);
    const [driverDetails, setDriverDetails] = useState<any | null>(null);
    const [loadingDriver, setLoadingDriver] = useState(false);
    const [orderDetails, setOrderDetails] = useState<any | null>(null);
    const [loadingOrder, setLoadingOrder] = useState(false);
    const [changingDriver, setChangingDriver] = useState(false);

    // Load box types and menu items if not provided as props
    useEffect(() => {
        if (open && (!propBoxTypes || propBoxTypes.length === 0 || !propMenuItems || propMenuItems.length === 0)) {
            Promise.all([
                !propBoxTypes || propBoxTypes.length === 0 ? getBoxTypes() : Promise.resolve(propBoxTypes || []),
                !propMenuItems || propMenuItems.length === 0 ? getMenuItems() : Promise.resolve(propMenuItems || [])
            ]).then(([bt, mi]) => {
                if (!propBoxTypes || propBoxTypes.length === 0) setBoxTypes(bt || []);
                if (!propMenuItems || propMenuItems.length === 0) setMenuItems(mi || []);
            }).catch(error => {
                console.error('Error loading box types or menu items for preview:', error);
            });
        }
    }, [open, propBoxTypes, propMenuItems]);

    // Load driver details when stop has a driver assigned
    useEffect(() => {
        if (!open || !stop) {
            setDriverDetails(null);
            return;
        }

        // Check multiple possible field names for driver ID
        const driverId = stop.__driverId || stop.assignedDriverId || stop.assigned_driver_id || stop.assignedDriver_id;
        
        // Also check if stop belongs to a route (driver assignment)
        // If stop is in a route, we can determine the driver from the routes API
        if (!driverId) {
            setDriverDetails(null);
            // Still try to find driver by checking which route this stop belongs to
            setLoadingDriver(true);
            fetch('/api/route/routes?day=all')
                .then(res => res.json())
                .then(data => {
                    const routes = data.routes || [];
                    // Find which route contains this stop
                    const routeWithStop = routes.find((r: any) => {
                        return r.stops?.some((s: any) => String(s.id) === String(stop.id) || String(s.userId || s.clientId) === String(stop.userId || stop.clientId));
                    });
                    if (routeWithStop) {
                        setDriverDetails({
                            id: routeWithStop.driverId || routeWithStop.id,
                            name: routeWithStop.driverName || routeWithStop.name || 'Unknown Driver',
                            color: routeWithStop.color,
                            day: routeWithStop.day || 'all',
                            totalStops: routeWithStop.stops?.length || 0,
                            completedStops: routeWithStop.stops?.filter((s: any) => s.completed === true).length || 0
                        });
                    } else {
                        setDriverDetails(null);
                    }
                })
                .catch(error => {
                    console.error('Error loading driver details:', error);
                    setDriverDetails(null);
                })
                .finally(() => {
                    setLoadingDriver(false);
                });
            return;
        }

        setLoadingDriver(true);
        // Try to fetch driver details from routes API
        fetch('/api/route/routes?day=all')
            .then(res => res.json())
            .then(data => {
                const routes = data.routes || [];
                const driver = routes.find((r: any) => String(r.driverId || r.id) === String(driverId));
                if (driver) {
                    setDriverDetails({
                        id: driver.driverId || driver.id,
                        name: driver.driverName || driver.name || stop.__driverName,
                        color: driver.color,
                        day: driver.day || 'all',
                        totalStops: driver.stops?.length || 0,
                        completedStops: driver.stops?.filter((s: any) => s.completed === true).length || 0
                    });
                } else {
                    // If not found in routes, use available stop data
                    setDriverDetails({
                        id: driverId,
                        name: stop.__driverName || 'Unknown Driver',
                        color: stop.__driverColor || null,
                        day: stop.day || null,
                        totalStops: null,
                        completedStops: null
                    });
                }
            })
            .catch(error => {
                console.error('Error loading driver details:', error);
                // Fallback to available stop data
                setDriverDetails({
                    id: driverId,
                    name: stop.__driverName || 'Unknown Driver',
                    color: stop.__driverColor || null,
                    day: stop.day || null,
                    totalStops: null,
                    completedStops: null
                });
            })
            .finally(() => {
                setLoadingDriver(false);
            });
    }, [open, stop]);

    // Load order details when stop has an order_id
    // Priority: Use stop.order_id to look up order directly from upcoming_orders first, then orders table
    useEffect(() => {
        if (!open || !stop) {
            setOrderDetails(null);
            return;
        }

        // Check stop.order_id first (direct field from stops table), then stop.orderId (from routes API)
        const orderId = stop.order_id || stop.orderId;
        
        // Debug: Log what we're getting from the stop object
        if (!orderId) {
            console.log('[StopPreview] No order_id found in stop object:', {
                'stop.order_id': stop.order_id,
                'stop.orderId': stop.orderId,
                'stop keys': Object.keys(stop)
            });
            setOrderDetails(null);
            return;
        }
        
        console.log('[StopPreview] Fetching order details for order_id:', orderId);

        // Fetch order details: API endpoint checks upcoming_orders first, then orders
        const fetchOrderDetails = async () => {
            setLoadingOrder(true);
            try {
                const res = await fetch(`/api/stops/order/${orderId}`, { 
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' }
                });
                
                if (res.ok) {
                    const order = await res.json();
                    if (order && !order.error) {
                        setOrderDetails(order);
                    } else {
                        setOrderDetails(null);
                    }
                } else {
                    // Order not found in either table
                    setOrderDetails(null);
                }
            } catch (error) {
                console.error('[StopPreview] Error fetching order details:', error);
                setOrderDetails(null);
            } finally {
                setLoadingOrder(false);
            }
        };

        fetchOrderDetails();
    }, [open, stop?.order_id, stop?.orderId]);

    if (!stop) return null;

    const formatDate = (dateStr: string | null | undefined) => {
        if (!dateStr) return 'N/A';
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
    };

    const formatDateTime = (dateStr: string | null | undefined) => {
        if (!dateStr) return 'N/A';
        try {
            const date = new Date(dateStr);
            return date.toLocaleString('en-US', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateStr;
        }
    };

    const getOrderStatusColor = (status: string | null | undefined) => {
        if (!status) return '#6b7280';
        const lowerStatus = status.toLowerCase();
        switch (lowerStatus) {
            case 'cancelled':
                return '#ef4444';
            case 'waiting_for_proof':
                return '#f59e0b';
            case 'billing_pending':
                return '#8b5cf6';
            case 'completed':
                return '#16a34a';
            case 'pending':
            case 'scheduled':
            case 'confirmed':
                return '#3b82f6';
            default:
                return '#6b7280';
        }
    };

    // Use order_id from stop object first (source of truth from database), then orderDetails if fetched
    // Priority: stop.order_id (direct from stops table) > orderDetails.id (from API lookup) > stop.orderId (from routes API mapping)
    const finalOrderId = stop.order_id || orderDetails?.id || stop.orderId || null;
    const orderStatus = orderDetails?.status || stop.orderStatus || stop.order?.status || stop.status || null;
    const orderNumber = orderDetails?.order_number || stop.orderNumber || null;
    const deliveryDateFromOrder = orderDetails?.scheduled_delivery_date || orderDetails?.actual_delivery_date || null;
    const statusColor = orderStatus ? getOrderStatusColor(orderStatus) : null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: 2,
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12)'
                }
            }}
        >
            <DialogTitle
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    pb: 1,
                    borderBottom: '1px solid #e5e7eb'
                }}
            >
                <Typography component="span" variant="h6" sx={{ fontWeight: 600 }}>
                    Stop Preview
                </Typography>
                <Button
                    onClick={onClose}
                    sx={{ minWidth: 'auto', p: 0.5 }}
                    size="small"
                >
                    <X size={20} />
                </Button>
            </DialogTitle>

            <DialogContent sx={{ pt: 3 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {/* Stop Information */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#374151' }}>
                            Stop Information
                        </Typography>
                        <Box sx={{ pl: 1 }}>
                            <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.5 }}>
                                {stop.name || 'Unnamed'}
                            </Typography>
                            <Typography variant="body2" sx={{ color: '#6b7280', mb: 0.5 }}>
                                {[stop.address, stop.apt].filter(Boolean).join(' ')}
                            </Typography>
                            <Typography variant="body2" sx={{ color: '#6b7280', mb: 0.5 }}>
                                {[stop.city, stop.state, stop.zip].filter(Boolean).join(', ')}
                            </Typography>
                            {stop.phone && (
                                <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                    📞 {stop.phone}
                                </Typography>
                            )}
                        </Box>
                    </Box>

                    <Divider />

                    {/* Order Information */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#374151' }}>
                            Order Information
                        </Typography>
                        {loadingOrder ? (
                            <Box sx={{ pl: 1, py: 2, textAlign: 'center' }}>
                                <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                    Loading order details...
                                </Typography>
                            </Box>
                        ) : (
                            <Box sx={{ pl: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                                {orderNumber && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                            Order Number:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                            {orderNumber}
                                        </Typography>
                                    </Box>
                                )}
                                {orderStatus && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                            Status:
                                        </Typography>
                                        <Box
                                            sx={{
                                                px: 1.5,
                                                py: 0.5,
                                                borderRadius: 1,
                                                backgroundColor: statusColor + '20',
                                                color: statusColor,
                                                fontWeight: 500,
                                                fontSize: '0.75rem',
                                                textTransform: 'capitalize'
                                            }}
                                        >
                                            {orderStatus.replace(/_/g, ' ')}
                                        </Box>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </Box>

                    <Divider />

                    {/* Assigned Driver Preview */}
                    <Divider />
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#374151' }}>
                            Assigned Driver
                        </Typography>
                        {loadingDriver ? (
                            <Box sx={{ pl: 1, py: 2, textAlign: 'center' }}>
                                <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                    Loading driver details...
                                </Typography>
                            </Box>
                        ) : (
                            <Box sx={{ pl: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                                {drivers && onDriverChange ? (
                                    <FormControl fullWidth size="small">
                                        <InputLabel>Assign Driver</InputLabel>
                                        <Select
                                            value={stop?.__driverId || stop?.assignedDriverId || stop?.assigned_driver_id || ''}
                                            label="Assign Driver"
                                            onChange={async (e) => {
                                                const driverId = e.target.value;
                                                if (stop && onDriverChange) {
                                                    setChangingDriver(true);
                                                    try {
                                                        await onDriverChange(stop, driverId);
                                                        // Close dialog after assignment
                                                        onClose();
                                                    } catch (error) {
                                                        console.error('Failed to assign driver:', error);
                                                        alert('Failed to assign driver. Please try again.');
                                                    } finally {
                                                        setChangingDriver(false);
                                                    }
                                                }
                                            }}
                                            disabled={changingDriver}
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
                                ) : driverDetails ? (
                                    <Box
                                        sx={{
                                            p: 2,
                                            backgroundColor: '#f9fafb',
                                            borderRadius: 1,
                                            border: '1px solid #e5e7eb',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 1.5
                                        }}
                                    >
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                                            {driverDetails.color && (
                                                <Box
                                                    sx={{
                                                        width: 24,
                                                        height: 24,
                                                        borderRadius: '50%',
                                                        backgroundColor: driverDetails.color,
                                                        border: '2px solid #fff',
                                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                                        flexShrink: 0
                                                    }}
                                                />
                                            )}
                                            <Typography variant="body1" sx={{ fontWeight: 600, color: '#374151' }}>
                                                {driverDetails.name}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: driverDetails.color ? 3.5 : 0 }}>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                                    Driver ID:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontWeight: 500, fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                                    {driverDetails.id?.slice(0, 8)}...
                                                </Typography>
                                            </Box>
                                            {driverDetails.day && (
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                                        Day:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 500, textTransform: 'capitalize' }}>
                                                        {driverDetails.day}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {driverDetails.totalStops !== null && (
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                                        Total Stops:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                        {driverDetails.totalStops}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {driverDetails.completedStops !== null && driverDetails.totalStops !== null && (
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                                        Completed:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 500, color: '#16a34a' }}>
                                                        {driverDetails.completedStops} / {driverDetails.totalStops}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    </Box>
                                ) : (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                            Assigned Driver:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                            {stop?.__driverName || 'None'}
                                        </Typography>
                                    </Box>
                                )}
                            </Box>
                        )}
                    </Box>

                    {/* Delivery Information */}
                    <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#374151' }}>
                            Delivery Information
                        </Typography>
                        <Box sx={{ pl: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {stop.__stopIndex !== undefined && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                        Stop Order:
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                        #{stop.__stopIndex + 1}
                                    </Typography>
                                </Box>
                            )}
                            {stop.lat && stop.lng && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                        Coordinates:
                                    </Typography>
                                    <Typography variant="body2" sx={{ fontWeight: 500, fontFamily: 'monospace' }}>
                                        {stop.lat.toFixed(6)}, {stop.lng.toFixed(6)}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>

                    {/* Box Order Details */}
                    {(stop.order?.serviceType === 'Boxes' || stop.serviceType === 'Boxes') && 
                     (stop.order?.boxOrders || stop.boxOrders) && (
                        <>
                            <Divider />
                            <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#374151' }}>
                                    Box Order Details
                                </Typography>
                                <Box sx={{ pl: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {((stop.order?.boxOrders || stop.boxOrders) || []).map((box: any, idx: number) => {
                                        const boxType = boxTypes?.find((bt: any) => bt.id === box.boxTypeId);
                                        const boxTypeName = boxType?.name || box.boxTypeId || 'Unknown Box Type';
                                        
                                        return (
                                            <Box 
                                                key={idx} 
                                                sx={{
                                                    p: 1.5,
                                                    backgroundColor: '#f9fafb',
                                                    borderRadius: 1,
                                                    border: '1px solid #e5e7eb'
                                                }}
                                            >
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                                        Box Type:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                        {boxTypeName}
                                                    </Typography>
                                                </Box>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                                                    <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                                        Quantity:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                        {box.quantity || 1}
                                                    </Typography>
                                                </Box>
                                                {box.items && Object.keys(box.items).length > 0 && (
                                                    <Box sx={{ mt: 1 }}>
                                                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, color: '#374151' }}>
                                                            Items:
                                                        </Typography>
                                                        <Box sx={{ pl: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                                            {Object.entries(box.items).map(([itemId, qty]: [string, any]) => {
                                                                const menuItem = menuItems?.find((mi: any) => mi.id === itemId);
                                                                const itemName = menuItem?.name || itemId;
                                                                const quantity = typeof qty === 'object' && qty?.quantity ? qty.quantity : qty;
                                                                
                                                                return (
                                                                    <Box key={itemId} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                        <Typography variant="body2" sx={{ color: '#6b7280' }}>
                                                                            • {itemName}
                                                                        </Typography>
                                                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                                            Qty: {quantity}
                                                                        </Typography>
                                                                    </Box>
                                                                );
                                                            })}
                                                        </Box>
                                                    </Box>
                                                )}
                                                {box.itemNotes && typeof box.itemNotes === 'object' && Object.keys(box.itemNotes).length > 0 && (
                                                    <Box sx={{ mt: 1 }}>
                                                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, color: '#374151' }}>
                                                            Item Notes:
                                                        </Typography>
                                                        <Box sx={{ pl: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                                            {Object.entries(box.itemNotes).map(([itemId, note]: [string, any]) => {
                                                                const menuItem = menuItems?.find((mi: any) => mi.id === itemId);
                                                                const itemName = menuItem?.name || itemId;
                                                                
                                                                if (!note || (typeof note === 'string' && !note.trim())) return null;
                                                                
                                                                return (
                                                                    <Box key={itemId}>
                                                                        <Typography variant="body2" sx={{ fontWeight: 500, color: '#374151' }}>
                                                                            {itemName}:
                                                                        </Typography>
                                                                        <Typography variant="body2" sx={{ color: '#6b7280', pl: 1, fontStyle: 'italic' }}>
                                                                            {typeof note === 'string' ? note : JSON.stringify(note)}
                                                                        </Typography>
                                                                    </Box>
                                                                );
                                                            })}
                                                        </Box>
                                                    </Box>
                                                )}
                                            </Box>
                                        );
                                    })}
                                </Box>
                            </Box>
                        </>
                    )}

                    {/* Notes */}
                    {stop.dislikes && (
                        <>
                            <Divider />
                            <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: '#374151' }}>
                                    Special Notes
                                </Typography>
                                <Box
                                    sx={{
                                        pl: 1,
                                        p: 1.5,
                                        backgroundColor: '#f9fafb',
                                        borderRadius: 1,
                                        border: '1px solid #e5e7eb'
                                    }}
                                >
                                    <Typography variant="body2" sx={{ color: '#374151', whiteSpace: 'pre-wrap' }}>
                                        {stop.dislikes}
                                    </Typography>
                                </Box>
                            </Box>
                        </>
                    )}
                </Box>
            </DialogContent>

            <DialogActions sx={{ px: 3, py: 2, borderTop: '1px solid #e5e7eb' }}>
                <Button onClick={onClose} variant="contained" sx={{ borderRadius: 1 }}>
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}
