'use client';

import { useState, useEffect } from 'react';
import { Equipment } from '@/lib/types';
import { getEquipment, addEquipment, updateEquipment, deleteEquipment } from '@/lib/actions';
import { Plus, Edit2, Trash2, X, Check, Wrench } from 'lucide-react';
import styles from './MenuManagement.module.css';

export function EquipmentManagement() {
    const [equipment, setEquipment] = useState<Equipment[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Equipment>>({
        name: '',
        price: 0
    });

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const eData = await getEquipment();
        setEquipment(eData);
    }

    function resetForm() {
        setFormData({
            name: '',
            price: 0
        });
        setIsCreating(false);
        setEditingId(null);
    }

    function handleEditInit(item: Equipment) {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name || !formData.name.trim()) {
            alert('Name is required');
            return;
        }
        if (!formData.price || formData.price <= 0) {
            alert('Price must be greater than 0');
            return;
        }

        if (editingId) {
            await updateEquipment(editingId, formData);
        } else {
            await addEquipment({
                name: formData.name.trim(),
                price: formData.price
            } as Omit<Equipment, 'id'>);
        }

        await loadData();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this equipment item?')) {
            await deleteEquipment(id);
            await loadData();
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.main} style={{ width: '100%' }}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>Equipment</h2>
                        <p className={styles.subtitle}>Manage equipment items with name and price</p>
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
                                    placeholder="Enter equipment name"
                                />
                            </div>
                            <div className={styles.formGroup} style={{ flex: 1 }}>
                                <label className="label">Price</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="input"
                                    value={formData.price || ''}
                                    onChange={e => setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })}
                                    placeholder="0.00"
                                />
                            </div>
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
                        <span style={{ flex: 1 }}>Price</span>
                        <span style={{ width: '120px', textAlign: 'right' }}>Actions</span>
                    </div>
                    {equipment.map(item => (
                        <div key={item.id} className={styles.item}>
                            <span style={{ flex: 3, fontWeight: 500, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Wrench size={18} style={{ color: 'var(--color-primary)' }} />
                                {item.name}
                            </span>
                            <span style={{ flex: 1, fontSize: '1rem' }}>${item.price.toFixed(2)}</span>
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
                    {equipment.length === 0 && !isCreating && (
                        <div className={styles.emptyList}>No equipment items found. Add your first item to get started.</div>
                    )}
                </div>
            </div>
        </div>
    );
}

