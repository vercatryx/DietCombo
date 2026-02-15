'use client';

import React from 'react';
import Link from 'next/link';
import {
    X, ExternalLink, MapPin, Phone, Mail, User, Info,
    Calendar, DollarSign, StickyNote, Square, CheckSquare,
    Users, FileText, CheckCircle, XCircle, Clock, Download,
    MessageSquare, Pencil, Trash2, Check, Save, Trash, Loader2, Plus,
    MapPinned
} from 'lucide-react';
import { ClientProfile, ClientStatus, Navigator, Submission } from '@/lib/types';
import { useState, useEffect, useCallback } from 'react';
import { addDependent, getDependentsByParentId, updateClient, deleteClient } from '@/lib/actions';
import { buildGeocodeQuery } from '@/lib/addressHelpers';
import { geocodeOneClient } from '@/lib/geocodeOneClient';
import { getSingleForm } from '@/lib/form-actions';
import FormFiller from '@/components/forms/FormFiller';
import { FormSchema } from '@/lib/form-types';
import styles from './ClientInfoShelf.module.css';

interface ClientInfoShelfProps {
    client: ClientProfile;
    statuses: ClientStatus[];
    navigators: Navigator[];
    submissions?: Submission[];
    allClients?: ClientProfile[];
    onClose: () => void;
    onOpenProfile: (clientId: string) => void;
    /** Called after save; pass updated client to update list for that client only. */
    onClientUpdated?: (updatedClient?: ClientProfile) => void;
    onClientDeleted?: () => void;
}

export function ClientInfoShelf({
    client,
    statuses,
    navigators,
    submissions = [],
    allClients = [],
    onClose,
    onOpenProfile,
    onClientUpdated,
    onClientDeleted
}: ClientInfoShelfProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const getInitialEditForm = useCallback((c: ClientProfile) => ({
        fullName: c.fullName,
        statusId: c.statusId,
        navigatorId: c.navigatorId,
        phoneNumber: c.phoneNumber,
        secondaryPhoneNumber: c.secondaryPhoneNumber || '',
        email: c.email || '',
        address: c.address,
        apt: c.apt || '',
        city: c.city || '',
        state: c.state || '',
        zip: c.zip || '',
        county: c.county || '',
        notes: c.dislikes ?? '',
        caseIdExternal: c.caseIdExternal || '',
        authorizedAmount: c.authorizedAmount || 0,
        expirationDate: c.expirationDate || '',
        approvedMealsPerWeek: c.approvedMealsPerWeek || 0,
        caseId: c.activeOrder?.caseId || '',
        serviceType: c.serviceType,
        paused: c.paused ?? false,
        complex: c.complex ?? false,
        bill: c.bill ?? true,
        delivery: c.delivery ?? true,
    }), []);

    const [editForm, setEditForm] = useState(() => getInitialEditForm(client));

    // Dependent State
    const [showAddDependentForm, setShowAddDependentForm] = useState(false);
    const [dependentName, setDependentName] = useState('');
    const [dependentDob, setDependentDob] = useState('');
    const [dependentCin, setDependentCin] = useState('');
    const [creatingDependent, setCreatingDependent] = useState(false);
    const [loadingDependents, setLoadingDependents] = useState(false);
    const [localDependents, setLocalDependents] = useState<ClientProfile[]>([]);
    const [deletingDependentId, setDeletingDependentId] = useState<string | null>(null);

    // Screening State
    const [loadingForm, setLoadingForm] = useState(false);
    const [isFillingForm, setIsFillingForm] = useState(false);
    const [formSchema, setFormSchema] = useState<FormSchema | null>(null);

    // Geocode State
    const [geoBusy, setGeoBusy] = useState(false);
    const [geoErr, setGeoErr] = useState('');

    useEffect(() => {
        if (!isEditing) setEditForm(getInitialEditForm(client));
    }, [client, isEditing, getInitialEditForm]);

    useEffect(() => {
        if (allClients.length > 0) {
            setLocalDependents(allClients.filter(c => c.parentClientId === client.id));
            setLoadingDependents(false);
        } else {
            // Fetch if not provided (fallback)
            setLoadingDependents(true);
            const fetchDependents = async () => {
                try {
                    const deps = await getDependentsByParentId(client.id);
                    setLocalDependents(deps);
                } catch (error) {
                    console.error('Error fetching dependents:', error);
                } finally {
                    setLoadingDependents(false);
                }
            };
            fetchDependents();
        }
    }, [allClients, client.id]);

    const status = statuses.find(s => s.id === (isEditing ? editForm.statusId : client.statusId));
    const navigator = navigators.find(n => n.id === (isEditing ? editForm.navigatorId : client.navigatorId));

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
            await updateClient(client.id, { lat: a.lat, lng: a.lng });
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
            // Sidebar saves only client table fields; no order sync (avoids "Item not found" errors from draft data).
            const updated = await updateClient(
                client.id,
                {
                    fullName: editForm.fullName,
                    statusId: editForm.statusId,
                    navigatorId: editForm.navigatorId,
                    phoneNumber: editForm.phoneNumber,
                    secondaryPhoneNumber: editForm.secondaryPhoneNumber || null,
                    email: editForm.email || null,
                    address: editForm.address,
                    apt: editForm.apt || null,
                    city: editForm.city || null,
                    state: editForm.state || null,
                    zip: editForm.zip || null,
                    county: editForm.county || null,
                    dislikes: editForm.notes || null,
                    caseIdExternal: editForm.caseIdExternal || null,
                    authorizedAmount: editForm.authorizedAmount,
                    expirationDate: editForm.expirationDate || null,
                    approvedMealsPerWeek: editForm.approvedMealsPerWeek,
                    serviceType: editForm.serviceType,
                    paused: editForm.paused,
                    complex: editForm.complex,
                    bill: editForm.bill,
                    delivery: editForm.delivery,
                },
                { skipOrderSync: true }
            );
            setIsEditing(false);
            if (onClientUpdated) onClientUpdated(updated ?? undefined);
        } catch (error) {
            console.error('Failed to update client:', error);
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
                console.error('Failed to delete client:', error);
                alert('Failed to delete client. Please try again.');
            }
        }
    };

    const handleCreateDependent = async () => {
        if (!dependentName.trim() || !client.id) return;

        setCreatingDependent(true);
        try {
            const newDep = await addDependent(
                dependentName.trim(),
                client.id,
                dependentDob || null,
                dependentCin ? Number(dependentCin) : null
            );
            if (newDep) {
                // Update local state
                setLocalDependents(prev => [...prev, newDep]);
                // Reset form
                setDependentName('');
                setDependentDob('');
                setDependentCin('');
                setShowAddDependentForm(false);
                // Notify parent
                if (onClientUpdated) onClientUpdated(undefined);
            }
        } catch (error) {
            console.error('Error creating dependent:', error);
            alert(error instanceof Error ? error.message : 'Failed to create dependent');
        } finally {
            setCreatingDependent(false);
        }
    };

    const handleDeleteDependent = async (dep: ClientProfile) => {
        if (!confirm(`Delete dependent "${dep.fullName}"? This cannot be undone.`)) return;
        setDeletingDependentId(dep.id);
        try {
            await deleteClient(dep.id);
            setLocalDependents(prev => prev.filter(d => d.id !== dep.id));
            if (onClientUpdated) onClientUpdated(undefined);
        } catch (error) {
            console.error('Error deleting dependent:', error);
            alert(error instanceof Error ? error.message : 'Failed to delete dependent');
        } finally {
            setDeletingDependentId(null);
        }
    };

    const handleOpenScreeningForm = async () => {
        setLoadingForm(true);
        try {
            const response = await getSingleForm();
            if (response.success && response.data) {
                setFormSchema(response.data);
                setIsFillingForm(true);
            } else {
                alert('No Screening Form configured.');
            }
        } catch (error) {
            console.error('Failed to load form:', error);
            alert('Failed to load form. Please try again.');
        } finally {
            setLoadingForm(false);
        }
    };

    const handleCloseScreeningForm = () => {
        setIsFillingForm(false);
        setFormSchema(null);
        if (onClientUpdated) onClientUpdated(undefined);
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
                            />
                        ) : (
                            <>
                                <h2>{client.fullName}</h2>
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

                {isFillingForm && formSchema && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'white',
                        zIndex: 10000,
                        padding: '2rem',
                        overflowY: 'auto'
                    }}>
                        <FormFiller
                            schema={formSchema}
                            onBack={handleCloseScreeningForm}
                            clientId={client.id}
                        />
                    </div>
                )}

                <div className={styles.content}>
                    {/* Contact & Address - first so it's visible when panel opens; no Status/Navigator here (only in Service Information with dropdown) */}
                    <div className={styles.section}>
                        <h3>Contact & Address</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Address</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.address}
                                            onChange={e => setEditForm({ ...editForm, address: e.target.value })}
                                            placeholder="Street address"
                                        />
                                    ) : (
                                        (client.address?.trim() || client.apt?.trim())
                                            ? `${client.address?.trim() || ''}${client.apt?.trim() ? (client.address?.trim() ? `, Unit: ${client.apt.trim()}` : `Unit: ${client.apt.trim()}`) : ''}`
                                            : '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Unit</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.apt}
                                            onChange={e => setEditForm({ ...editForm, apt: e.target.value })}
                                            placeholder="Apt / Unit"
                                        />
                                    ) : (
                                        client.apt?.trim() || '—'
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
                                <div className={styles.label}>County</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.county}
                                            onChange={e => setEditForm({ ...editForm, county: e.target.value })}
                                            placeholder="County"
                                        />
                                    ) : (
                                        client.county?.trim() || '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Phone</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.phoneNumber}
                                            onChange={e => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                                            placeholder="Primary"
                                        />
                                    ) : (
                                        client.phoneNumber?.trim() ? (
                                            <a href={`tel:${client.phoneNumber.replace(/\s/g, '')}`}>{client.phoneNumber}</a>
                                        ) : '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Secondary Phone</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.secondaryPhoneNumber}
                                            onChange={e => setEditForm({ ...editForm, secondaryPhoneNumber: e.target.value })}
                                            placeholder="Secondary"
                                        />
                                    ) : (
                                        client.secondaryPhoneNumber?.trim() ? (
                                            <a href={`tel:${client.secondaryPhoneNumber.replace(/\s/g, '')}`}>{client.secondaryPhoneNumber}</a>
                                        ) : '—'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Email</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.email}
                                            onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                                            placeholder="Email"
                                        />
                                    ) : (
                                        client.email?.trim() ? (
                                            <a href={`mailto:${client.email}`}>{client.email}</a>
                                        ) : '—'
                                    )}
                                </div>
                            </div>
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
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Flags</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={editForm.paused}
                                                    onChange={e => setEditForm({ ...editForm, paused: e.target.checked })}
                                                />
                                                <span>Paused</span>
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={editForm.complex}
                                                    onChange={e => setEditForm({ ...editForm, complex: e.target.checked })}
                                                />
                                                <span>Complex</span>
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={editForm.bill}
                                                    onChange={e => setEditForm({ ...editForm, bill: e.target.checked })}
                                                />
                                                <span>Bill</span>
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={editForm.delivery}
                                                    onChange={e => setEditForm({ ...editForm, delivery: e.target.checked })}
                                                />
                                                <span>Delivery</span>
                                            </label>
                                        </div>
                                    ) : (
                                        (client.paused || client.complex || client.bill || client.delivery) ? (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                {client.paused && <span className={styles.flagChip}>Paused</span>}
                                                {client.complex && <span className={styles.flagChip}>Complex</span>}
                                                {client.bill && <span className={styles.flagChip}>Bill</span>}
                                                {client.delivery && <span className={styles.flagChip}>Delivery</span>}
                                            </div>
                                        ) : '—'
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

                    <div className={styles.section}>

                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Navigator</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <select
                                            className={styles.editSelect}
                                            value={editForm.navigatorId}
                                            onChange={e => setEditForm({ ...editForm, navigatorId: e.target.value })}
                                        >
                                            <option value="">Select Navigator</option>
                                            {navigators.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                                        </select>
                                    ) : (
                                        navigator?.name || 'Unassigned'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Status</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <select
                                            className={styles.editSelect}
                                            value={editForm.statusId}
                                            onChange={e => setEditForm({ ...editForm, statusId: e.target.value })}
                                        >
                                            <option value="">Select Status</option>
                                            {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                        </select>
                                    ) : (
                                        status?.name || 'Unknown'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Service Type</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <select
                                            className={styles.editSelect}
                                            value={editForm.serviceType}
                                            onChange={e => setEditForm({ ...editForm, serviceType: e.target.value as any })}
                                        >
                                            <option value="Food">Food</option>
                                            <option value="Produce">Produce</option>
                                        </select>
                                    ) : (
                                        client.serviceType || '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>Unite Us</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            className={styles.editInput}
                                            value={editForm.caseIdExternal}
                                            onChange={e => setEditForm({ ...editForm, caseIdExternal: e.target.value })}
                                            placeholder="https://app.uniteus.io/dashboard/cases/open/..."
                                        />
                                    ) : client.caseIdExternal?.trim() ? (
                                        <a
                                            href={client.caseIdExternal.startsWith('http') ? client.caseIdExternal : `https://${client.caseIdExternal}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                        >
                                            Open in Unite Us <ExternalLink size={14} />
                                        </a>
                                    ) : (
                                        '—'
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className={styles.section}>
                        <h3>Financials & Eligibility</h3>
                        <div className={styles.infoGrid}>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Authorized Amount ($)</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>$</span>
                                            <input
                                                type="number"
                                                className={styles.editInput}
                                                value={editForm.authorizedAmount}
                                                onChange={e => setEditForm({ ...editForm, authorizedAmount: parseFloat(e.target.value) || 0 })}
                                            />
                                        </div>
                                    ) : (
                                        client.authorizedAmount !== null && client.authorizedAmount !== undefined
                                            ? `$${client.authorizedAmount.toFixed(2)}`
                                            : '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem}>
                                <div className={styles.label}>Expiration Date</div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <input
                                            type="date"
                                            className={styles.editInput}
                                            value={editForm.expirationDate ? editForm.expirationDate.split('T')[0] : ''}
                                            onChange={e => setEditForm({ ...editForm, expirationDate: e.target.value })}
                                        />
                                    ) : (
                                        client.expirationDate
                                            ? new Date(client.expirationDate).toLocaleDateString()
                                            : '-'
                                    )}
                                </div>
                            </div>
                            <div className={styles.infoItem + ' ' + styles.fullWidth}>
                                <div className={styles.label}>
                                    {client.serviceType === 'Boxes' ? 'Approved Boxes/Cycle' : 'Approved Meals/Week'}
                                </div>
                                <div className={styles.value}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <input
                                                type="number"
                                                className={styles.editInput}
                                                value={client.serviceType === 'Boxes' ? editForm.authorizedAmount : editForm.approvedMealsPerWeek}
                                                onChange={e => {
                                                    const val = parseInt(e.target.value) || 0;
                                                    if (client.serviceType === 'Boxes') {
                                                        setEditForm({
                                                            ...editForm,
                                                            approvedMealsPerWeek: val,
                                                            authorizedAmount: val
                                                        });
                                                    } else {
                                                        setEditForm({ ...editForm, approvedMealsPerWeek: val });
                                                    }
                                                }}
                                            />
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                {client.serviceType === 'Boxes' ? 'Boxes/Cycle' : 'Meals/Week'}
                                            </span>
                                        </div>
                                    ) : (
                                        client.serviceType === 'Boxes'
                                            ? `${client.authorizedAmount || 0} Boxes/Cycle`
                                            : `${client.approvedMealsPerWeek || 0} Meals/Week`
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Dependents Section */}
                    {!client.parentClientId && (
                        <div className={styles.section}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h3>Dependents</h3>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setShowAddDependentForm(!showAddDependentForm)}
                                    style={{ fontSize: '0.75rem' }}
                                >
                                    <Plus size={14} style={{ marginRight: '4px' }} />
                                    {showAddDependentForm ? 'Cancel' : 'Add Dependent'}
                                </button>
                            </div>

                            {showAddDependentForm && (
                                <div style={{
                                    padding: '12px',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--bg-surface-hover)',
                                    marginBottom: '12px'
                                }}>
                                    <div className={styles.formGroup} style={{ marginBottom: '8px' }}>
                                        <label className="label" style={{ fontSize: '0.75rem' }}>Name</label>
                                        <input
                                            className="input input-sm"
                                            value={dependentName}
                                            onChange={e => setDependentName(e.target.value)}
                                            placeholder="Dependent Name"
                                            autoFocus
                                        />
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                        <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                                            <label className="label" style={{ fontSize: '0.75rem' }}>DOB</label>
                                            <input
                                                type="date"
                                                className="input input-sm"
                                                value={dependentDob}
                                                onChange={e => setDependentDob(e.target.value)}
                                            />
                                        </div>
                                        <div className={styles.formGroup} style={{ marginBottom: 0 }}>
                                            <label className="label" style={{ fontSize: '0.75rem' }}>CIN#</label>
                                            <input
                                                className="input input-sm"
                                                value={dependentCin}
                                                onChange={e => setDependentCin(e.target.value)}
                                                placeholder="CIN"
                                            />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                        <button
                                            className="btn btn-secondary btn-sm"
                                            onClick={() => setShowAddDependentForm(false)}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="btn btn-primary btn-sm"
                                            disabled={!dependentName.trim() || creatingDependent}
                                            onClick={handleCreateDependent}
                                        >
                                            {creatingDependent ? <Loader2 className="animate-spin" size={14} /> : 'Create'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {loadingDependents ? (
                                <div className={styles.emptyText} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Loader2 size={16} className="animate-spin" />
                                    Loading dependants…
                                </div>
                            ) : localDependents.length === 0 ? (
                                <div className={styles.emptyText}>No dependants</div>
                            ) : (
                                <div className={styles.dependentsList}>
                                    {localDependents.map(dep => (
                                        <div
                                            key={dep.id}
                                            className={styles.dependentCard}
                                            onClick={() => onOpenProfile(dep.id)}
                                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                                        >
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div className={styles.depName}>{dep.fullName}</div>
                                                <div className={styles.depInfo}>
                                                    {dep.dob && <span>DOB: {new Date(dep.dob).toLocaleDateString()}</span>}
                                                    {dep.cin && <span> | CIN: {dep.cin}</span>}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                style={{ flexShrink: 0, padding: '4px 8px' }}
                                                title="Delete dependent"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteDependent(dep);
                                                }}
                                                disabled={deletingDependentId === dep.id}
                                                aria-label={`Delete ${dep.fullName}`}
                                            >
                                                {deletingDependentId === dep.id ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : (
                                                    <Trash2 size={14} />
                                                )}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Screening Submissions Section */}
                    <div className={styles.section}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <div>
                                <h3 style={{ marginBottom: '2px' }}>Screening Form Submissions</h3>
                                <div style={{
                                    fontSize: '0.75rem',
                                    fontWeight: 500,
                                    color: (() => {
                                        const status = client?.screeningStatus || 'not_started';
                                        switch (status) {
                                            case 'waiting_approval': return '#48be85';
                                            case 'approved': return 'var(--color-success)';
                                            case 'rejected': return 'var(--color-danger)';
                                            default: return 'var(--text-tertiary)';
                                        }
                                    })()
                                }}>
                                    Status: {(() => {
                                        const status = client?.screeningStatus || 'not_started';
                                        switch (status) {
                                            case 'not_started': return 'Not Started';
                                            case 'waiting_approval': return 'Pending Approval';
                                            case 'approved': return 'Approved';
                                            case 'rejected': return 'Rejected';
                                            default: return 'Not Started';
                                        }
                                    })()}
                                </div>
                            </div>
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={handleOpenScreeningForm}
                                disabled={loadingForm}
                                style={{ fontSize: '0.75rem' }}
                            >
                                {loadingForm ? (
                                    <Loader2 className="animate-spin" size={14} />
                                ) : (
                                    <>
                                        <FileText size={14} style={{ marginRight: '4px' }} />
                                        New Form
                                    </>
                                )}
                            </button>
                        </div>
                        <div className={styles.submissionsList}>
                            {submissions.length === 0 ? (
                                <div className={styles.emptyText}>No submissions yet</div>
                            ) : (
                                submissions.map((sub) => (
                                    <div key={sub.id} className={styles.submissionCard} style={{ borderLeftColor: getStatusColor(sub.status) }}>
                                        <div className={styles.subHeader}>
                                            <div className={styles.subMeta}>
                                                {sub.status === 'accepted' && <CheckCircle size={16} color="#10b981" />}
                                                {sub.status === 'rejected' && <XCircle size={16} color="#ef4444" />}
                                                {sub.status === 'pending' && <Clock size={16} color="#f59e0b" />}
                                                <span className={styles.subDate}>{new Date(sub.created_at).toLocaleDateString()}</span>
                                            </div>
                                            {sub.status === 'accepted' && sub.pdf_url && (
                                                <button
                                                    className={styles.downloadBtn}
                                                    onClick={() => {
                                                        const r2Domain = process.env.NEXT_PUBLIC_R2_DOMAIN;
                                                        if (!r2Domain) return;
                                                        const url = r2Domain.startsWith('http')
                                                            ? `${r2Domain}/${sub.pdf_url}`
                                                            : `https://${r2Domain}/${sub.pdf_url}`;
                                                        window.open(url, '_blank');
                                                    }}
                                                >
                                                    <Download size={14} /> PDF
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
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

function getStatusColor(status: string) {
    switch (status) {
        case 'accepted': return '#10b981';
        case 'rejected': return '#ef4444';
        case 'pending': return '#f59e0b';
        default: return '#6b7280';
    }
}
