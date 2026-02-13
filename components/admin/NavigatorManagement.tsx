'use client';

import { useState, useEffect } from 'react';
import { Navigator } from '@/lib/types';
import { addNavigator, updateNavigator, deleteNavigator, getNavigatorLogs } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { getTodayInAppTz } from '@/lib/timezone';
import { Plus, Edit2, Trash2, X, Check, Users, Download } from 'lucide-react';
import styles from './NavigatorManagement.module.css';

export function NavigatorManagement() {
    const { getNavigators, invalidateReferenceData } = useDataCache();
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [isMultiCreating, setIsMultiCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Navigator>>({
        name: '',
        isActive: true,
        email: '',
        password: ''
    });
    const [multiCreateInput, setMultiCreateInput] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const data = await getNavigators();
        setNavigators(data);
    }

    function resetForm() {
        setFormData({
            name: '',
            isActive: true,
            email: '',
            password: ''
        });
        setIsCreating(false);
        setIsMultiCreating(false);
        setEditingId(null);
        setMultiCreateInput('');
    }

    function handleEditInit(nav: Navigator) {
        setFormData({ ...nav, password: '' }); // Don't show hash, allow reset
        setEditingId(nav.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name) return;

        if (editingId) {
            await updateNavigator(editingId, formData);
        } else {
            await addNavigator(formData as Omit<Navigator, 'id'>);
        }

        invalidateReferenceData(); // Invalidate cache after update/add
        await loadData();
        resetForm();
    }

    async function handleMultiSubmit() {
        if (!multiCreateInput.trim()) return;
        const names = multiCreateInput.split('\n').map(n => n.trim()).filter(n => n);

        await Promise.all(names.map(name => addNavigator({
            name,
            isActive: true
        })));

        invalidateReferenceData(); // Invalidate cache after multi-create
        await loadData();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this navigator?')) {
            await deleteNavigator(id);
            invalidateReferenceData(); // Invalidate cache after delete
            await loadData();
        }
    }

    async function handleDownloadLogs(nav: Navigator) {
        try {
            const logs = await getNavigatorLogs(nav.id);

            if (!logs || logs.length === 0) {
                alert('No logs found for this navigator.');
                return;
            }

            // Generate CSV
            const headers = ['Date', 'Client Name', 'Old Status', 'New Status', 'Units Added'];
            const rows = logs.map((log: any) => [
                new Date(log.createdAt).toLocaleString(),
                log.clientName,
                log.oldStatus,
                log.newStatus,
                log.unitsAdded
            ]);

            const csvContent = [
                headers.join(','),
                ...rows.map((row: any[]) => row.map(cell => `"${cell}"`).join(','))
            ].join('\n');

            // Download
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `navigator_logs_${nav.name.replace(/\s+/g, '_')}_${getTodayInAppTz()}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (error) {
            console.error('Error downloading logs:', error);
            alert('Failed to download logs.');
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Navigator Management</h2>
                    <p className={styles.subtitle}>Manage staff members who manage clients.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!isCreating && !editingId && !isMultiCreating && (
                        <>
                            <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                                <Plus size={16} /> New Navigator
                            </button>
                            <button className="btn btn-secondary" onClick={() => setIsMultiCreating(true)}>
                                <Plus size={16} /> Multi-Create
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Multi Create Modal */}
            {isMultiCreating && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>Add Multiple Navigators</h3>
                    <p className={styles.hint}>Enter one name per line.</p>
                    <textarea
                        className="input"
                        rows={6}
                        value={multiCreateInput}
                        onChange={e => setMultiCreateInput(e.target.value)}
                        placeholder="Navigator A&#10;Navigator B"
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
                    <h3 className={styles.formTitle}>{editingId ? 'Edit Navigator' : 'New Navigator'}</h3>

                    <div className={styles.formGroup}>
                        <label className="label">Full Name</label>
                        <input
                            className="input"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Email (Optional)</label>
                        <input
                            className="input"
                            type="email"
                            value={formData.email || ''}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                            placeholder="navigator@example.com"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">{editingId ? 'Reset Password (Optional)' : 'Password'}</label>
                        <input
                            className="input"
                            type="password"
                            value={formData.password || ''}
                            onChange={e => setFormData({ ...formData, password: e.target.value })}
                            placeholder={editingId ? 'Leave blank to keep unchanged' : 'Secret password'}
                        />
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

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th style={{ width: '100px' }}>Status</th>
                            <th style={{ textAlign: 'right', width: '100px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {navigators.map(nav => (
                            <tr key={nav.id}>
                                <td style={{ fontWeight: 500 }}>
                                    {nav.name}
                                    {nav.email && <div style={{ fontSize: '0.8em', color: 'var(--text-tertiary)', fontWeight: 400 }}>{nav.email}</div>}
                                </td>
                                <td>
                                    {nav.isActive ?
                                        <span style={{ color: 'var(--color-success)' }}>Active</span> :
                                        <span style={{ color: 'var(--text-tertiary)' }}>Inactive</span>
                                    }
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className={styles.actions}>
                                        <button className={styles.iconBtn} onClick={() => handleDownloadLogs(nav)} title="Download Logs">
                                            <Download size={16} />
                                        </button>
                                        <button className={styles.iconBtn} onClick={() => handleEditInit(nav)}>
                                            <Edit2 size={16} />
                                        </button>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(nav.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {navigators.length === 0 && !isCreating && !isMultiCreating && (
                    <div className={styles.emptyState}>No navigators configured.</div>
                )}
            </div>
        </div>
    );
}
