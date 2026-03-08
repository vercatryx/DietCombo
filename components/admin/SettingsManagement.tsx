'use client';

import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '@/lib/actions';
import { AppSettings } from '@/lib/types';
import { getTodayInAppTz } from '@/lib/timezone';
import styles from './SettingsManagement.module.css';

const DELETE_CONFIRM_CLICKS = 5;

export function SettingsManagement() {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
    const [runningExpired, setRunningExpired] = useState(false);
    const [expiredResult, setExpiredResult] = useState<{ message: string; success: boolean } | null>(null);
    const [createOrderDate, setCreateOrderDate] = useState(() => {
        const t = getTodayInAppTz();
        return t;
    });
    const [deleteDate, setDeleteDate] = useState('');
    const [deleteClicks, setDeleteClicks] = useState(0);
    const [deleting, setDeleting] = useState(false);
    const [deleteResult, setDeleteResult] = useState<{ message: string; success: boolean } | null>(null);

    useEffect(() => {
        fetchSettings();
    }, []);

    async function fetchSettings() {
        setLoading(true);
        try {
            const data = await getSettings();
            setSettings(data);
        } catch (err) {
            setMessage({ text: 'Failed to load settings.', success: false });
        }
        setLoading(false);
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        if (!settings) return;

        setSaving(true);
        setMessage(null);
        try {
            await updateSettings(settings);
            setMessage({ text: 'Settings saved.', success: true });
        } catch (err) {
            setMessage({ text: 'Failed to save settings.', success: false });
        }
        setSaving(false);
    }

    function handleChange<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
        if (!settings) return;
        setSettings({ ...settings, [key]: value });
    }

    async function handleRunCreateExpiredOrders() {
        if (!createOrderDate || !/^\d{4}-\d{2}-\d{2}$/.test(createOrderDate)) {
            setExpiredResult({ message: 'Please select a scheduled delivery date (YYYY-MM-DD).', success: false });
            return;
        }
        setRunningExpired(true);
        setExpiredResult(null);
        try {
            const res = await fetch(`/api/create-expired-meal-planner-orders?date=${createOrderDate}`, {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) {
                setExpiredResult({ message: data.error || 'Request failed.', success: false });
                return;
            }
            const ordersCreated = data.ordersCreated ?? 0;
            const msg = ordersCreated > 0
                ? `Created ${ordersCreated} order(s) for scheduled delivery ${createOrderDate}.`
                : data.message || `No orders created for ${createOrderDate}.`;
            setExpiredResult({ message: msg, success: true });
        } catch (err) {
            setExpiredResult({
                message: err instanceof Error ? err.message : 'Failed to create orders.',
                success: false,
            });
        } finally {
            setRunningExpired(false);
        }
    }

    function handleDeleteDateChange(e: React.ChangeEvent<HTMLInputElement>) {
        setDeleteDate(e.target.value);
        setDeleteClicks(0);
        setDeleteResult(null);
    }

    async function handleDeleteOrdersForDay() {
        const nextClicks = deleteClicks + 1;
        if (nextClicks < DELETE_CONFIRM_CLICKS) {
            setDeleteClicks(nextClicks);
            setDeleteResult(null);
            return;
        }
        if (!deleteDate || !/^\d{4}-\d{2}-\d{2}$/.test(deleteDate)) {
            setDeleteResult({ message: 'Please select a valid date (YYYY-MM-DD).', success: false });
            return;
        }
        setDeleting(true);
        setDeleteResult(null);
        try {
            const res = await fetch('/api/admin/delete-orders-by-date', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: deleteDate,
                    confirmClicks: DELETE_CONFIRM_CLICKS,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setDeleteResult({
                    message: data.error || 'Failed to delete orders.',
                    success: false,
                });
                setDeleteClicks(0);
                return;
            }
            const deleted = data.deleted ?? 0;
            setDeleteResult({
                message: `Deleted ${deleted} order(s) for ${deleteDate}.`,
                success: true,
            });
            setDeleteClicks(0);
        } catch (err) {
            setDeleteResult({
                message: err instanceof Error ? err.message : 'Failed to delete orders.',
                success: false,
            });
            setDeleteClicks(0);
        } finally {
            setDeleting(false);
        }
    }

    if (loading) {
        return (
            <div className={styles.container}>
                <h2 className={styles.title}>Settings</h2>
                <p>Loading...</p>
            </div>
        );
    }

    if (!settings) {
        return (
            <div className={styles.container}>
                <h2 className={styles.title}>Settings</h2>
                <p>Failed to load settings.</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Settings</h2>

            <form onSubmit={handleSave} className={styles.form}>
                <div className={styles.inputGroup}>
                    <label className={styles.label}>Report email</label>
                    <input
                        className={styles.input}
                        type="email"
                        value={settings.reportEmail || ''}
                        onChange={(e) => handleChange('reportEmail', e.target.value)}
                        placeholder="email@example.com"
                    />
                </div>

                <div className={styles.toggleGroup}>
                    <label className={styles.toggleLabel}>
                        <input
                            type="checkbox"
                            checked={settings.enablePasswordlessLogin || false}
                            onChange={(e) => handleChange('enablePasswordlessLogin', e.target.checked)}
                        />
                        <span>Enable passwordless login for clients</span>
                    </label>
                    <p className={styles.helper}>
                        When enabled, clients log in with their email and receive a one-time code instead of a
                        password.
                    </p>
                </div>

                <div className={styles.buttonRow}>
                    <button type="submit" className={styles.saveButton} disabled={saving}>
                        {saving ? 'Saving...' : 'Save settings'}
                    </button>
                </div>

                {message && (
                    <div className={message.success ? styles.success : styles.error}>{message.text}</div>
                )}
            </form>

            <div className={styles.actionsSection}>
                <h3 className={styles.sectionTitle}>Actions</h3>
                <div className={styles.actionCard}>
                    <p className={styles.actionDescription}>
                        Create orders for a selected scheduled delivery date. Choose the date, then click to create orders for that day.
                    </p>
                    <div className={styles.inputGroup} style={{ marginBottom: '0.75rem' }}>
                        <label className={styles.label}>Scheduled delivery date</label>
                        <input
                            className={styles.input}
                            type="date"
                            value={createOrderDate}
                            onChange={(e) => {
                                setCreateOrderDate(e.target.value);
                                setExpiredResult(null);
                            }}
                            disabled={runningExpired}
                        />
                    </div>
                    <button
                        type="button"
                        className={styles.actionButton}
                        onClick={handleRunCreateExpiredOrders}
                        disabled={runningExpired || !createOrderDate}
                    >
                        {runningExpired ? 'Running...' : 'Create orders for this date'}
                    </button>
                    {expiredResult && (
                        <div className={expiredResult.success ? styles.success : styles.error} style={{ marginTop: '0.75rem' }}>
                            {expiredResult.message}
                        </div>
                    )}
                </div>

                <div className={styles.actionCard} style={{ marginTop: '1.5rem' }}>
                    <p className={styles.actionDescription}>
                        Delete all orders for a specific day. You must click Delete {DELETE_CONFIRM_CLICKS} times to confirm.
                    </p>
                    <div className={styles.inputGroup} style={{ marginBottom: '0.75rem' }}>
                        <label className={styles.label}>Date</label>
                        <input
                            className={styles.input}
                            type="date"
                            value={deleteDate}
                            onChange={handleDeleteDateChange}
                            disabled={deleting}
                        />
                    </div>
                    {deleteClicks > 0 && (
                        <p className={styles.deleteCounter}>
                            Clicks: {deleteClicks} of {DELETE_CONFIRM_CLICKS}
                        </p>
                    )}
                    <button
                        type="button"
                        className={styles.deleteButton}
                        onClick={handleDeleteOrdersForDay}
                        disabled={deleting || !deleteDate}
                    >
                        {deleting ? 'Deleting...' : 'Delete orders for this day'}
                    </button>
                    {deleteResult && (
                        <div className={deleteResult.success ? styles.success : styles.error} style={{ marginTop: '0.75rem' }}>
                            {deleteResult.message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
