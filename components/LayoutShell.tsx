'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';

import { usePathname } from 'next/navigation';
import { DataCacheProvider } from '@/lib/data-cache';

export function LayoutShell({ children, userName, userRole, userId }: { children: React.ReactNode, userName?: string, userRole?: string, userId?: string }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const pathname = usePathname();

    if (pathname === '/login') {
        return <>{children}</>;
    }

    // Width constants
    const SIDEBAR_WIDTH = 260;
    const SIDEBAR_COLLAPSED_WIDTH = 80;
    const currentSidebarWidth = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

    // Hide sidebar only for vendor portal (singular /vendor), not admin vendor management (plural /vendors)
    // Hide sidebar only for vendor portal (singular /vendor), client portal, and verify-order routes
    const isVendorPortal = pathname === '/vendor' || pathname.startsWith('/vendor/');
    const isClientPortal = pathname.startsWith('/client-portal');
    const isVerifyOrder = pathname.startsWith('/verify-order');
    const isDelivery = pathname.startsWith('/delivery');
    const showSidebar = !isVendorPortal && !isClientPortal && !isVerifyOrder && !isDelivery;

    return (
        <DataCacheProvider>
            <div style={{ display: 'flex', minHeight: '100vh' }}>
                {showSidebar && (
                    <Sidebar
                        isCollapsed={isCollapsed}
                        toggle={() => setIsCollapsed(!isCollapsed)}
                        userName={userName}
                        userRole={userRole}
                        userId={userId}
                    />
                )}

                <main style={{
                    flex: 1,
                    marginLeft: `${showSidebar ? currentSidebarWidth : 0}px`,
                    padding: '2rem 20px 0 20px',
                    backgroundColor: 'var(--bg-app)',
                    transition: 'margin-left 0.3s ease',
                    // Fix horizontal scroll: ensure main container clips overflow
                    // but allows vertical scroll.
                    // However, we want the PAGE to scroll vertically, so we just need
                    // to prevent horizontal overflow spilling out of this container.
                    overflowX: 'hidden',
                    minWidth: 0, // Critical for flex children to shrink below content size
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    {children}
                </main>
            </div>
        </DataCacheProvider>
    );
}
