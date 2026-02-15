'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import { Users, ChevronLeft, ChevronRight, LogOut, Download, History, Settings, Route, Package } from 'lucide-react';
import styles from './Sidebar.module.css';
import { logout } from '@/lib/auth-actions';
import { useState, useEffect, useCallback } from 'react';
import { getNavigatorLogs } from '@/lib/actions';

const navItems = [
    { label: 'Client Dashboard', href: '/clients', icon: Users },
    { label: 'My History', href: '/navigator-history', icon: History, role: 'navigator' },
    { label: 'Downloads', href: '/vendors', icon: Download },
    { label: 'Produce', href: '/vendors/produce', icon: Package },
    { label: 'Routes', href: '/routes', icon: Route },
    { label: 'Admin Control', href: '/admin', icon: Settings },
];

import { useTime } from '@/lib/time-context';
import { SidebarActiveOrderSummary } from './SidebarActiveOrderSummary';

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
    const { currentTime } = useTime();
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
                    if (item.label === 'Downloads') {
                        return userRole === 'admin' || userRole === 'super-admin';
                    }
                    if (item.label === 'Produce') {
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
