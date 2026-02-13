'use client';

import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '@/lib/actions';
import { AppSettings } from '@/lib/types';
import { getTodayInAppTz } from '@/lib/timezone';
import styles from './SettingsManagement.module.css';

export function SettingsManagement() {
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<{ text: string; success: boolean } | null>(null);
    const [runningExpired, setRunningExpired] = useState(false);
    const [expiredResult, setExpiredResult] = useState<{ message: string; success: boolean } | null>(null);

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
        setRunningExpired(true);
        setExpiredResult(null);
        const dateParam = getTodayInAppTz();
        try {
            const res = await fetch(`/api/create-expired-meal-planner-orders?date=${dateParam}`, {
                method: 'POST',
            });
            const data = await res.json();
            if (!res.ok) {
                setExpiredResult({ message: data.error || 'Request failed.', success: false });
                return;
            }
            const ordersCreated = data.ordersCreated ?? 0;
            const msg = ordersCreated > 0
                ? `Created ${ordersCreated} order(s) for expiration date ${dateParam}.`
                : data.message || `No meal planner items expire on ${dateParam}.`;
            setExpiredResult({ message: msg, success: true });
        } catch (err) {
            setExpiredResult({
                message: err instanceof Error ? err.message : 'Failed to run create expired meal days.',
                success: false,
            });
        } finally {
            setRunningExpired(false);
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
                        Create orders for meal planner items that expire today.
                    </p>
                    <button
                        type="button"
                        className={styles.actionButton}
                        onClick={handleRunCreateExpiredOrders}
                        disabled={runningExpired}
                    >
                        {runningExpired ? 'Running...' : 'Create Orders (Expired Today)'}
                    </button>
                    {expiredResult && (
                        <div className={expiredResult.success ? styles.success : styles.error} style={{ marginTop: '0.75rem' }}>
                            {expiredResult.message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
