'use client';

import { useState, useEffect } from 'react';
import { Vendor, ServiceType } from '@/lib/types';
import { addVendor, updateVendor, deleteVendor } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, Truck } from 'lucide-react';
import styles from './VendorManagement.module.css';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Equipment'];

export function VendorManagement() {
    const { getVendors, invalidateReferenceData } = useDataCache();
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [isMultiCreating, setIsMultiCreating] = useState(false); // New state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Vendor>>({
        name: '',
        email: '',
        password: '',
        isActive: true,
        deliveryDays: [],
        allowsMultipleDeliveries: false,
        serviceTypes: ['Food'],
        minimumMeals: 0,
        cutoffHours: 0
    });
    const [multiCreateInput, setMultiCreateInput] = useState(''); // New state

    useEffect(() => {
        loadVendors();
    }, []);

    async function loadVendors() {
        const data = await getVendors();
        setVendors(data);
    }

    function resetForm() {
        setFormData({
            name: '',
            email: '',
            password: '',
            isActive: true,
            deliveryDays: [],
            allowsMultipleDeliveries: false,
            serviceTypes: ['Food'],
            minimumMeals: 0,
            cutoffHours: 0
        });
        setIsCreating(false);
        setIsMultiCreating(false);
        setEditingId(null);
        setMultiCreateInput('');
    }

    function handleEditInit(vendor: Vendor) {
        setFormData({
            ...vendor,
            password: '' // Don't populate password field for security
        });
        setEditingId(vendor.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name) return;
        // Validation for single create
        if (!formData.deliveryDays || formData.deliveryDays.length === 0) {
            alert('Please select at least one delivery day.');
            return;
        }

        if (editingId) {
            // Ensure password is string | undefined, not null (to match updateVendor signature)
            const dataToUpdate = {
                ...formData,
                password: formData.password ?? undefined
            };
            await updateVendor(editingId, dataToUpdate);
        } else {
            // Same treatment: ensure password/email are string | undefined, not null
            const dataToAdd = {
                ...formData,
                password: formData.password ?? undefined,
                email: formData.email ?? undefined
            };
            await addVendor(dataToAdd as Omit<Vendor, 'id'> & { password?: string; email?: string });
        }
        invalidateReferenceData(); // Invalidate cache after update/add
        await loadVendors();
        resetForm();
    }

    async function handleMultiSubmit() {
        if (!multiCreateInput.trim()) return;
        const names = multiCreateInput.split('\n').map(n => n.trim()).filter(n => n);

        // Parallel creation (could be optimized with a bulk insert endpoint ideally)
        await Promise.all(names.map(name => addVendor({
            name,
            serviceTypes: ['Food'], // Defaults
            isActive: true,
            deliveryDays: ['Monday'], // Default? Or maybe prompt? Assume basic default.
            allowsMultipleDeliveries: false
        })));

        invalidateReferenceData(); // Invalidate cache after multi-create
        await loadVendors();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this vendor?')) {
            await deleteVendor(id);
            invalidateReferenceData(); // Invalidate cache after delete
            await loadVendors();
        }
    }

    function toggleDay(day: string) {
        const current = formData.deliveryDays || [];
        const nextDays = current.includes(day)
            ? current.filter(d => d !== day)
            : [...current, day];

        setFormData({
            ...formData,
            deliveryDays: nextDays,
            allowsMultipleDeliveries: nextDays.length > 1
        });
    }

    function toggleServiceType(type: ServiceType) {
        const current = formData.serviceTypes || [];
        const nextTypes = current.includes(type)
            ? current.filter(t => t !== type)
            : [...current, type];

        // Ensure at least one type is selected
        if (nextTypes.length === 0) return;

        setFormData({ ...formData, serviceTypes: nextTypes });
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Vendor Management</h2>
                    <p className={styles.subtitle}>Configure food and box vendors.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!isCreating && !editingId && !isMultiCreating && (
                        <>
                            <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                                <Plus size={16} /> New Vendor
                            </button>
                            <button className="btn btn-secondary" onClick={() => setIsMultiCreating(true)}>
                                <Plus size={16} /> Multi-Create
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Multi Create Modal/Form */}
            {isMultiCreating && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>Add Multiple Vendors</h3>
                    <p className={styles.hint}>Enter one vendor name per line. They will be created with default settings (Food, Active, Monday delivery).</p>
                    <textarea
                        className="input"
                        rows={6}
                        value={multiCreateInput}
                        onChange={e => setMultiCreateInput(e.target.value)}
                        placeholder="Vendor A&#10;Vendor B&#10;Vendor C"
                        style={{ marginBottom: '1rem' }}
                    />
                    <div className={styles.formActions}>
                        <button className="btn btn-primary" onClick={handleMultiSubmit}>
                            <Check size={16} /> Create All
                        </button>
                        <button className="btn btn-secondary" onClick={resetForm}>
                            <X size={16} /> Cancel
                        </button>
                    </div>
                </div>
            )}

            {(isCreating || editingId) && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>{editingId ? 'Edit Vendor' : 'New Vendor'}</h3>
                    {/* Reuse existing form structure */}
                    <div className={styles.formGroup}>
                        <label className="label">Vendor Name</label>
                        <input
                            className="input"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label className="label">Email</label>
                        <input
                            type="email"
                            className="input"
                            value={formData.email || ''}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder="vendor@example.com"
                        />
                    </div>
                    <div className={styles.formGroup}>
                        <label className="label">Password</label>
                        <input
                            type="password"
                            className="input"
                            value={formData.password || ''}
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                            placeholder={editingId ? "Leave blank to keep current password" : "Enter password"}
                        />
                        {editingId && (
                            <p className={styles.hint} style={{ marginTop: '0.25rem' }}>
                                Leave blank to keep the current password unchanged
                            </p>
                        )}
                    </div>
                    {/* ... (Existing form fields for Type, Status, Days, Frequency) ... */}
                    <div className={styles.row}>
                        <div className={styles.formGroup} style={{ flex: 2 }}>
                            <label className="label">Service Types</label>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                {SERVICE_TYPES.map(t => (
                                    <button
                                        key={t}
                                        type="button"
                                        className={`btn ${formData.serviceTypes?.includes(t) ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => toggleServiceType(t)}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            fontSize: '0.875rem',
                                            border: formData.serviceTypes?.includes(t) ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                                            backgroundColor: formData.serviceTypes?.includes(t) ? 'var(--color-primary)' : 'var(--bg-surface)',
                                            color: formData.serviceTypes?.includes(t) ? 'white' : 'var(--text-primary)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease'
                                        }}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className={styles.formGroup} style={{ flex: 1 }}>
                            <label className="label">Status</label>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                Active
                            </label>
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Delivery Days</label>
                        <div className={styles.daysGrid}>
                            {DAYS_OF_WEEK.map(day => (
                                <label key={day} className={`${styles.daySelect} ${formData.deliveryDays?.includes(day) ? styles.dayActive : ''}`}>
                                    <input
                                        type="checkbox"
                                        className={styles.hiddenCheck}
                                        checked={formData.deliveryDays?.includes(day)}
                                        onChange={() => toggleDay(day)}
                                    />
                                    {day}
                                </label>
                            ))}
                        </div>
                        {formData.deliveryDays && formData.deliveryDays.length > 0 && (
                            <p className={styles.hint} style={{ marginTop: '0.5rem' }}>
                                Frequency: {formData.allowsMultipleDeliveries ? 'Multiple deliveries per week' : 'Single delivery per week'} (calculated automatically)
                            </p>
                        )}
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Minimum Meals Required</label>
                        <input
                            type="number"
                            className="input"
                            min="0"
                            value={formData.minimumMeals ?? 0}
                            onChange={e => setFormData({ ...formData, minimumMeals: Number(e.target.value) || 0 })}
                            placeholder="0"
                        />
                        <p className={styles.hint} style={{ marginTop: '0.25rem' }}>
                            Minimum number of meals required when ordering from this vendor. Clients must order at least this many meals from this vendor. (0 = no minimum)
                        </p>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Cutoff Time (Hours)</label>
                        <input
                            type="number"
                            className="input"
                            min="0"
                            value={formData.cutoffHours ?? 0}
                            onChange={e => setFormData({ ...formData, cutoffHours: Number(e.target.value) || 0 })}
                            placeholder="0"
                        />
                        <p className={styles.hint} style={{ marginTop: '0.25rem' }}>
                            Hours before midnight of the delivery day that orders must be finalized. (e.g. 48 = 2 days before)
                        </p>
                    </div>

                    <div className={styles.formActions}>
                        <button className="btn btn-primary" onClick={handleSubmit}>
                            <Check size={16} /> Save Vendor
                        </button>
                        <button className="btn btn-secondary" onClick={resetForm}>
                            <X size={16} /> Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Services</th>
                            <th>Status</th>
                            <th>Days</th>
                            <th>Frequency</th>
                            <th>Min Meals</th>
                            <th>Cutoff (h)</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vendors.map(vendor => (
                            <tr key={vendor.id}>
                                <td style={{ fontWeight: 500 }}>{vendor.name}</td>
                                <td>
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                        {vendor.serviceTypes.map(t => (
                                            <span key={t} className="badge" style={{ fontSize: '0.75rem' }}>{t}</span>
                                        ))}
                                    </div>
                                </td>
                                <td>{vendor.isActive ? <span style={{ color: 'var(--color-success)' }}>Active</span> : <span style={{ color: 'var(--text-tertiary)' }}>Inactive</span>}</td>
                                <td>{vendor.deliveryDays.join(', ')}</td>
                                <td>
                                    <span style={{ fontSize: '0.85rem' }}>
                                        {vendor.allowsMultipleDeliveries ? 'Multiple' : 'Once'}
                                    </span>
                                </td>
                                <td>{vendor.minimumMeals && vendor.minimumMeals > 0 ? vendor.minimumMeals : '-'}</td>
                                <td>{vendor.cutoffHours && vendor.cutoffHours > 0 ? vendor.cutoffHours : '-'}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className={styles.actions}>
                                        <button className={styles.iconBtn} onClick={() => handleEditInit(vendor)}>
                                            <Edit2 size={16} />
                                        </button>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(vendor.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {vendors.length === 0 && !isCreating && !isMultiCreating && (
                    <div className={styles.emptyState}>No vendors configured. Create one to get started.</div>
                )}
            </div>
        </div>
    );
}
