/**
 * Orders layout: protect route and redirect by role.
 * Replace verifySession with your app's auth (e.g. getServerSession, auth(), etc.).
 */
import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
    const session = await verifySession();

    if (session?.role === 'client') {
        redirect(`/client-portal/${session.userId}`);
    }
    if (session?.role === 'vendor') {
        redirect('/vendor');
    }

    return <>{children}</>;
}
