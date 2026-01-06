'use client';

import { useState, useEffect } from 'react';
import { ItemCategory } from '@/lib/types';
import { addCategory, deleteCategory } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Trash2, Tag } from 'lucide-react';
import styles from './BoxTypeManagement.module.css'; // Reusing styles for now as they are similar

export function CategoryManagement() {
    const { getCategories, invalidateReferenceData } = useDataCache();
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [newItemName, setNewItemName] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const data = await getCategories();
        setCategories(data);
    }

    async function handleAdd() {
        if (!newItemName.trim()) return;
        await addCategory(newItemName);
        invalidateReferenceData(); // Invalidate cache after add
        setNewItemName('');
        setIsCreating(false);
        loadData();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this category?')) {
            await deleteCategory(id);
            invalidateReferenceData(); // Invalidate cache after delete
            loadData();
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.main} style={{ width: '100%', maxWidth: '800px', margin: '0 auto' }}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>Item Categories</h2>
                        <p className={styles.subtitle}>Define categories for menu items to be used in Box Quotas</p>
                    </div>
                    {!isCreating && (
                        <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                            <Plus size={16} /> Add Category
                        </button>
                    )}
                </div>

                {isCreating && (
                    <div className={styles.formCard} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: '1rem' }}>
                        <div className={styles.formGroup} style={{ flex: 1 }}>
                            <label className="label">Category Name</label>
                            <input
                                className="input"
                                value={newItemName}
                                autoFocus
                                onChange={e => setNewItemName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                                placeholder="e.g. Fruit, Vegetable, Protein"
                            />
                        </div>
                        <div className={styles.formActions} style={{ marginTop: 0 }}>
                            <button className="btn btn-primary" onClick={handleAdd}>Save</button>
                            <button className="btn btn-secondary" onClick={() => setIsCreating(false)}>Cancel</button>
                        </div>
                    </div>
                )}

                <div className={styles.list}>
                    {categories.length === 0 && !isCreating && (
                        <div className={styles.emptyList}>No categories defined yet.</div>
                    )}
                    {categories.map(cat => (
                        <div key={cat.id} className={styles.item}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                <Tag size={16} className="text-gray-400" />
                                <span style={{ fontWeight: 500 }}>{cat.name}</span>
                            </div>
                            <div className={styles.actions}>
                                <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(cat.id)} title="Delete Category">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
