import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { LayoutShell } from '@/components/LayoutShell';
import { TimeProvider } from '@/lib/time-context';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Client Food Service Admin',
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
  const session = await getSession();
  const userName = session?.name || 'Admin';
  const userRole = session?.role || 'admin';
  const userId = session?.userId || '';

  const cookieStore = await cookies();
  const fakeTimeCookie = cookieStore.get('x-fake-time');
  const initialFakeTime = fakeTimeCookie?.value || null;

  return (
    <html lang="en">
      <body className={inter.className}>
        <TimeProvider initialFakeTime={initialFakeTime}>
          <LayoutShell userName={userName} userRole={userRole} userId={userId}>
            {children}
          </LayoutShell>
        </TimeProvider>
      </body>
    </html>
  );
}
