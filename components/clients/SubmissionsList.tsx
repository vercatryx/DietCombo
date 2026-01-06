import { CheckCircle, XCircle, Clock, Download, ExternalLink, MessageSquare } from 'lucide-react';

const R2_DOMAIN = process.env.NEXT_PUBLIC_R2_DOMAIN;

interface Submission {
    id: string;
    status: 'pending' | 'accepted' | 'rejected';
    created_at: string;
    pdf_url: string | null;
    token: string;
    comments: string | null;
}

interface SubmissionsListProps {
    submissions: Submission[];
}

export default function SubmissionsList({ submissions }: SubmissionsListProps) {
    if (submissions.length === 0) {
        return (
            <div style={{
                padding: '40px',
                textAlign: 'center',
                background: 'var(--bg-secondary)',
                borderRadius: '8px',
                color: 'var(--text-secondary)'
            }}>
                No screening forms submitted yet
            </div>
        );
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'accepted': return '#10b981';
            case 'rejected': return '#ef4444';
            case 'pending': return '#f59e0b';
            default: return '#6b7280';
        }
    };

    const getStatusBgColor = (status: string) => {
        switch (status) {
            case 'accepted': return 'rgba(16, 185, 129, 0.1)';
            case 'rejected': return 'rgba(239, 68, 68, 0.1)';
            case 'pending': return 'rgba(245, 158, 11, 0.1)';
            default: return 'rgba(107, 114, 128, 0.1)';
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {submissions.map((submission) => (
                <div
                    key={submission.id}
                    style={{
                        background: 'var(--bg-secondary)',
                        padding: '16px',
                        borderRadius: '8px',
                        border: `2px solid ${getStatusColor(submission.status)}`,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', marginBottom: submission.comments ? '12px' : '0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                            {submission.status === 'accepted' && <CheckCircle size={20} color="#10b981" />}
                            {submission.status === 'rejected' && <XCircle size={20} color="#ef4444" />}
                            {submission.status === 'pending' && <Clock size={20} color="#f59e0b" />}

                            <div>
                                <div style={{ fontWeight: '500' }}>
                                    Screening Form - {new Date(submission.created_at).toLocaleDateString()}
                                </div>
                                <div style={{
                                    fontSize: '12px',
                                    marginTop: '4px',
                                    display: 'inline-block',
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    background: getStatusBgColor(submission.status),
                                    color: getStatusColor(submission.status),
                                    textTransform: 'capitalize',
                                    fontWeight: '500'
                                }}>
                                    {submission.status}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            {submission.status === 'pending' && (
                                <a
                                    href={`/verify-order/${submission.token}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-secondary"
                                    style={{ fontSize: '14px', padding: '6px 12px' }}
                                >
                                    <ExternalLink size={14} />
                                    Review
                                </a>
                            )}

                            {submission.status === 'accepted' && submission.pdf_url && (
                                <button
                                    onClick={() => {
                                        if (!R2_DOMAIN) {
                                            console.error('NEXT_PUBLIC_R2_DOMAIN is not configured');
                                            alert('R2 domain is not configured. Please contact an administrator.');
                                            return;
                                        }
                                        const url = R2_DOMAIN.startsWith('http') 
                                            ? `${R2_DOMAIN}/${submission.pdf_url}`
                                            : `https://${R2_DOMAIN}/${submission.pdf_url}`;
                                        window.open(url, '_blank');
                                    }}
                                    className="btn btn-primary"
                                    style={{ fontSize: '14px', padding: '6px 12px' }}
                                >
                                    <Download size={14} />
                                    Download PDF
                                </button>
                            )}
                        </div>
                    </div>

                    {submission.comments && (
                        <div style={{
                            marginTop: '12px',
                            padding: '12px',
                            background: 'var(--bg-primary)',
                            borderRadius: '6px',
                            borderLeft: `3px solid ${getStatusColor(submission.status)}`
                        }}>
                            <div style={{
                                fontSize: '12px',
                                fontWeight: '500',
                                marginBottom: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                color: 'var(--text-secondary)'
                            }}>
                                <MessageSquare size={14} />
                                {submission.status === 'rejected' ? 'Rejection Reason:' : 'Comments:'}
                            </div>
                            <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                                {submission.comments}
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
