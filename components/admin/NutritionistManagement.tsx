'use client';

import { useState, useEffect } from 'react';
import { Nutritionist } from '@/lib/types';
import { addNutritionist, updateNutritionist, deleteNutritionist, getNutritionists } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check } from 'lucide-react';
import styles from './NutritionistManagement.module.css';

export function NutritionistManagement() {
    const { invalidateReferenceData } = useDataCache();
    const [nutritionists, setNutritionists] = useState<Nutritionist[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Nutritionist>>({
        name: '',
        email: ''
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        const data = await getNutritionists();
        setNutritionists(data);
        setLoading(false);
    }

    function resetForm() {
        setFormData({
            name: '',
            email: ''
        });
        setIsCreating(false);
        setEditingId(null);
    }

    function handleEditInit(nutritionist: Nutritionist) {
        setFormData({ ...nutritionist });
        setEditingId(nutritionist.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name) return;

        if (editingId) {
            await updateNutritionist(editingId, formData);
        } else {
            await addNutritionist(formData as Omit<Nutritionist, 'id'>);
        }

        invalidateReferenceData();
        await loadData();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this nutritionist?')) {
            await deleteNutritionist(id);
            invalidateReferenceData();
            await loadData();
        }
    }

    if (loading) return <div>Loading...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Nutritionist Management</h2>
                    <p className={styles.subtitle}>Manage nutritionist information.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!isCreating && !editingId && (
                        <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                            <Plus size={16} /> New Nutritionist
                        </button>
                    )}
                </div>
            </div>

            {(isCreating || editingId) && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>{editingId ? 'Edit Nutritionist' : 'New Nutritionist'}</h3>

                    <div className={styles.formGroup}>
                        <label className="label">Name</label>
                        <input
                            className="input"
                            value={formData.name || ''}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                            placeholder="Nutritionist Name"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Email (Optional)</label>
                        <input
                            className="input"
                            type="email"
                            value={formData.email || ''}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder="nutritionist@example.com"
                        />
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

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Email</th>
                            <th style={{ textAlign: 'right', width: '100px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {nutritionists.map(nutritionist => (
                            <tr key={nutritionist.id}>
                                <td style={{ fontWeight: 500 }}>
                                    {nutritionist.name}
                                </td>
                                <td>
                                    {nutritionist.email || <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className={styles.actions}>
                                        <button className={styles.iconBtn} onClick={() => handleEditInit(nutritionist)}>
                                            <Edit2 size={16} />
                                        </button>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(nutritionist.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {nutritionists.length === 0 && !isCreating && (
                    <div className={styles.emptyState}>No nutritionists configured.</div>
                )}
            </div>
        </div>
    );
}












