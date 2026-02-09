import { ClientList } from '@/components/clients/ClientList';
import { getSession } from '@/lib/session';

export default async function ClientsPage() {
    let currentUser: { role: string; id: string } | null = null;
    try {
        const session = await getSession();
        currentUser = session ? { role: session.role, id: session.userId } : null;
    } catch (e) {
        console.error('[ClientsPage] getSession failed:', e);
    }
    return <ClientList currentUser={currentUser} />;
}
