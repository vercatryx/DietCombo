import { NavigatorHistory } from '@/components/navigators/NavigatorHistory';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function NavigatorHistoryPage() {
    const session = await getSession();
    
    if (!session) {
        redirect('/login');
    }

    // Only navigators can access this page
    if (session.role !== 'navigator') {
        redirect('/clients');
    }

    return <NavigatorHistory navigatorId={session.userId} />;
}












