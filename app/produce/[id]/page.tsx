import { redirect } from 'next/navigation';
import { getProduceScanContext } from '../actions';
import type { Metadata } from 'next';
import '../produce.css';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    const result = await getProduceScanContext(id);
    const name = result.success && result.clientName ? result.clientName : 'Produce Order';
    return { title: `${name} – Produce` };
}

export default async function OrderProducePage({ params }: Props) {
    const { id } = await params;
    const result = await getProduceScanContext(id);

    if (result.success && result.deliveryPathSegment) {
        redirect(`/delivery/${encodeURIComponent(result.deliveryPathSegment)}`);
    }

    return (
        <main className="produce-page">
            <div className="produce-container text-center">
                <div className="error-icon" style={{ marginBottom: '1.5rem' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                </div>
                <h1 className="text-title">Could not open produce link</h1>
                <p className="text-subtitle" style={{ marginBottom: '2rem', color: '#f87171' }}>
                    {result.error ||
                        "Use the QR on this week's label (order link), a Produce order number, or a legacy client id."}
                </p>
                <a href="/produce" className="btn-secondary" style={{ display: 'block', width: '100%', padding: '1rem', textDecoration: 'none' }}>
                    Try again
                </a>
            </div>
        </main>
    );
}
