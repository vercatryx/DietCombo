import { ClientProfileDetail } from '@/components/clients/ClientProfile';
import { getSession } from '@/lib/session';

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();

    console.log('Server Page Debug: Session:', session); // Server-side log

    return (
        <ClientProfileDetail
            clientId={id}
            currentUser={session ? { role: session.role, id: session.userId } : null}
        />
    );
}
