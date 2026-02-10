import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Suspense } from 'react';
import './globals.css';
import { LayoutShell } from '@/components/LayoutShell';
import { MuiThemeProvider } from '@/components/MuiThemeProvider';
import { TimeProvider } from '@/lib/time-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

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

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Client Food Service Admin',
    template: '%s | Client Food Service Admin',
  },
  description: 'Admin portal for managing client food services.',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userName = 'Admin';
  let userRole = 'admin';
  let userId = '';
  let initialFakeTime: string | null = null;

  try {
    const session = await getSession();
    userName = session?.name || 'Admin';
    userRole = session?.role || 'admin';
    userId = session?.userId || '';
    const cookieStore = await cookies();
    const fakeTimeCookie = cookieStore.get('x-fake-time');
    initialFakeTime = fakeTimeCookie?.value || null;
  } catch (e) {
    console.error('[RootLayout] Session/cookies failed:', e);
  }

  return (
    <html lang="en">
      <body className={inter.className}>
        <ErrorBoundary>
          <MuiThemeProvider>
            <TimeProvider initialFakeTime={initialFakeTime}>
              <LayoutShell userName={userName} userRole={userRole} userId={userId}>
                <Suspense fallback={<PageFallback />}>
                  {children}
                </Suspense>
              </LayoutShell>
            </TimeProvider>
          </MuiThemeProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
