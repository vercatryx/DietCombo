'use client';

import { useState, useEffect } from 'react';
import { MenuItem, Vendor } from '@/lib/types';
import { addMenuItem, updateMenuItem, deleteMenuItem } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, Utensils } from 'lucide-react';
import styles from './MenuManagement.module.css';

export function MenuManagement() {
    const { getVendors, getMenuItems, invalidateReferenceData } = useDataCache();
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [selectedVendorId, setSelectedVendorId] = useState<string>('');

    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<MenuItem>>({
        name: '',
        value: 0,
        priceEach: 0,
        isActive: true
    });

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const [vData, mData] = await Promise.all([getVendors(), getMenuItems()]);
        // Filter: Menus only for companies that ship 'Food'
        const foodVendors = vData.filter(v => v.serviceTypes.includes('Food'));
        setVendors(foodVendors);
        setMenuItems(mData);
        if (foodVendors.length > 0 && !selectedVendorId) {
            setSelectedVendorId(foodVendors[0].id);
        }
    }

    const filteredItems = menuItems.filter(item => item.vendorId === selectedVendorId);

    function resetForm() {
        setFormData({
            name: '',
            value: 0,
            priceEach: 0,
            isActive: true,
            quotaValue: 1,
            categoryId: ''
        });
        setIsCreating(false);
        setEditingId(null);
    }

    function handleEditInit(item: MenuItem) {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!selectedVendorId) return;
        if (!formData.name) return;
        if (!formData.priceEach || formData.priceEach <= 0) {
            alert('Price must be greater than 0');
            return;
        }

        if (editingId) {
            await updateMenuItem(editingId, formData);
        } else {
            await addMenuItem({
                ...formData,
                vendorId: selectedVendorId
            } as Omit<MenuItem, 'id'>);
        }

        invalidateReferenceData(); // Invalidate cache after update/add
        // Refresh items
        const mData = await getMenuItems();
        setMenuItems(mData);
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this menu item?')) {
            const result = await deleteMenuItem(id);
            if (result && !result.success && result.message) {
                alert(result.message);
            }
            invalidateReferenceData(); // Invalidate cache after delete
            const mData = await getMenuItems();
            setMenuItems(mData);
        }
    }

    if (vendors.length === 0) {
        return <div className={styles.emptyState}>No vendors available. Please creating a vendor first.</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.sidebar}>
                <h3 className={styles.sidebarTitle}>Vendors</h3>
                <div className={styles.vendorList}>
                    {vendors.map(v => (
                        <button
                            key={v.id}
                            className={`${styles.vendorBtn} ${selectedVendorId === v.id ? styles.activeVendor : ''}`}
                            onClick={() => { setSelectedVendorId(v.id); resetForm(); }}
                        >
                            {v.name}
                            <span className="badge" style={{ fontSize: '0.65rem' }}>{v.serviceTypes.join(', ')}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.main}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>Menu Items (v2)</h2>
                        <p className={styles.subtitle}>Manage items for {vendors.find(v => v.id === selectedVendorId)?.name}</p>
                    </div>
                    {!isCreating && !editingId && (
                        <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                            <Plus size={16} /> Add Item
                        </button>
                    )}
                </div>

                {(isCreating || editingId) && (
                    <div className={styles.formCard}>
                        <h3 className={styles.formTitle}>{editingId ? 'Edit Item' : 'New Item'}</h3>
                        <div className={styles.row}>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Item Name</label>
                                <input
                                    className="input"
                                    value={formData.name}
                                    autoFocus
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className={styles.row}>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Value (Price/Points)</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={formData.value}
                                    onChange={e => setFormData({ ...formData, value: Number(e.target.value) })}
                                />
                            </div>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Price Each</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={formData.priceEach ?? ''}
                                    onChange={e => setFormData({ ...formData, priceEach: Number(e.target.value) || undefined })}
                                />
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                Active
                            </label>
                        </div>

                        <div className={styles.formActions}>
                            <button className="btn btn-primary" onClick={handleSubmit}>
                                <Check size={16} /> Save
                            </button>
                            <button className="btn btn-secondary" onClick={resetForm}>
                                <X size={16} /> Cancel
                            </button>
                        </div>
                    </div>
                )}

                <div className={styles.list}>
                    <div className={styles.listHeader}>
                        <span style={{ flex: 3 }}>Name</span>
                        <span style={{ flex: 1 }}>Value</span>
                        <span style={{ flex: 1 }}>Price Each</span>
                        <span style={{ flex: 1 }}>Status</span>
                        <span style={{ width: '120px', textAlign: 'right' }}>Actions</span>
                    </div>
                    {filteredItems.map(item => (
                        <div key={item.id} className={styles.item}>
                            <span style={{ flex: 3, fontWeight: 500, fontSize: '1.1rem' }}>{item.name}</span>
                            <span style={{ flex: 1, fontSize: '1rem' }}>{item.value}</span>
                            <span style={{ flex: 1, fontSize: '1rem' }}>{item.priceEach ?? '-'}</span>
                            <span style={{ flex: 1 }}>
                                {item.isActive ? <span className="badge" style={{ color: 'var(--color-success)', background: 'rgba(34, 197, 94, 0.1)', fontSize: '0.9rem', padding: '4px 12px' }}>Active</span> : <span className="badge" style={{ fontSize: '0.9rem', padding: '4px 12px' }}>Inactive</span>}
                            </span>
                            <div className={styles.actions}>
                                <button className={styles.iconBtn} onClick={() => handleEditInit(item)}>
                                    <Edit2 size={20} />
                                </button>
                                <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(item.id)}>
                                    <Trash2 size={20} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {filteredItems.length === 0 && !isCreating && (
                        <div className={styles.emptyList}>No items found for this vendor.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
