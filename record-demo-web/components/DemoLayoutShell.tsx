'use client';

import { useState } from 'react';
import { Sidebar } from './DemoSidebar';
import { usePathname } from 'next/navigation';
import { DataCacheProvider } from '@/lib/data-cache';

/** Same behavior as production `LayoutShell`, but uses `DemoSidebar` (neutral branding). */
export function DemoLayoutShell({
  children,
  userName,
  userRole,
  userId,
}: {
  children: React.ReactNode;
  userName?: string;
  userRole?: string;
  userId?: string;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const pathname = usePathname();

  if (pathname === '/login' || pathname === '/sms-demo') {
    return <>{children}</>;
  }

  const isVendorsProduce = pathname === '/vendors/produce' || pathname.startsWith('/vendors/produce/');
  if (isVendorsProduce) {
    return <>{children}</>;
  }

  const SIDEBAR_WIDTH = 260;
  const SIDEBAR_COLLAPSED_WIDTH = 80;
  const currentSidebarWidth = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

  const isVendorPortal = pathname === '/vendor' || pathname.startsWith('/vendor/');
  const isClientPortal = pathname.startsWith('/client-portal') || pathname.startsWith('/admin/client-portal');
  const isVerifyOrder = pathname.startsWith('/verify-order');
  const isDelivery = pathname.startsWith('/delivery');
  const isDrivers = pathname.startsWith('/drivers');
  const isProduce = pathname.startsWith('/produce');
  const isRoutes = pathname === '/routes' || pathname.startsWith('/routes/');
  const showSidebar =
    !isVendorPortal && !isClientPortal && !isVerifyOrder && !isDelivery && !isDrivers && !isProduce;

  const mainPadding = isRoutes ? '0 0 0 20px' : '2rem 20px 0 20px';

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

        <main
          style={{
            flex: 1,
            marginLeft: `${showSidebar ? currentSidebarWidth : 0}px`,
            padding: mainPadding,
            backgroundColor: 'var(--bg-app)',
            transition: 'margin-left 0.3s ease',
            overflowX: 'hidden',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </main>
      </div>
    </DataCacheProvider>
  );
}
