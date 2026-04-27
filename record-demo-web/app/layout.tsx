import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Suspense } from 'react';
import '@/app/globals.css';
import { DemoLayoutShell } from '../components/DemoLayoutShell';
import { MuiThemeProvider } from '@/components/MuiThemeProvider';
import { TimeProvider } from '@/lib/time-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'Operations console',
    template: '%s | Operations console',
  },
  description: 'Console preview with local sample data.',
};

export const dynamic = 'force-dynamic';

function PageFallback() {
  return (
    <div
      style={{
        padding: '2rem',
        color: '#334155',
        fontSize: '1rem',
        backgroundColor: '#f8fafc',
        minHeight: '200px',
      }}
    >
      Loading...
    </div>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userName = 'Demo Admin';
  let userRole = 'admin';
  let userId = 'demo-admin';
  let initialFakeTime: string | null = null;

  try {
    const session = await getSession();
    userName = session?.name || userName;
    userRole = session?.role || userRole;
    userId = session?.userId || userId;
    const cookieStore = await cookies();
    const fakeTimeCookie = cookieStore.get('x-fake-time');
    initialFakeTime = fakeTimeCookie?.value || null;
  } catch {
    /* ignore */
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <ErrorBoundary>
          <MuiThemeProvider>
            <TimeProvider initialFakeTime={initialFakeTime}>
              <DemoLayoutShell userName={userName} userRole={userRole} userId={userId}>
                <Suspense fallback={<PageFallback />}>{children}</Suspense>
              </DemoLayoutShell>
            </TimeProvider>
          </MuiThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
