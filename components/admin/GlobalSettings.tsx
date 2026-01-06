'use client';

import { useState, useEffect } from 'react';
import { AppSettings } from '@/lib/types';
import { updateSettings } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Save, Clock } from 'lucide-react';
import styles from './GlobalSettings.module.css';
import { useTime } from '@/lib/time-context';

function TimeOverrideControl() {
    const { isFakeTime, currentTime, setFakeTime } = useTime();

    // Local state for the input so we don't update context on every keystroke if we wanted, 
    // but dealing with date-time-local input, it's easier to just sync or have a "Set" button.
    // Let's use a "Set" button approach for clarity.

    // Format for datetime-local: YYYY-MM-DDThh:mm
    const formatForInput = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
        return localISOTime;
    };

    const [inputValue, setInputValue] = useState(formatForInput(currentTime));

    // When context changes (e.g. initial load), sync input if we aren't editing? 
    // Actually, if isFakeTime is true, input should reflect it.
    useEffect(() => {
        setInputValue(formatForInput(currentTime));
    }, [currentTime]);

    const handleToggle = () => {
        if (isFakeTime) {
            setFakeTime(null); // Reset to real time
        } else {
            // Enable with current input value or current time
            const date = new Date(inputValue);
            setFakeTime(date);
        }
    };

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
        if (isFakeTime) {
            // Update immediately if already enabled? Or wait for set?
            // "The user might have a settings switch" implies toggle.
            // Let's update immediately if enabled to see feedback.
            const date = new Date(e.target.value);
            if (!isNaN(date.getTime())) {
                setFakeTime(date);
            }
        }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <div className="flex items-center gap-2">
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={isFakeTime}
                        onChange={handleToggle}
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="ml-3 text-sm font-medium text-gray-300">
                        {isFakeTime ? 'Enabled' : 'Disabled (Using Real Time)'}
                    </span>
                </label>
            </div>

            {isFakeTime && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={16} className="text-blue-400" />
                    <input
                        type="datetime-local"
                        className="input"
                        value={inputValue}
                        onChange={handleDateChange}
                        style={{ maxWidth: '250px' }}
                    />
                </div>
            )}
        </div>
    );
}


const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function GlobalSettings() {
    const { getSettings, invalidateReferenceData } = useDataCache();
    const [settings, setSettings] = useState<AppSettings>({
        weeklyCutoffDay: 'Friday',
        weeklyCutoffTime: '17:00',
        reportEmail: ''
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const data = await getSettings();
        setSettings(data);
    }

    async function handleSave() {
        setSaving(true);
        await updateSettings(settings);
        invalidateReferenceData();
        setSaving(false);
        setMessage('Settings saved successfully!');
        setTimeout(() => setMessage(null), 3000);
    }


    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Global Application Settings</h2>
            <p className={styles.subtitle}>Configure system-wide rules and cutoff times.</p>

            <div className={styles.card}>
                <h3 className={styles.sectionTitle}>Weekly Order Cutoff</h3>
                <p className={styles.description}>
                    Orders placed or modified after this time will apply to the following week's delivery cycle.
                </p>

                <div className={styles.row}>
                    <div className={styles.formGroup}>
                        <label className="label">Cutoff Day</label>
                        <select
                            className="input"
                            value={settings.weeklyCutoffDay}
                            onChange={e => setSettings({ ...settings, weeklyCutoffDay: e.target.value })}
                        >
                            {DAYS.map(day => <option key={day} value={day}>{day}</option>)}
                        </select>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Cutoff Time (24h)</label>
                        <input
                            type="time"
                            className="input"
                            value={settings.weeklyCutoffTime}
                            onChange={e => setSettings({ ...settings, weeklyCutoffTime: e.target.value })}
                        />
                    </div>
                </div>

                <div className={styles.formGroup} style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <label className="label">Report Email Address</label>
                    <input
                        type="email"
                        className="input"
                        placeholder="email@example.com"
                        value={settings.reportEmail || ''}
                        onChange={e => setSettings({ ...settings, reportEmail: e.target.value })}
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                        Email address to receive delivery simulation reports for skipped orders.
                    </p>
                </div>

                <div className={styles.formGroup} style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <label className="label" style={{ marginBottom: 0 }}>Enable Passwordless Login (Email OTP)</label>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                                When enabled, customers will log in using a 6-digit code sent to their email.
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={settings.enablePasswordlessLogin || false}
                                onChange={e => setSettings({ ...settings, enablePasswordlessLogin: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </div>

                <div className={styles.actions}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    {message && <span className={styles.successMessage}>{message}</span>}
                </div>
            </div>

            <div className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                <h3 className={styles.sectionTitle}>Testing & Debugging</h3>
                <p className={styles.description}>
                    Override system behavior for testing purposes.
                </p>

                <div className={styles.row} style={{ alignItems: 'flex-end' }}>
                    <div className={styles.formGroup}>
                        <label className="label">Fake System Time</label>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                            Force the application to perceive the current time as:
                        </p>
                        <TimeOverrideControl />
                    </div>
                </div>
            </div>

        </div >
    );
}
