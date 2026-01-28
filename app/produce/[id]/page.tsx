import { OrderProduceFlow } from './OrderProduceFlow';
import { notFound } from 'next/navigation';
import { createProduceOrder } from '../actions';
import '../produce.css';
import '../produce.css';

export default async function OrderProducePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    // Verify if it is a UUID (client_id)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

    if (!isUuid) {
        // Client ID must be a UUID
        return (
            <main className="produce-page">
                <div className="produce-container text-center">
                    <div className="error-icon" style={{ marginBottom: '1.5rem' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    </div>
                    <h1 className="text-title">Invalid Client ID</h1>
                    <p className="text-subtitle" style={{ marginBottom: '2rem' }}>
                        Client ID must be a valid UUID format. Please check and try again.
                    </p>
                    <a href="/produce" className="btn-secondary" style={{ display: 'block', width: '100%', padding: '1rem', textDecoration: 'none' }}>
                        Try Another Client ID
                    </a>
                </div>
            </main>
        );
    }

    // Always create a new Produce order for this client
    // This creates a fresh order each time the page is visited
    const result = await createProduceOrder(id);

    if (!result.success || !result.order) {
        return (
            <main className="produce-page">
                <div className="produce-container text-center">
                    <div className="error-icon" style={{ marginBottom: '1.5rem' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                    </div>
                    <h1 className="text-title">Failed to Create Order</h1>
                    <p className="text-subtitle" style={{ marginBottom: '2rem', color: '#f87171' }}>
                        {result.error || 'An error occurred while creating the produce order. Please try again.'}
                    </p>
                    <a href="/produce" className="btn-secondary" style={{ display: 'block', width: '100%', padding: '1rem', textDecoration: 'none' }}>
                        Try Another Client ID
                    </a>
                </div>
            </main>
        );
    }

    const orderDetails = result.order;

    return (
        <main className="produce-page">
            <h1 className="text-subtitle" style={{ marginBottom: '1.5rem', opacity: 0.7 }}>Produce Order Processing App</h1>
            <div className="produce-container">
                <OrderProduceFlow order={orderDetails} />
            </div>
        </main>
    );
}
