'use client';

import { useState, useEffect } from 'react';
import { ProduceVendor } from '@/lib/types';
import { createProduceVendor, updateProduceVendor, deleteProduceVendor } from '@/lib/actions';
import { getProduceVendors, invalidateReferenceData } from '@/lib/cached-data';
import { Plus, Edit2, Trash2, X, Check, Copy, ExternalLink } from 'lucide-react';
import styles from './NavigatorManagement.module.css';

export function ProduceVendorManagement() {
    const [vendors, setVendors] = useState<ProduceVendor[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formName, setFormName] = useState('');
    const [formIsActive, setFormIsActive] = useState(true);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        invalidateReferenceData('produceVendors');
        const data = await getProduceVendors();
        setVendors(data);
    }

    function resetForm() {
        setFormName('');
        setFormIsActive(true);
        setIsCreating(false);
        setEditingId(null);
    }

    function handleEditInit(vendor: ProduceVendor) {
        setFormName(vendor.name);
        setFormIsActive(vendor.isActive);
        setEditingId(vendor.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formName.trim()) return;

        if (editingId) {
            await updateProduceVendor(editingId, { name: formName, isActive: formIsActive });
        } else {
            await createProduceVendor(formName);
        }

        await loadData();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Deactivate this produce vendor? Existing client assignments will be preserved.')) {
            await deleteProduceVendor(id);
            await loadData();
        }
    }

    function buildShareUrl(token: string) {
        const base = typeof window !== 'undefined' ? window.location.origin : '';
        return `${base}/vendors/produce?token=${token}`;
    }

    function handleCopyUrl(vendor: ProduceVendor) {
        const url = buildShareUrl(vendor.token);
        navigator.clipboard.writeText(url).then(() => {
            setCopiedId(vendor.id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Produce Vendor Management</h2>
                    <p className={styles.subtitle}>Manage produce vendors. Each vendor gets a unique shareable link.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!isCreating && !editingId && (
                        <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                            <Plus size={16} /> New Produce Vendor
                        </button>
                    )}
                </div>
            </div>

            {(isCreating || editingId) && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>{editingId ? 'Edit Produce Vendor' : 'New Produce Vendor'}</h3>

                    <div className={styles.formGroup}>
                        <label className="label">Vendor Name</label>
                        <input
                            className="input"
                            value={formName}
                            onChange={e => setFormName(e.target.value)}
                            placeholder="e.g. Fresh Farms, Green Grocer"
                            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                        />
                    </div>

                    {editingId && (
                        <div className={styles.formGroup}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={formIsActive}
                                    onChange={e => setFormIsActive(e.target.checked)}
                                />
                                Active
                            </label>
                        </div>
                    )}

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
                            <th>Shareable Link</th>
                            <th style={{ width: '100px' }}>Status</th>
                            <th style={{ textAlign: 'right', width: '120px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vendors.map(vendor => (
                            <tr key={vendor.id} style={{ opacity: vendor.isActive ? 1 : 0.5 }}>
                                <td style={{ fontWeight: 500 }}>{vendor.name}</td>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85em' }}>
                                        <code style={{
                                            padding: '2px 6px',
                                            background: 'var(--bg-surface)',
                                            borderRadius: '4px',
                                            fontSize: '0.85em',
                                            maxWidth: '300px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {buildShareUrl(vendor.token)}
                                        </code>
                                        <button
                                            className={styles.iconBtn}
                                            onClick={() => handleCopyUrl(vendor)}
                                            title="Copy link"
                                        >
                                            {copiedId === vendor.id ? <Check size={14} /> : <Copy size={14} />}
                                        </button>
                                        <a
                                            href={buildShareUrl(vendor.token)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={styles.iconBtn}
                                            title="Open in new tab"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                    </div>
                                </td>
                                <td>
                                    {vendor.isActive ?
                                        <span style={{ color: 'var(--color-success)' }}>Active</span> :
                                        <span style={{ color: 'var(--text-tertiary)' }}>Inactive</span>
                                    }
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className={styles.actions}>
                                        <button className={styles.iconBtn} onClick={() => handleEditInit(vendor)}>
                                            <Edit2 size={16} />
                                        </button>
                                        {vendor.isActive && (
                                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(vendor.id)}>
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {vendors.length === 0 && !isCreating && (
                    <div className={styles.emptyState}>No produce vendors configured. Add one to get started.</div>
                )}
            </div>
        </div>
    );
}
