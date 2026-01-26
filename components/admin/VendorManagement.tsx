'use client';

import { useState, useEffect, useCallback } from 'react';
import { Vendor, ServiceType } from '@/lib/types';
import { updateVendor } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Check } from 'lucide-react';
import styles from './VendorManagement.module.css';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Equipment'];

export function VendorManagement() {
    const { getVendors, invalidateReferenceData } = useDataCache();
    const [mainVendor, setMainVendor] = useState<Vendor | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
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
    const [isSaving, setIsSaving] = useState(false);

    // Find the main vendor (isDefault: true, or first vendor if none is default)
    const findMainVendor = useCallback((vendors: Vendor[]): Vendor | null => {
        if (vendors.length === 0) return null;
        
        // First, try to find a vendor with isDefault: true
        const defaultVendor = vendors.find(v => v.isDefault === true);
        if (defaultVendor) return defaultVendor;
        
        // If no default vendor, use the first vendor
        return vendors[0];
    }, []);

    const loadVendors = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            const data = await getVendors();
            const main = findMainVendor(data);
            setMainVendor(main);
            
            // Auto-populate form with main vendor data
            if (main) {
                setFormData({
                    ...main,
                    password: '' // Don't populate password field for security
                });
            }
            
            console.log('[VendorManagement] Loaded main vendor:', main?.name || 'None');
        } catch (err) {
            console.error('[VendorManagement] Error loading vendors:', err);
            setError(err instanceof Error ? err.message : 'Failed to load vendors');
            setMainVendor(null);
        } finally {
            setIsLoading(false);
        }
    }, [getVendors, findMainVendor]);

    useEffect(() => {
        loadVendors();
    }, [loadVendors]);

    async function handleSubmit() {
        if (!mainVendor) {
            alert('No main vendor found. Please ensure at least one vendor exists.');
            return;
        }

        if (!formData.name) {
            alert('Please enter a vendor name.');
            return;
        }

        if (!formData.deliveryDays || formData.deliveryDays.length === 0) {
            alert('Please select at least one delivery day.');
            return;
        }

        setIsSaving(true);
        try {
            // Ensure password is string | undefined, not null (to match updateVendor signature)
            const dataToUpdate = {
                ...formData,
                password: formData.password ?? undefined
            };
            await updateVendor(mainVendor.id, dataToUpdate);
            invalidateReferenceData(); // Invalidate cache after update
            await loadVendors();
            alert('Vendor updated successfully.');
        } catch (err) {
            console.error('[VendorManagement] Error updating vendor:', err);
            alert('Failed to update vendor: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            setIsSaving(false);
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
                    <p className={styles.subtitle}>Configure the main vendor settings.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                        className="btn btn-secondary" 
                        onClick={loadVendors}
                        disabled={isLoading || isSaving}
                        title="Refresh vendor data"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {isLoading ? (
                <div className={styles.emptyState}>
                    <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                    <p>Loading vendor information...</p>
                </div>
            ) : error ? (
                <div className={styles.emptyState} style={{ color: 'var(--color-danger)' }}>
                    <p>Error loading vendor: {error}</p>
                    <button className="btn btn-secondary" onClick={loadVendors} style={{ marginTop: '1rem' }}>
                        Retry
                    </button>
                </div>
            ) : !mainVendor ? (
                <div className={styles.emptyState}>
                    <p>No vendor found. Please create a vendor first.</p>
                </div>
            ) : (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>Edit Main Vendor</h3>
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
                            placeholder="Leave blank to keep current password"
                        />
                        <p className={styles.hint} style={{ marginTop: '0.25rem' }}>
                            Leave blank to keep the current password unchanged
                        </p>
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
                        <button 
                            className="btn btn-primary" 
                            onClick={handleSubmit}
                            disabled={isSaving}
                        >
                            <Check size={16} /> {isSaving ? 'Saving...' : 'Save Vendor'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
