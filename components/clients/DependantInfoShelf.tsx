'use client';

import React from 'react';
import Link from 'next/link';
import { X, ExternalLink, Pencil, Trash2, Check, Loader2, MapPinned } from 'lucide-react';
import { ClientProfile } from '@/lib/types';
import { useState, useEffect, useCallback } from 'react';
import { updateClient, deleteClient } from '@/lib/actions';
import { buildGeocodeQuery } from '@/lib/addressHelpers';
import { geocodeOneClient } from '@/lib/geocodeOneClient';
import styles from './ClientInfoShelf.module.css';

interface DependantInfoShelfProps {
    client: ClientProfile;
    onClose: () => void;
    /** Opens the profile with order details (service config) for this dependant. */
    onOpenProfile: (clientId: string) => void;
    onClientUpdated?: (updatedClient?: ClientProfile) => void;
    onClientDeleted?: () => void;
}

export function DependantInfoShelf({
    client,
    onClose,
    onOpenProfile,
    onClientUpdated,
    onClientDeleted
}: DependantInfoShelfProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const getInitialEditForm = useCallback((c: ClientProfile) => ({
        fullName: c.fullName,
        dob: c.dob || '',
        cin: c.cin ?? '',
        address: c.address || '',
        apt: c.apt || '',
        city: c.city || '',
        state: c.state || '',
        zip: c.zip || '',
        notes: c.dislikes ?? '',
        serviceType: c.serviceType,
    }), []);

    const [editForm, setEditForm] = useState(() => getInitialEditForm(client));

    const [geoBusy, setGeoBusy] = useState(false);
    const [geoErr, setGeoErr] = useState('');

    useEffect(() => {
        if (!isEditing) setEditForm(getInitialEditForm(client));
    }, [client, isEditing, getInitialEditForm]);

    const hasGeocode = client.lat != null && client.lng != null && Number.isFinite(Number(client.lat)) && Number.isFinite(Number(client.lng));

    const handleAutoGeocode = useCallback(async () => {
        if (!client?.id || geoBusy) return;
        const source = isEditing ? editForm : client;
        const q = buildGeocodeQuery({
            address: source.address || '',
            city: source.city || '',
            state: source.state || '',
            zip: source.zip || '',
        });
        if (!q?.trim()) {
            setGeoErr('Add address / city / state to geocode');
            return;
        }
        setGeoBusy(true);
        setGeoErr('');
        try {
            const a = await geocodeOneClient(q);
            await updateClient(client.id, { lat: a.lat, lng: a.lng }, { skipOrderSync: true });
            onClientUpdated?.(undefined);
        } catch {
            setGeoErr('Address not found');
        } finally {
            setGeoBusy(false);
        }
    }, [client?.id, isEditing, editForm.address, editForm.city, editForm.state, editForm.zip, geoBusy, onClientUpdated]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updated = await updateClient(
                client.id,
                {
                    fullName: editForm.fullName,
                    dob: editForm.dob || null,
                    cin: editForm.cin === '' || editForm.cin === null ? null : Number(editForm.cin),
                    address: editForm.address,
                    apt: editForm.apt || null,
                    city: editForm.city || null,
                    state: editForm.state || null,
                    zip: editForm.zip || null,
                    dislikes: editForm.notes || null,
                    serviceType: editForm.serviceType,
                },
                { skipOrderSync: true }
            );
            setIsEditing(false);
            if (onClientUpdated) onClientUpdated(updated ?? undefined);
        } catch (error) {
            console.error('Failed to update dependent:', error);
            alert('Failed to save changes. Please try again.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveAndClose = async () => {
        await handleSave();
        onClose();
    };

    const handleDelete = async () => {
        if (confirm(`Are you sure you want to delete ${client.fullName}? This action cannot be undone.`)) {
            try {
                await deleteClient(client.id);
                onClose();
                if (onClientDeleted) onClientDeleted();
            } catch (error) {
                console.error('Error deleting dependent:', error);
                alert('Failed to delete dependent. Please try again.');
            }
        }
    };

    return (
        <>
            <div className={styles.shelfOverlay} onClick={() => (isEditing ? handleSaveAndClose() : onClose())} />
            <div className={styles.shelf}>
                <div className={styles.header}>
                    <div className={styles.titleSection}>
                        {isEditing ? (
                            <input
                                className={styles.editInput}
                                value={editForm.fullName}
                                onChange={e => setEditForm({ ...editForm, fullName: e.target.value })}
                                autoFocus
                                placeholder="Name"
                            />
                        ) : (
                            <>
                                <h2>{client.fullName}</h2>
                                <span style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>Dependent</span>
                                <Link
                                    href={`/client-portal/${client.id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={styles.portalLink}
                                    title="Open client portal"
                                >
                                    {client.id}
                                </Link>
                            </>
                        )}
                    </div>
                    <div className={styles.headerActions}>
                        {isEditing ? (
                            <>
                                <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving}>
                                    {isSaving ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                                </button>
                                <button className={styles.cancelBtn} onClick={() => {
                                    setIsEditing(false);
                                    setEditForm(getInitialEditForm(client));
                                }}>
                                    <X size={18} />
                                </button>
                            </>
                        ) : (
                            <>
                                <button className={styles.editBtn} onClick={() => setIsEditing(true)}>
                                    <Pencil size={18} />
                                </button>
                                <button className={styles.deleteBtn} onClick={handleDelete}>
                                    <Trash2 size={18} />
                                </button>
                                <button className={styles.closeBtn} onClick={onClose}>
                                    <X size={24} />
                                </button>
                            </>
                        )}
                    </div>
                </div>

                <div className={styles.content}>
                    {/* Dependent-specific: Name, DOB, CIN, Service Type */}
                    <div className={styles.section}>
                        <h3>Dependent info</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Name</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.fullName}
                                            onChange={e => setEditForm({ ...editForm, fullName: e.target.value })}
                                            placeholder="Full name"
                                        />
                                    ) : (
                                        client.fullName || '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>DOB</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            type="date"
                                            className={styles.editInput}
                                            value={editForm.dob ? editForm.dob.split('T')[0] : ''}
                                            onChange={e => setEditForm({ ...editForm, dob: e.target.value })}
                                        />
                                    ) : (
                                        client.dob ? new Date(client.dob).toLocaleDateString() : '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>CIN#</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            type="number"
                                            className={styles.editInput}
                                            value={editForm.cin === null || editForm.cin === '' || editForm.cin === undefined ? '' : String(editForm.cin)}
                                            onChange={e => setEditForm({ ...editForm, cin: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                                            placeholder="CIN"
                                        />
                                    ) : (
                                        client.cin != null ? String(client.cin) : '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Service type</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <select
                                            className={styles.editSelect}
                                            value={editForm.serviceType === 'Produce' ? 'Produce' : 'Food'}
                                            onChange={e => setEditForm({ ...editForm, serviceType: e.target.value as 'Food' | 'Produce' })}
                                        >
                                            <option value="Food">Food</option>
                                            <option value="Produce">Produce</option>
                                        </select>
                                    ) : (
                                        client.serviceType === 'Produce' ? 'Produce' : 'Food'
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Address only (no Unit, no Financials, no Unite Us) */}
                    <div className={styles.section}>
                        <h3>Address</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Street</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.address}
                                            onChange={e => setEditForm({ ...editForm, address: e.target.value })}
                                            placeholder="Street address"
                                        />
                                    ) : (
                                        client.address?.trim() || '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>City</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.city}
                                            onChange={e => setEditForm({ ...editForm, city: e.target.value })}
                                            placeholder="City"
                                        />
                                    ) : (
                                        client.city?.trim() || '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>State</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.state}
                                            onChange={e => setEditForm({ ...editForm, state: e.target.value })}
                                            placeholder="State"
                                        />
                                    ) : (
                                        client.state?.trim() || '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Zip</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.zip}
                                            onChange={e => setEditForm({ ...editForm, zip: e.target.value })}
                                            placeholder="Zip"
                                        />
                                    ) : (
                                        client.zip?.trim() || '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Geocode</div>
                                <div className={styles.value}>
                                    <span style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {hasGeocode && (
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                ✓ {Number(client.lat).toFixed(4)}, {Number(client.lng).toFixed(4)}
                                            </span>
                                        )}
                                        {(isEditing || !hasGeocode) && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="btn btn-secondary btn-sm"
                                                    onClick={handleAutoGeocode}
                                                    disabled={geoBusy}
                                                    style={{ alignSelf: 'flex-start' }}
                                                >
                                                    {geoBusy ? <Loader2 size={14} className="animate-spin" /> : <MapPinned size={14} />}
                                                    {' '}{geoBusy ? 'Geocoding…' : 'Auto Geocode'}
                                                </button>
                                                {geoErr && <span style={{ fontSize: '0.8rem', color: 'var(--color-danger, #dc2626)' }}>{geoErr}</span>}
                                            </>
                                        )}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Notes only */}
                    <div className={styles.section}>
                        <h3>Notes</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Notes</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <textarea
                                            className={styles.editTextarea}
                                            value={editForm.notes}
                                            onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                                            rows={3}
                                            placeholder="Notes, dietary restrictions, or other info"
                                        />
                                    ) : (
                                        <span style={{ whiteSpace: 'pre-wrap' }}>{client.dislikes?.trim() || '—'}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={styles.footer}>
                    <button
                        className={styles.actionBtn}
                        onClick={() => onOpenProfile(client.id)}
                    >
                        Open Order Details
                        <ExternalLink size={18} />
                    </button>
                </div>
            </div>
        </>
    );
}
