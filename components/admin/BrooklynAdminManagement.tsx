'use client';

import { useState, useEffect, useActionState } from 'react';
import { getBrooklynAdmins, addAdmin, deleteAdmin, updateAdmin } from '@/lib/auth-actions';
import styles from './AdminManagement.module.css';

type Admin = {
    id: string;
    username: string;
    created_at: string;
    name?: string;
};

export function BrooklynAdminManagement() {
    const [admins, setAdmins] = useState<Admin[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);

    const [addState, addAction, isAdding] = useActionState(addAdmin, undefined);
    const [updateState, updateAction, isUpdating] = useActionState(updateAdmin, undefined);

    useEffect(() => {
        fetchAdmins();
    }, []);

    useEffect(() => {
        if (addState?.success) {
            fetchAdmins();
        }
    }, [addState]);

    useEffect(() => {
        if (updateState?.success) {
            setEditingAdmin(null);
            fetchAdmins();
        }
    }, [updateState]);

    async function fetchAdmins() {
        setLoading(true);
        const data = await getBrooklynAdmins();
        setAdmins(data || []);
        setLoading(false);
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure you want to delete this Brooklyn admin?')) return;

        try {
            await deleteAdmin(id);
            fetchAdmins();
            if (editingAdmin?.id === id) {
                setEditingAdmin(null);
            }
        } catch (error) {
            alert('Failed to delete Brooklyn admin');
        }
    }

    function handleEdit(admin: Admin) {
        setEditingAdmin(admin);
    }

    function handleCancelEdit() {
        setEditingAdmin(null);
    }

    const currentState = editingAdmin ? updateState : addState;
    const isPending = editingAdmin ? isUpdating : isAdding;

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Brooklyn Admins</h2>
            <p className={styles.adminDate} style={{ marginBottom: '1rem' }}>
                These accounts can only see the Client Dashboard (Brooklyn clients), Routes (Brooklyn), and Meal Plan Edits (Brooklyn). They cannot access Orders, Billing, or Admin.
            </p>

            <div className={styles.list}>
                {loading && <p>Loading...</p>}
                {!loading && admins.length === 0 && <p>No Brooklyn admins yet.</p>}
                {admins.map(admin => (
                    <div key={admin.id} className={styles.adminItem}>
                        <div className={styles.adminInfo}>
                            <span className={styles.adminName}>{admin.name || 'Brooklyn Admin'} ({admin.username})</span>
                            <span className={styles.adminDate}>Created: {new Date(admin.created_at).toLocaleDateString()}</span>
                        </div>
                        <div>
                            <button
                                className={styles.editButton}
                                onClick={() => handleEdit(admin)}
                            >
                                Edit
                            </button>
                            <button
                                className={styles.deleteButton}
                                onClick={() => handleDelete(admin.id)}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <form
                key={editingAdmin ? editingAdmin.id : 'new'}
                className={styles.form}
                action={editingAdmin ? updateAction : addAction}
            >
                <h3 className={styles.formTitle}>
                    {editingAdmin ? `Edit Brooklyn Admin: ${editingAdmin.username}` : 'Add New Brooklyn Admin'}
                </h3>

                {editingAdmin && <input type="hidden" name="id" value={editingAdmin.id} />}
                {!editingAdmin && <input type="hidden" name="role" value="brooklyn_admin" />}

                <div className={styles.inputGroup}>
                    <label className={styles.label} htmlFor="ba-name">Name</label>
                    <input
                        className={styles.input}
                        id="ba-name"
                        name="name"
                        type="text"
                        placeholder="Brooklyn Admin Name"
                        defaultValue={editingAdmin?.name || ''}
                    />
                </div>

                {!editingAdmin && (
                    <div className={styles.inputGroup}>
                        <label className={styles.label} htmlFor="ba-username">Username</label>
                        <input
                            className={styles.input}
                            id="ba-username"
                            name="username"
                            type="text"
                            required
                            placeholder="brooklyn1"
                        />
                    </div>
                )}

                <div className={styles.inputGroup}>
                    <label className={styles.label} htmlFor="ba-password">Password</label>
                    <input
                        className={styles.input}
                        id="ba-password"
                        name="password"
                        type="password"
                        required={!editingAdmin}
                        placeholder={editingAdmin ? 'New Password (leave blank to keep)' : '••••••••'}
                    />
                </div>

                <button
                    type="submit"
                    className={styles.addButton}
                    disabled={isPending}
                >
                    {isPending
                        ? (editingAdmin ? 'Updating...' : 'Adding...')
                        : (editingAdmin ? 'Update Brooklyn Admin' : 'Add Brooklyn Admin')
                    }
                </button>

                {editingAdmin && (
                    <button
                        type="button"
                        onClick={handleCancelEdit}
                        className={styles.cancelButton}
                    >
                        Cancel
                    </button>
                )}

                {currentState?.message && (
                    <div className={currentState.success ? styles.success : styles.error}>
                        {currentState.message}
                    </div>
                )}
            </form>
        </div>
    );
}
