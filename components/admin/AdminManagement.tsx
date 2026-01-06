'use client';

import { useState, useEffect, startTransition, useActionState } from 'react';
import { getAdmins, addAdmin, deleteAdmin, updateAdmin } from '@/lib/auth-actions';
import styles from './AdminManagement.module.css';

type Admin = {
    id: string;
    username: string;
    created_at: string;
    name?: string;
};

export function AdminManagement() {
    const [admins, setAdmins] = useState<Admin[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingAdmin, setEditingAdmin] = useState<Admin | null>(null);

    const [addState, addAction, isAdding] = useActionState(addAdmin, undefined);
    const [updateState, updateAction, isUpdating] = useActionState(updateAdmin, undefined);

    useEffect(() => {
        fetchAdmins();
    }, []);

    // Effect to refetch when add or update is successful
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
        const data = await getAdmins();
        setAdmins(data || []);
        setLoading(false);
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure you want to delete this admin?')) return;

        try {
            await deleteAdmin(id);
            fetchAdmins();
            if (editingAdmin?.id === id) {
                setEditingAdmin(null);
            }
        } catch (error) {
            alert('Failed to delete admin');
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
            <h2 className={styles.title}>Admin Accounts</h2>

            <div className={styles.list}>
                {loading && <p>Loading...</p>}
                {!loading && admins.length === 0 && <p>No admins found (using environment variable admin?).</p>}
                {admins.map(admin => (
                    <div key={admin.id} className={styles.adminItem}>
                        <div className={styles.adminInfo}>
                            <span className={styles.adminName}>{admin.name || 'Admin'} ({admin.username})</span>
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
                    {editingAdmin ? `Edit Admin: ${editingAdmin.username}` : 'Add New Admin'}
                </h3>

                {editingAdmin && <input type="hidden" name="id" value={editingAdmin.id} />}

                <div className={styles.inputGroup}>
                    <label className={styles.label} htmlFor="name">Name</label>
                    <input
                        className={styles.input}
                        id="name"
                        name="name"
                        type="text"
                        placeholder="Admin Name"
                        defaultValue={editingAdmin?.name || ''}
                    />
                </div>

                {!editingAdmin && (
                    <div className={styles.inputGroup}>
                        <label className={styles.label} htmlFor="username">Username</label>
                        <input
                            className={styles.input}
                            id="username"
                            name="username"
                            type="text"
                            required
                            placeholder="newadmin"
                        />
                    </div>
                )}

                <div className={styles.inputGroup}>
                    <label className={styles.label} htmlFor="password">Password</label>
                    <input
                        className={styles.input}
                        id="password"
                        name="password"
                        type="password"
                        required={!editingAdmin}
                        placeholder={editingAdmin ? "New Password (leave blank to keep)" : "••••••••"}
                    />
                </div>

                <button
                    type="submit"
                    className={styles.addButton}
                    disabled={isPending}
                >
                    {isPending
                        ? (editingAdmin ? 'Updating...' : 'Adding...')
                        : (editingAdmin ? 'Update Admin' : 'Add Admin')
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
