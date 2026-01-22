'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { Users, Truck, Utensils, Box as BoxIcon, Settings, LayoutDashboard, ChevronLeft, ChevronRight, LogOut, Store, History, PlayCircle, AlertCircle, RefreshCw, Mail, ChevronDown, ChevronUp, Route } from 'lucide-react';
import styles from './Sidebar.module.css';
import { logout } from '@/lib/auth-actions';
import { useState, useEffect, useCallback } from 'react';
import { useDataCache } from '@/lib/data-cache';
import { AppSettings } from '@/lib/types';
import { getNavigatorLogs } from '@/lib/actions';

const navItems = [
    { label: 'Client Dashboard', href: '/clients', icon: Users },
    { label: 'My History', href: '/navigator-history', icon: History, role: 'navigator' },
    { label: 'Vendors', href: '/vendors', icon: Store },
    { label: 'Routes', href: '/routes', icon: Route },
    { label: 'Admin Control', href: '/admin', icon: Settings },
];

import { useTime } from '@/lib/time-context';
import { Clock, Edit2, X, Check } from 'lucide-react';
import { SidebarActiveOrderSummary } from './SidebarActiveOrderSummary';

function SimulationButton() {
    const { getSettings } = useDataCache();
    const [simulating, setSimulating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [simulationResult, setSimulationResult] = useState<{
        success: boolean;
        message: string;
        skippedReasons?: string[];
        errors?: string[];
        skippedCount?: number;
    } | null>(null);
    const [showSkippedDetails, setShowSkippedDetails] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailSent, setEmailSent] = useState(false);
    const [settings, setSettings] = useState<AppSettings | null>(null);

    useEffect(() => {
        loadSettings().catch(err => {
            console.error('Error loading settings:', err);
            setError('Failed to load settings');
        });
    }, []);

    async function loadSettings() {
        try {
            const data = await getSettings();
            setSettings(data);
        } catch (err) {
            console.error('Error in loadSettings:', err);
            setError('Failed to load settings');
        }
    }

    async function handleSendEmail(skipData?: { skippedReasons?: string[]; errors?: string[]; skippedCount?: number }) {
        const dataToUse = skipData || simulationResult;

        if (!dataToUse?.skippedReasons || dataToUse.skippedReasons.length === 0) {
            if (!skipData) {
                alert('No skipped orders to report.');
            }
            return;
        }

        if (!settings?.reportEmail || !settings.reportEmail.trim()) {
            if (!skipData) {
                alert('Please configure a report email address in settings first.');
            }
            return;
        }

        setSendingEmail(true);
        setEmailSent(false);

        try {
            const res = await fetch('/api/send-skipped-orders-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: settings.reportEmail.trim(),
                    skippedReasons: dataToUse.skippedReasons,
                    errors: dataToUse.errors || [],
                    skippedCount: dataToUse.skippedCount || 0
                })
            });

            const result = await res.json();
            if (result.success) {
                setEmailSent(true);
                setTimeout(() => setEmailSent(false), 5000);
            } else {
                if (!skipData) {
                    alert(`Failed to send email: ${result.error || 'Unknown error'}`);
                } else {
                    console.error('Failed to send email automatically:', result.error);
                }
            }
        } catch (error) {
            console.error('Error sending email:', error);
            if (!skipData) {
                alert('Failed to send email. Please check the console for details.');
            }
        } finally {
            setSendingEmail(false);
        }
    }

    async function handleSimulateRun() {
        if (!confirm('This will create orders for all scheduled upcoming orders. The original Upcoming Orders will be preserved. Proceed?')) return;

        setSimulating(true);
        setSimulationResult(null);
        setShowSkippedDetails(false);
        setEmailSent(false);

        try {
            console.log('[Simulate Delivery] Starting simulation...');
            const res = await fetch('/api/simulate-delivery-cycle', { method: 'POST' });
            const data = await res.json();

            // Log detailed results to browser console
            console.log('[Simulate Delivery] Response:', data);
            console.log(`[Simulate Delivery] Summary: Found ${data.totalFound || 0} upcoming orders, Created ${data.processedCount || 0} orders, Skipped ${data.skippedCount || 0} orders`);

            if (data.skippedReasons && data.skippedReasons.length > 0) {
                console.group('[Simulate Delivery] Skipped Orders:');
                data.skippedReasons.forEach((reason: string, index: number) => {
                    console.warn(`${index + 1}. ${reason}`);
                });
                console.groupEnd();
            }

            if (data.errors && data.errors.length > 0) {
                console.group('[Simulate Delivery] Errors:');
                data.errors.forEach((error: string, index: number) => {
                    console.error(`${index + 1}. ${error}`);
                });
                console.groupEnd();
            }

            if (data.debugLogs && data.debugLogs.length > 0) {
                console.group('[Simulate Delivery] Debug Logs:');
                data.debugLogs.forEach((log: string) => {
                    console.log(log);
                });
                console.groupEnd();
            }

            setSimulationResult({
                success: data.success,
                message: data.message || (data.success ? 'Simulation completed successfully.' : 'Simulation failed.'),
                skippedReasons: data.skippedReasons,
                errors: data.errors,
                skippedCount: data.skippedCount
            });
            // Auto-expand skipped details if there are skipped orders
            if (data.skippedReasons && data.skippedReasons.length > 0) {
                setShowSkippedDetails(true);
                // Automatically send email if email is configured
                if (settings?.reportEmail && settings.reportEmail.trim()) {
                    // Pass the data directly to avoid state timing issues
                    handleSendEmail({
                        skippedReasons: data.skippedReasons,
                        errors: data.errors,
                        skippedCount: data.skippedCount
                    });
                }
            }
        } catch (error) {
            console.error('[Simulate Delivery] Exception:', error);
            setSimulationResult({ success: false, message: 'An error occurred during simulation.' });
        } finally {
            setSimulating(false);
        }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
            <button
                onClick={handleSimulateRun}
                disabled={simulating}
                style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: simulating ? 'var(--bg-surface-hover)' : '#4f46e5',
                    color: 'white',
                    border: '1px solid var(--border-color)',
                    borderRadius: '0.5rem',
                    cursor: simulating ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    transition: 'all 0.2s ease',
                    opacity: simulating ? 0.7 : 1,
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)'
                }}
                onMouseEnter={(e) => {
                    if (!simulating) {
                        e.currentTarget.style.backgroundColor = 'var(--color-primary)';
                        e.currentTarget.style.color = '#ffffff';
                        e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.15)';
                    }
                }}
                onMouseLeave={(e) => {
                    if (!simulating) {
                        e.currentTarget.style.backgroundColor = '#4f46e5';
                        e.currentTarget.style.color = 'white';
                        e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
                    }
                }}
            >
                {simulating ? <RefreshCw className="spin" size={16} /> : <PlayCircle size={16} />}
                {simulating ? 'Creating...' : 'Create Orders'}
            </button>

            {simulationResult && (
                <div style={{
                    backgroundColor: 'var(--bg-panel)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '0.5rem',
                    padding: '0.75rem',
                    fontSize: '0.8rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    maxHeight: '400px',
                    overflowY: 'auto'
                }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        color: simulationResult.success ? 'var(--color-success)' : 'var(--color-danger)',
                        fontWeight: 600
                    }}>
                        {simulationResult.success ? <Truck size={14} /> : <AlertCircle size={14} />}
                        {simulationResult.message}
                    </div>

                    {(simulationResult.skippedReasons && simulationResult.skippedReasons.length > 0) && (
                        <div style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: '0.25rem',
                            backgroundColor: 'var(--bg-surface)',
                            overflow: 'hidden'
                        }}>
                            <button
                                onClick={() => setShowSkippedDetails(!showSkippedDetails)}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    backgroundColor: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-primary)',
                                    cursor: 'pointer',
                                    fontSize: '0.75rem',
                                    fontWeight: 500
                                }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <AlertCircle size={12} style={{ color: 'var(--color-warning)' }} />
                                    {simulationResult.skippedCount || simulationResult.skippedReasons.length} Skipped
                                </span>
                                {showSkippedDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>

                            {showSkippedDetails && (
                                <div style={{
                                    padding: '0.5rem',
                                    borderTop: '1px solid var(--border-color)',
                                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                                    maxHeight: '200px',
                                    overflowY: 'auto'
                                }}>
                                    <ul style={{
                                        margin: 0,
                                        paddingLeft: '16px',
                                        listStyle: 'disc',
                                        fontSize: '0.7rem',
                                        color: 'var(--text-secondary)'
                                    }}>
                                        {simulationResult.skippedReasons.map((reason, index) => (
                                            <li key={index} style={{ marginBottom: '4px' }}>
                                                {reason}
                                            </li>
                                        ))}
                                    </ul>

                                    {settings?.reportEmail && (
                                        <div style={{
                                            marginTop: '0.5rem',
                                            paddingTop: '0.5rem',
                                            borderTop: '1px solid var(--border-color)',
                                            display: 'flex',
                                            gap: '0.5rem',
                                            alignItems: 'center'
                                        }}>
                                            <button
                                                onClick={() => handleSendEmail()}
                                                disabled={sendingEmail || emailSent}
                                                style={{
                                                    fontSize: '0.7rem',
                                                    padding: '4px 8px',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    backgroundColor: emailSent ? 'var(--color-success)' : 'var(--color-secondary)',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '0.25rem',
                                                    cursor: sendingEmail ? 'not-allowed' : 'pointer',
                                                    opacity: sendingEmail ? 0.6 : 1
                                                }}
                                            >
                                                {sendingEmail ? (
                                                    <>
                                                        <RefreshCw className="spin" size={10} />
                                                        Sending...
                                                    </>
                                                ) : emailSent ? (
                                                    <>
                                                        <Mail size={10} />
                                                        Sent!
                                                    </>
                                                ) : (
                                                    <>
                                                        <Mail size={10} />
                                                        Send Report
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {(simulationResult.errors && simulationResult.errors.length > 0) && (
                        <div style={{
                            border: '1px solid var(--color-danger)',
                            borderRadius: '0.25rem',
                            padding: '0.5rem',
                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                            maxHeight: '150px',
                            overflowY: 'auto'
                        }}>
                            <div style={{
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                color: 'var(--color-danger)',
                                marginBottom: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}>
                                <AlertCircle size={10} />
                                Errors ({simulationResult.errors.length})
                            </div>
                            <ul style={{
                                margin: 0,
                                paddingLeft: '16px',
                                listStyle: 'disc',
                                fontSize: '0.7rem',
                                color: 'var(--text-secondary)'
                            }}>
                                {simulationResult.errors.map((error, index) => (
                                    <li key={index} style={{ marginBottom: '2px' }}>
                                        {error}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function TimeWidget() {
    const { currentTime, isFakeTime, setFakeTime } = useTime();
    const [isEditing, setIsEditing] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [inputValue, setInputValue] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Only render time after client-side hydration to avoid hydration mismatches
    useEffect(() => {
        setMounted(true);
    }, []);

    // Format for datetime-local: YYYY-MM-DDThh:mm
    const formatForInput = useCallback((date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }, []);

    // Initialize input value when component mounts or when entering edit mode
    useEffect(() => {
        if (isEditing && mounted) {
            setInputValue(formatForInput(currentTime));
            setError(null);
        }
    }, [isEditing, mounted, currentTime, formatForInput]);

    // Sync input when not editing or when time changes naturally (if real time)
    useEffect(() => {
        if (!isEditing && mounted) {
            setInputValue(formatForInput(currentTime));
        }
    }, [currentTime, isEditing, mounted, formatForInput]);

    const handleSave = useCallback(() => {
        if (!inputValue.trim()) {
            setError('Please enter a valid date and time');
            return;
        }

        const date = new Date(inputValue);
        if (isNaN(date.getTime())) {
            setError('Invalid date format');
            return;
        }

        setFakeTime(date);
        setIsEditing(false);
        setError(null);
    }, [inputValue, setFakeTime]);

    const handleClear = useCallback(() => {
        setFakeTime(null);
        setIsEditing(false);
        setError(null);
    }, [setFakeTime]);

    const handleCancel = useCallback(() => {
        setIsEditing(false);
        setError(null);
        // Reset input to current time
        if (mounted) {
            setInputValue(formatForInput(currentTime));
        }
    }, [mounted, currentTime, formatForInput]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    }, [handleSave, handleCancel]);

    // Display mode
    if (!isEditing) {
        return (
            <div
                onClick={() => setIsEditing(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setIsEditing(true);
                    }
                }}
                style={{
                    backgroundColor: isFakeTime ? 'rgba(220, 38, 38, 0.1)' : 'var(--bg-surface)',
                    border: isFakeTime ? '1px solid var(--color-danger)' : '1px solid var(--border-color)',
                    borderRadius: '0.5rem',
                    padding: '0.75rem',
                    fontSize: '0.85rem',
                    color: isFakeTime ? 'var(--color-danger)' : 'var(--text-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    position: 'relative'
                }}
                title="Click to override system time"
                aria-label={`${isFakeTime ? 'Fake time active' : 'System time'}: ${mounted ? currentTime.toLocaleString() : 'Loading...'}`}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Clock size={14} aria-hidden="true" />
                        <span>{isFakeTime ? 'Fake Time Active' : 'System Time'}</span>
                    </div>
                    <Edit2 size={12} style={{ opacity: 0.5 }} aria-hidden="true" />
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 500, color: isFakeTime ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                    {mounted ? currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                </div>
                <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                    {mounted ? currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '---'}
                </div>
            </div>
        );
    }

    // Edit mode
    return (
        <div
            style={{
                backgroundColor: 'var(--bg-panel)',
                border: '1px solid var(--color-primary)',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
            }}
            role="dialog"
            aria-labelledby="time-widget-title"
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span id="time-widget-title" style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                    Set System Time
                </span>
                <button
                    onClick={handleCancel}
                    aria-label="Cancel editing"
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        padding: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    <X size={14} aria-hidden="true" />
                </button>
            </div>

            <div>
                <label htmlFor="time-input" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.75rem', opacity: 0.8 }}>
                    Date & Time
                </label>
                <input
                    id="time-input"
                    type="datetime-local"
                    value={inputValue}
                    onChange={(e) => {
                        setInputValue(e.target.value);
                        setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    autoFocus
                    aria-describedby={error ? 'time-error' : undefined}
                    aria-invalid={error ? 'true' : 'false'}
                    style={{
                        background: 'var(--bg-panel)',
                        border: error ? '1px solid var(--color-danger)' : '1px solid var(--border-color)',
                        color: 'var(--text-primary)',
                        borderRadius: '0.25rem',
                        padding: '0.5rem',
                        fontSize: '0.8rem',
                        width: '100%',
                        boxSizing: 'border-box'
                    }}
                />
                {error && (
                    <div id="time-error" role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.7rem', marginTop: '0.25rem' }}>
                        {error}
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '4px' }}>
                <button
                    onClick={handleSave}
                    aria-label="Save time"
                    style={{
                        flex: 1,
                        backgroundColor: 'var(--color-primary)',
                        color: 'black',
                        border: 'none',
                        borderRadius: '0.25rem',
                        padding: '0.5rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '4px',
                        fontWeight: 500,
                        transition: 'opacity 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.9';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                    }}
                >
                    <Check size={12} aria-hidden="true" /> Set
                </button>
                <button
                    onClick={handleClear}
                    aria-label="Reset to real time"
                    style={{
                        flex: 1,
                        backgroundColor: 'var(--color-danger)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '0.25rem',
                        padding: '0.5rem',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                        fontWeight: 500,
                        transition: 'opacity 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.opacity = '0.9';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.opacity = '1';
                    }}
                >
                    Reset
                </button>
            </div>
        </div>
    );
}

export function Sidebar({
    isCollapsed = false,
    toggle,
    userName = 'Admin',
    userRole = 'admin',
    userId = ''
}: {
    isCollapsed?: boolean;
    toggle?: () => void;
    userName?: string;
    userRole?: string;
    userId?: string;
}) {
    const pathname = usePathname();
    const [isLogoutVisible, setIsLogoutVisible] = useState(false);
    const { currentTime, isFakeTime } = useTime();
    const [todayUnits, setTodayUnits] = useState<number | null>(null);
    const [weekUnits, setWeekUnits] = useState<number | null>(null);
    const [isLoadingUnits, setIsLoadingUnits] = useState(false);

    // Fetch navigator logs and calculate units for today and this week
    const loadNavigatorUnits = useCallback(async () => {
        if (!userId) return;
        
        setIsLoadingUnits(true);
        try {
            const logs = await getNavigatorLogs(userId);
            
            // Get current time (using fake time if set)
            const now = currentTime;
            const today = new Date(now);
            today.setHours(0, 0, 0, 0);
            
            // Calculate start of week (Sunday)
            const weekStart = new Date(today);
            const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, etc.
            weekStart.setDate(today.getDate() - dayOfWeek);
            weekStart.setHours(0, 0, 0, 0);
            
            // Calculate end of week (Saturday)
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);
            
            // Calculate today's units
            const todayTotal = logs
                .filter(log => {
                    const logDate = new Date(log.createdAt);
                    return logDate >= today;
                })
                .reduce((sum, log) => sum + log.unitsAdded, 0);
            
            // Calculate this week's units (Sunday-Saturday)
            const weekTotal = logs
                .filter(log => {
                    const logDate = new Date(log.createdAt);
                    return logDate >= weekStart && logDate <= weekEnd;
                })
                .reduce((sum, log) => sum + log.unitsAdded, 0);
            
            setTodayUnits(todayTotal);
            setWeekUnits(weekTotal);
        } catch (error) {
            console.error('Error loading navigator units:', error);
            setTodayUnits(0);
            setWeekUnits(0);
        } finally {
            setIsLoadingUnits(false);
        }
    }, [userId, currentTime]);

    useEffect(() => {
        if (userRole === 'navigator' && userId) {
            loadNavigatorUnits();
        }
    }, [userRole, userId, loadNavigatorUnits]);

    return (
        <aside
            className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''}`}
        >
            <div className={styles.header}>
                {!isCollapsed && (
                    <div className={styles.logo}>
                        <Image
                            src="/diet-fantasy-logo.png"
                            alt="Logo"
                            width={240}
                            height={240}
                            className={styles.logoImage}
                            priority
                        />
                    </div>
                )}
                {isCollapsed && (
                    <div className={styles.logoCollapsed}>
                        <Image
                            src="/diet-fantasy-logo.png"
                            alt="Logo"
                            width={48}
                            height={48}
                            className={styles.logoImageCollapsed}
                            priority
                        />
                    </div>
                )}
                <button onClick={toggle} className={styles.toggleBtn}>
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
            </div>

            <nav className={styles.nav}>
                {navItems.filter(item => {
                    if (item.label === 'Admin Control') {
                        return userRole === 'admin' || userRole === 'super-admin';
                    }
                    if (item.label === 'Vendors') {
                        return userRole === 'admin' || userRole === 'super-admin';
                    }
                    if ((item as any).role) {
                        return userRole === (item as any).role;
                    }
                    return true;
                }).map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname.startsWith(item.href);
                    const isMyHistory = item.label === 'My History' && userRole === 'navigator';

                    return (
                        <div key={item.href} style={{ display: 'flex', flexDirection: 'column' }}>
                            <Link
                                href={item.href}
                                className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                                title={isCollapsed ? item.label : undefined}
                            >
                                <Icon size={20} />
                                {!isCollapsed && <span>{item.label}</span>}
                            </Link>
                            {isMyHistory && !isCollapsed && (
                                <div style={{
                                    paddingLeft: '3rem',
                                    paddingRight: 'var(--spacing-md)',
                                    paddingTop: '1rem',
                                    paddingBottom: '1rem',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1rem'
                                }}>
                                    {isLoadingUnits ? (
                                        <div style={{
                                            backgroundColor: '#22c55e',
                                            borderRadius: '50%',
                                            width: '80px',
                                            height: '80px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: 'white',
                                            fontSize: '0.875rem',
                                            fontWeight: 600,
                                            opacity: 0.6
                                        }}>
                                            Loading...
                                        </div>
                                    ) : (
                                        <>
                                            {todayUnits !== null && (
                                                <div style={{
                                                    backgroundColor: '#22c55e',
                                                    borderRadius: '50%',
                                                    width: '80px',
                                                    height: '80px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: 'white',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600,
                                                    gap: '0.125rem'
                                                }}>
                                                    <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{todayUnits}</span>
                                                    <span>Today</span>
                                                </div>
                                            )}
                                            {weekUnits !== null && (
                                                <div style={{
                                                    backgroundColor: '#22c55e',
                                                    borderRadius: '50%',
                                                    width: '80px',
                                                    height: '80px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: 'white',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600,
                                                    gap: '0.125rem'
                                                }}>
                                                    <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{weekUnits}</span>
                                                    <span>This Week</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Active Order Summary */}
            {!isCollapsed && <SidebarActiveOrderSummary />}

            {/* Create Orders Button and Time Display Widget */}
            {!isCollapsed && (
                <div style={{
                    padding: '0 1rem',
                    marginTop: 'auto',
                    marginBottom: '1rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                }}>
                    {(userRole === 'admin' || userRole === 'super-admin') && (
                        <SimulationButton />
                    )}
                    <TimeWidget />
                </div>
            )}

            <div className={styles.footer}>
                <div
                    className={`${isCollapsed ? styles.userCollapsed : styles.user} cursor-pointer`}
                    onClick={() => setIsLogoutVisible(!isLogoutVisible)}
                    style={{ cursor: 'pointer', position: 'relative' }}
                >
                    {!isCollapsed ? userName : (userName[0] || 'A').toUpperCase()}

                    {isLogoutVisible && (
                        <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: '0',
                            width: '100%',
                            backgroundColor: 'var(--bg-panel)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '0.375rem',
                            padding: '0.5rem',
                            marginBottom: '0.5rem',
                            zIndex: 50,
                            minWidth: isCollapsed ? 'max-content' : 'auto',
                            boxShadow: 'var(--shadow-md)'
                        }}>
                            <button
                                onClick={() => logout()}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    width: '100%',
                                    color: 'var(--color-danger)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '0.875rem',
                                    padding: '0.25rem'
                                }}
                            >
                                <LogOut size={16} />
                                <span>Log Out</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}
