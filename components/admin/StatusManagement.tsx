'use client';

import { useState, useEffect } from 'react';
import { ClientStatus } from '@/lib/types';
import { addStatus, deleteStatus, updateStatus } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Trash2, Plus, Edit2, X, Check, Truck } from 'lucide-react';
import styles from './StatusManagement.module.css';

export function StatusManagement() {
    const { getStatuses, invalidateReferenceData } = useDataCache();
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [newStatusName, setNewStatusName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadStatuses();
    }, []);

    async function loadStatuses() {
        const data = await getStatuses();
        setStatuses(data);
        setLoading(false);
    }

    async function handleAdd() {
        if (!newStatusName.trim()) return;
        const status = await addStatus(newStatusName);
        invalidateReferenceData(); // Invalidate cache after add
        setStatuses([...statuses, status]);
        setNewStatusName('');
    }

    async function handleDelete(id: string) {
        if (confirm('Are you sure you want to delete this status?')) {
            await deleteStatus(id);
            invalidateReferenceData(); // Invalidate cache after delete
            setStatuses(statuses.filter(s => s.id !== id));
        }
    }

    function startEdit(status: ClientStatus) {
        setEditingId(status.id);
        setEditingName(status.name);
    }

    function cancelEdit() {
        setEditingId(null);
        setEditingName('');
    }

    async function saveEditName(id: string) {
        if (!editingName.trim()) return;
        const updated = await updateStatus(id, { name: editingName });
        if (updated) {
            invalidateReferenceData(); // Invalidate cache after update
            setStatuses(statuses.map(s => s.id === id ? updated : s));
            setEditingId(null);
        }
    }

    async function toggleDeliveriesAllowed(status: ClientStatus) {
        const updated = await updateStatus(status.id, { deliveriesAllowed: !status.deliveriesAllowed });
        if (updated) {
            invalidateReferenceData(); // Invalidate cache after update
            setStatuses(statuses.map(s => s.id === status.id ? updated : s));
        }
    }

    async function toggleRequiresUnitsOnChange(status: ClientStatus) {
        const updated = await updateStatus(status.id, { requiresUnitsOnChange: !status.requiresUnitsOnChange });
        if (updated) {
            invalidateReferenceData(); // Invalidate cache after update
            setStatuses(statuses.map(s => s.id === status.id ? updated : s));
        }
    }

    if (loading) return <div>Loading...</div>;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h2 className={styles.title}>Client Status Management</h2>
                <p className={styles.subtitle}>Define the lifecycle stages for clients.</p>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span>Status Name</span>
                    <span>Deliveries Allowed?</span>
                    <span>Requires Units?</span>
                    <span style={{ width: '80px' }}>Actions</span>
                </div>
                {statuses.map(status => (
                    <div key={status.id} className={styles.item}>
                        {editingId === status.id ? (
                            <div className={styles.editRow}>
                                <input
                                    className="input"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    autoFocus
                                />
                                <div className={styles.actions}>
                                    <button className="btn btn-primary" onClick={() => saveEditName(status.id)} title="Save">
                                        <Check size={16} />
                                    </button>
                                    <button className="btn btn-secondary" onClick={cancelEdit} title="Cancel">
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className={styles.statusInfo} style={{ flex: 1 }}>
                                    <span className={styles.statusName}>{status.name}</span>
                                    {status.isSystemDefault && <span className="badge">System Default</span>}
                                </div>

                                <div style={{ width: '150px', display: 'flex', alignItems: 'center' }}>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            checked={status.deliveriesAllowed}
                                            onChange={() => toggleDeliveriesAllowed(status)}
                                        />
                                        {status.deliveriesAllowed ? 'Allowed' : 'Not Allowed'}
                                    </label>
                                </div>

                                <div style={{ width: '150px', display: 'flex', alignItems: 'center' }}>
                                    <label className={styles.toggleLabel}>
                                        <input
                                            type="checkbox"
                                            checked={status.requiresUnitsOnChange ?? false}
                                            onChange={() => toggleRequiresUnitsOnChange(status)}
                                        />
                                        {status.requiresUnitsOnChange ? 'Yes' : 'No'}
                                    </label>
                                </div>

                                <div className={styles.actions}>
                                    {!status.isSystemDefault && (
                                        <>
                                            <button className={styles.iconBtn} onClick={() => startEdit(status)} title="Edit">
                                                <Edit2 size={16} />
                                            </button>
                                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(status.id)} title="Delete">
                                                <Trash2 size={16} />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                ))}
            </div>

            <div className={styles.addForm}>
                <input
                    className="input"
                    placeholder="New Status Name..."
                    value={newStatusName}
                    onChange={(e) => setNewStatusName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <button className="btn btn-primary" onClick={handleAdd}>
                    <Plus size={16} /> Add Status
                </button>
            </div>
        </div>
    );
}
