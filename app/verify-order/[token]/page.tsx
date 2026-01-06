"use client";

import { useEffect, useState, useRef } from 'react';
import { useParams } from 'next/navigation';
import { getSubmissionByToken, updateSubmissionStatus, finalizeSubmission } from '@/lib/form-actions';
import { FormSchema } from '@/lib/form-types';
import { CheckCircle, XCircle, Loader2, Edit, MessageSquare, User } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';

export default function VerifyOrderPage() {
    const params = useParams();
    const token = params.token as string;

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submission, setSubmission] = useState<any>(null);
    const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
    const [client, setClient] = useState<any>(null);
    const [showSignature, setShowSignature] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [completed, setCompleted] = useState(false);
    const [comments, setComments] = useState('');

    const signatureRef = useRef<SignatureCanvas>(null);

    useEffect(() => {
        loadSubmission();
    }, [token]);

    async function loadSubmission() {
        try {
            const result = await getSubmissionByToken(token);
            if (result.success && result.data) {
                setSubmission(result.data.submission);
                setFormSchema(result.data.formSchema);
                setClient(result.data.client || null);

                // If already processed, show completion
                if (result.data.submission.status !== 'pending') {
                    setCompleted(true);
                    setComments(result.data.submission.comments || '');
                }
            } else {
                setError('Submission not found');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load submission');
        } finally {
            setLoading(false);
        }
    }

    async function handleReject() {
        if (!comments.trim()) {
            alert('Please provide a reason for rejection');
            return;
        }

        setProcessing(true);
        try {
            const result = await updateSubmissionStatus(token, 'rejected', undefined, comments);
            if (result.success) {
                setCompleted(true);
                setSubmission({ ...submission, status: 'rejected', comments });
            } else {
                throw new Error(result.error || 'Failed to reject');
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setProcessing(false);
        }
    }

    async function handleAccept() {
        setShowSignature(true);
    }

    async function handleSignAndComplete() {
        if (!signatureRef.current || signatureRef.current.isEmpty()) {
            alert('Please provide a signature');
            return;
        }

        setProcessing(true);
        try {
            // Get signature as data URL
            const signatureDataUrl = signatureRef.current.toDataURL();

            // Update status with signature and comments
            const statusResult = await updateSubmissionStatus(token, 'accepted', signatureDataUrl, comments);
            if (!statusResult.success) {
                throw new Error(statusResult.error || 'Failed to update status');
            }

            // Generate PDF with signature and comments
            const pdfBlob = await generateSignedPDF(signatureDataUrl);

            // Upload PDF
            const uploadResult = await finalizeSubmission(token, pdfBlob);
            if (!uploadResult.success) {
                throw new Error(uploadResult.error || 'Failed to upload PDF');
            }

            setCompleted(true);
            setSubmission({ ...submission, status: 'accepted', comments });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setProcessing(false);
        }
    }

    async function generateSignedPDF(signatureDataUrl: string): Promise<Blob> {
        const doc = new jsPDF();
        const answers = submission.data;

        let yPos = 10;
        const margin = 20;

        // Client name at the very top
        if (client?.fullName) {
            doc.setFontSize(18);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");
            doc.text(client.fullName, margin, yPos);
            yPos += 20;
        }

        const pageHeight = doc.internal.pageSize.height;

        formSchema!.questions.forEach((q, index) => {
            if (yPos > pageHeight - 60) {
                doc.addPage();
                yPos = 20;
            }

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");

            const questionText = `${index + 1}. ${q.text}`;
            const splitQuestion = doc.splitTextToSize(questionText, 170);
            doc.text(splitQuestion, margin, yPos);
            yPos += (splitQuestion.length * 7);

            doc.setFont("helvetica", "normal");
            doc.setTextColor(50);

            let answer = answers[q.id] || '(No answer provided)';
            // Add conditional text if it exists
            if (q.type === 'select' && q.conditionalTextInputs?.[answers[q.id]] && answers[`${q.id}_conditional`]) {
                answer += `\n\nAdditional details: ${answers[`${q.id}_conditional`]}`;
            }
            const splitAnswer = doc.splitTextToSize(answer, 160);

            doc.text(splitAnswer, margin + 5, yPos);
            yPos += (splitAnswer.length * 7) + 10;
        });

        // Add comments if provided
        if (comments.trim()) {
            if (yPos > pageHeight - 60) {
                doc.addPage();
                yPos = 20;
            }

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.setFont("helvetica", "bold");
            doc.text("Comments:", margin, yPos);
            yPos += 10;

            doc.setFont("helvetica", "normal");
            doc.setTextColor(50);
            const splitComments = doc.splitTextToSize(comments, 160);
            doc.text(splitComments, margin + 5, yPos);
            yPos += (splitComments.length * 7) + 15;
        }

        // Add signature
        if (yPos > pageHeight - 80) {
            doc.addPage();
            yPos = 20;
        }

        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold");
        doc.text("Signature:", margin, yPos);
        yPos += 10;

        // Add signature image
        doc.addImage(signatureDataUrl, 'PNG', margin, yPos, 80, 30);

        // Add date of signature underneath the signature
        const signatureDate = new Date().toLocaleDateString();
        yPos += 35; // Move down below the signature image
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.setFont("helvetica", "normal");
        doc.text(`Date: ${signatureDate}`, margin, yPos);

        // Generate the main PDF blob
        const mainPdfBlob = doc.output('blob');

        // Merge with bottom.pdf
        const mergedPdfBlob = await mergeWithBottomPdf(mainPdfBlob);

        return mergedPdfBlob;
    }

    async function mergeWithBottomPdf(mainPdfBlob: Blob): Promise<Blob> {
        try {
            // Load the main PDF
            const mainPdfBytes = await mainPdfBlob.arrayBuffer();
            const mainPdfDoc = await PDFDocument.load(mainPdfBytes);

            // Fetch and load bottom.pdf from public folder
            const bottomPdfResponse = await fetch('/bottom.pdf');
            if (!bottomPdfResponse.ok) {
                console.warn('Could not load bottom.pdf, returning main PDF only');
                return mainPdfBlob;
            }
            const bottomPdfBytes = await bottomPdfResponse.arrayBuffer();
            const bottomPdfDoc = await PDFDocument.load(bottomPdfBytes);

            // Copy all pages from bottom.pdf to main PDF
            const bottomPages = await mainPdfDoc.copyPages(bottomPdfDoc, bottomPdfDoc.getPageIndices());
            bottomPages.forEach((page) => {
                mainPdfDoc.addPage(page);
            });

            // Save and return the merged PDF
            const mergedPdfBytes = await mainPdfDoc.save();
            return new Blob([mergedPdfBytes as any], { type: 'application/pdf' });
        } catch (error) {
            console.error('Error merging PDFs:', error);
            // If merging fails, return the main PDF
            return mainPdfBlob;
        }
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--bg-primary)' }}>
                <Loader2 size={48} className="animate-spin" />
            </div>
        );
    }

    if (error) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', flexDirection: 'column', gap: '20px', background: 'var(--bg-primary)' }}>
                <XCircle size={64} color="#ef4444" />
                <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Error</h1>
                <p>{error}</p>
            </div>
        );
    }

    if (completed) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', flexDirection: 'column', gap: '20px', padding: '20px', background: 'var(--bg-primary)' }}>
                {submission.status === 'accepted' ? (
                    <>
                        <CheckCircle size={64} color="#10b981" />
                        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Screening Form Accepted!</h1>
                        {client && (
                            <p style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', marginTop: '8px' }}>
                                Client: {client.fullName}
                            </p>
                        )}
                        <p>The screening form has been signed and submitted successfully.</p>
                        {client && (
                            <div style={{ marginTop: '20px', padding: '20px', background: 'var(--bg-secondary)', borderRadius: '8px', maxWidth: '600px', width: '100%' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                    <User size={18} style={{ color: 'var(--text-primary)' }} />
                                    <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>Client Information</h2>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                                    <div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Full Name</div>
                                        <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.fullName}</div>
                                    </div>
                                    {client.email && (
                                        <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Email</div>
                                            <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.email}</div>
                                        </div>
                                    )}
                                    {client.phoneNumber && (
                                        <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Phone</div>
                                            <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.phoneNumber}</div>
                                        </div>
                                    )}
                                    {client.secondaryPhoneNumber && (
                                        <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Secondary Phone</div>
                                            <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.secondaryPhoneNumber}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {comments && (
                            <div style={{ marginTop: '20px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px', maxWidth: '600px', width: '100%' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <MessageSquare size={16} />
                                    Comments:
                                </div>
                                <div style={{ color: 'var(--text-secondary)' }}>{comments}</div>
                            </div>
                        )}
                    </>
                ) : (
                    <>
                        <XCircle size={64} color="#ef4444" />
                        <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>Screening Form Rejected</h1>
                        {client && (
                            <p style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', marginTop: '8px' }}>
                                Client: {client.fullName}
                            </p>
                        )}
                        <p>This screening form has been rejected.</p>
                        {client && (
                            <div style={{ marginTop: '20px', padding: '20px', background: 'var(--bg-secondary)', borderRadius: '8px', maxWidth: '600px', width: '100%' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                    <User size={18} style={{ color: 'var(--text-primary)' }} />
                                    <h2 style={{ fontSize: '16px', fontWeight: 'bold', margin: 0 }}>Client Information</h2>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                                    <div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Full Name</div>
                                        <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.fullName}</div>
                                    </div>
                                    {client.email && (
                                        <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Email</div>
                                            <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.email}</div>
                                        </div>
                                    )}
                                    {client.phoneNumber && (
                                        <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Phone</div>
                                            <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.phoneNumber}</div>
                                        </div>
                                    )}
                                    {client.secondaryPhoneNumber && (
                                        <div>
                                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>Secondary Phone</div>
                                            <div style={{ fontSize: '14px', fontWeight: '500' }}>{client.secondaryPhoneNumber}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        {comments && (
                            <div style={{ marginTop: '20px', padding: '16px', background: 'var(--bg-secondary)', borderRadius: '8px', maxWidth: '600px', width: '100%' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <MessageSquare size={16} />
                                    Reason:
                                </div>
                                <div style={{ color: 'var(--text-secondary)' }}>{comments}</div>
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '40px 20px' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                <div style={{ background: 'var(--bg-secondary)', padding: '30px', borderRadius: '12px', marginBottom: '30px' }}>
                    <h1 style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '10px' }}>{formSchema?.title}</h1>
                    {client && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            <User size={18} style={{ color: 'var(--text-primary)' }} />
                            <p style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', margin: 0 }}>
                                Client: {client.fullName}
                            </p>
                        </div>
                    )}
                    <p style={{ color: 'var(--text-secondary)' }}>Review the screening form details below</p>
                </div>

                {/* Client Information */}
                {client && (
                    <div style={{ background: 'var(--bg-secondary)', padding: '24px', borderRadius: '12px', marginBottom: '30px', border: '1px solid var(--border-color)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <User size={20} style={{ color: 'var(--text-primary)' }} />
                            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Client Information</h2>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                            <div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Full Name</div>
                                <div style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>{client.fullName}</div>
                            </div>
                            {client.email && (
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Email</div>
                                    <div style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>{client.email}</div>
                                </div>
                            )}
                            {client.phoneNumber && (
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone</div>
                                    <div style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>{client.phoneNumber}</div>
                                </div>
                            )}
                            {client.secondaryPhoneNumber && (
                                <div>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Secondary Phone</div>
                                    <div style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>{client.secondaryPhoneNumber}</div>
                                </div>
                            )}
                            {client.address && (
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Address</div>
                                    <div style={{ fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }}>{client.address}</div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Questions and Answers */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '30px' }}>
                    {formSchema?.questions.map((q, index) => (
                        <div key={q.id} style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: '8px' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>
                                {index + 1}. {q.text}
                            </div>
                            <div style={{ color: 'var(--text-secondary)', paddingLeft: '20px' }}>
                                {submission.data[q.id] || '(No answer)'}
                                {q.type === 'select' && q.conditionalTextInputs?.[submission.data[q.id]] && submission.data[`${q.id}_conditional`] && (
                                    <div style={{ marginTop: '0.5rem', paddingLeft: '1rem', borderLeft: '2px solid var(--border-color)' }}>
                                        <div style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>
                                            Additional details:
                                        </div>
                                        <div style={{ fontSize: '0.875rem' }}>
                                            {submission.data[`${q.id}_conditional`]}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Comments Section */}
                <div style={{ background: 'var(--bg-secondary)', padding: '30px', borderRadius: '12px', marginBottom: '30px' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <MessageSquare size={18} />
                        Comments {!showSignature && <span style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: 'normal' }}>(optional for acceptance, required for rejection)</span>}
                    </h2>
                    <textarea
                        value={comments}
                        onChange={(e) => setComments(e.target.value)}
                        placeholder="Add any comments or notes..."
                        style={{
                            width: '100%',
                            minHeight: '100px',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-primary)',
                            color: 'var(--text-primary)',
                            fontFamily: 'inherit',
                            fontSize: '14px',
                            resize: 'vertical'
                        }}
                    />
                </div>

                {/* Signature Section */}
                {showSignature && (
                    <div style={{ background: 'var(--bg-secondary)', padding: '30px', borderRadius: '12px', marginBottom: '30px' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '20px' }}>
                            <Edit size={20} style={{ display: 'inline', marginRight: '8px' }} />
                            Sign to Accept
                        </h2>
                        <div style={{ border: '2px solid var(--border-color)', borderRadius: '8px', background: 'white' }}>
                            <SignatureCanvas
                                ref={signatureRef}
                                canvasProps={{
                                    width: 700,
                                    height: 200,
                                    style: { width: '100%', height: '200px' }
                                }}
                            />
                        </div>
                        <button
                            onClick={() => signatureRef.current?.clear()}
                            className="btn btn-secondary"
                            style={{ marginTop: '10px' }}
                        >
                            Clear
                        </button>
                    </div>
                )}

                {/* Action Buttons */}
                {!showSignature ? (
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button
                            onClick={handleReject}
                            disabled={processing}
                            className="btn btn-secondary"
                            style={{ background: '#ef4444' }}
                        >
                            {processing ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
                            Reject
                        </button>
                        <button
                            onClick={handleAccept}
                            disabled={processing}
                            className="btn btn-primary"
                        >
                            <CheckCircle size={16} />
                            Accept & Sign
                        </button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button
                            onClick={() => setShowSignature(false)}
                            disabled={processing}
                            className="btn btn-secondary"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSignAndComplete}
                            disabled={processing}
                            className="btn btn-primary"
                        >
                            {processing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                            Sign & Complete
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
