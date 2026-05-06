"use client";

import { useEffect, useState, useRef, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import { Great_Vibes } from 'next/font/google';
import { getSubmissionByToken, updateSubmissionData, updateSubmissionStatus, finalizeSubmission } from '@/lib/form-actions';
import { FormSchema } from '@/lib/form-types';
import { CheckCircle, XCircle, Loader2, Edit, MessageSquare, User, Download, PenLine, Type } from 'lucide-react';
import SignatureCanvas from 'react-signature-canvas';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';

const signatureHandFont = Great_Vibes({
    weight: '400',
    subsets: ['latin'],
    display: 'swap',
});

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
    /** Editable copy of submission answers (nutritionist can correct before accept/reject). */
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [signatureMode, setSignatureMode] = useState<'draw' | 'type'>('draw');
    const [typedSignature, setTypedSignature] = useState('');

    const signatureRef = useRef<SignatureCanvas>(null);

    const fieldStyle: CSSProperties = {
        width: '100%',
        padding: '12px',
        borderRadius: '6px',
        border: '1px solid var(--border-color)',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        fontFamily: 'inherit',
        fontSize: '14px',
        boxSizing: 'border-box',
    };

    useEffect(() => {
        loadSubmission();
    }, [token]);

    useEffect(() => {
        if (!submission?.data || typeof submission.data !== 'object') return;
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(submission.data as Record<string, unknown>)) {
            if (v != null && v !== '') next[k] = String(v);
        }
        setAnswers(next);
    }, [submission?.id]);

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

    function handleAnswerChange(questionId: string, value: string) {
        setAnswers((prev) => {
            const next = { ...prev, [questionId]: value };
            const conditionalKey = `${questionId}_conditional`;
            if (prev[questionId] !== value) {
                delete next[conditionalKey];
            }
            return next;
        });
    }

    function handleConditionalTextChange(questionId: string, value: string) {
        setAnswers((prev) => ({
            ...prev,
            [`${questionId}_conditional`]: value,
        }));
    }

    async function persistAnswersIfPending(): Promise<boolean> {
        if (submission?.status !== 'pending') return true;
        const saveResult = await updateSubmissionData(token, answers);
        if (!saveResult.success) {
            setError(saveResult.error || 'Failed to save form edits');
            return false;
        }
        setSubmission({ ...submission, data: answers });
        return true;
    }

    async function handleReject() {
        if (!comments.trim()) {
            alert('Please provide a reason for rejection');
            return;
        }

        setProcessing(true);
        try {
            if (!(await persistAnswersIfPending())) return;

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

    async function typedSignatureToDataURL(text: string): Promise<string> {
        const fontFamily = signatureHandFont.style.fontFamily;
        await document.fonts.ready;
        try {
            await document.fonts.load(`400 72px ${fontFamily}`);
        } catch {
            /* ignore */
        }

        const w = 700;
        const h = 200;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create signature image');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#111111';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const maxWidth = w - 48;
        let fontSize = 72;
        while (fontSize >= 22) {
            ctx.font = `400 ${fontSize}px ${fontFamily}`;
            if (ctx.measureText(text).width <= maxWidth) break;
            fontSize -= 2;
        }
        ctx.font = `400 ${fontSize}px ${fontFamily}`;
        ctx.fillText(text, w / 2, h / 2);

        return canvas.toDataURL('image/png');
    }

    async function getSignaturePngDataUrl(): Promise<string | null> {
        if (signatureMode === 'type') {
            const t = typedSignature.trim();
            if (!t) return null;
            return typedSignatureToDataURL(t);
        }
        if (!signatureRef.current || signatureRef.current.isEmpty()) return null;
        return signatureRef.current.toDataURL();
    }

    function handleAccept() {
        setTypedSignature('');
        setSignatureMode('draw');
        setShowSignature(true);
    }

    useEffect(() => {
        if (!showSignature) return;
        const id = requestAnimationFrame(() => {
            signatureRef.current?.clear();
        });
        return () => cancelAnimationFrame(id);
    }, [showSignature]);

    async function handleSignAndComplete() {
        const signatureDataUrl = await getSignaturePngDataUrl();
        if (!signatureDataUrl) {
            alert(
                signatureMode === 'type'
                    ? 'Please type your name to sign'
                    : 'Please draw your signature in the box'
            );
            return;
        }

        setProcessing(true);
        try {
            if (!(await persistAnswersIfPending())) return;

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

            const pdfKey =
                'pdfUrl' in uploadResult && uploadResult.pdfUrl ? uploadResult.pdfUrl : submission.pdf_url;

            setCompleted(true);
            setSubmission({ ...submission, status: 'accepted', comments, pdf_url: pdfKey });
        } catch (err: any) {
            setError(err.message);
        } finally {
            setProcessing(false);
        }
    }

    async function generateSignedPDF(signatureDataUrl: string): Promise<Blob> {
        const doc = new jsPDF();

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

    function openSignedPdfDownload() {
        const key = submission?.pdf_url as string | undefined;
        if (!key?.trim()) return;
        const r2Domain = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://storage.thedietfantasy.com';
        const url = r2Domain.startsWith('http')
            ? `${r2Domain.replace(/\/$/, '')}/${key.replace(/^\//, '')}`
            : `https://${r2Domain.replace(/\/$/, '')}/${key.replace(/^\//, '')}`;
        window.open(url, '_blank', 'noopener,noreferrer');
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
                        {submission.pdf_url && (
                            <button
                                type="button"
                                onClick={openSignedPdfDownload}
                                className="btn btn-primary"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginTop: '8px',
                                }}
                            >
                                <Download size={18} />
                                Download signed PDF
                            </button>
                        )}
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
                    <p style={{ color: 'var(--text-secondary)' }}>Review and edit the screening form below if needed, then accept or reject.</p>
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

                {/* Questions and Answers (editable while pending) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginBottom: '30px' }}>
                    {formSchema?.questions.map((q, index) => (
                        <div key={q.id} style={{ background: 'var(--bg-secondary)', padding: '20px', borderRadius: '8px' }}>
                            <label style={{ fontWeight: 'bold', marginBottom: '12px', display: 'block' }}>
                                {index + 1}. {q.text}
                            </label>
                            <div style={{ paddingLeft: '4px' }}>
                                {q.type === 'text' ? (
                                    <input
                                        type="text"
                                        value={answers[q.id] ?? ''}
                                        onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                        style={fieldStyle}
                                        placeholder="Answer"
                                    />
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            {q.options?.map((opt, i) => (
                                                <label
                                                    key={i}
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'flex-start',
                                                        gap: '10px',
                                                        cursor: 'pointer',
                                                        color: 'var(--text-secondary)',
                                                        fontSize: '14px',
                                                    }}
                                                >
                                                    <input
                                                        type="radio"
                                                        name={q.id}
                                                        value={opt}
                                                        checked={answers[q.id] === opt}
                                                        onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                                        style={{ marginTop: '3px' }}
                                                    />
                                                    <span>{opt}</span>
                                                </label>
                                            ))}
                                        </div>
                                        {answers[q.id] && q.conditionalTextInputs?.[answers[q.id]] && (
                                            <div style={{ marginTop: '14px' }}>
                                                <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                                                    Additional details
                                                </div>
                                                <input
                                                    type="text"
                                                    value={answers[`${q.id}_conditional`] ?? ''}
                                                    onChange={(e) => handleConditionalTextChange(q.id, e.target.value)}
                                                    style={fieldStyle}
                                                    placeholder="Please provide details..."
                                                />
                                            </div>
                                        )}
                                    </>
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
                        <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px' }}>
                            <Edit size={20} style={{ display: 'inline', marginRight: '8px' }} />
                            Sign to Accept
                        </h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: '16px', marginTop: 0 }}>
                            Draw with your trackpad or mouse, or type your name using script styling.
                        </p>
                        <div
                            role="tablist"
                            aria-label="Signature method"
                            style={{
                                display: 'flex',
                                gap: '8px',
                                marginBottom: '16px',
                                flexWrap: 'wrap',
                            }}
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={signatureMode === 'draw'}
                                onClick={() => setSignatureMode('draw')}
                                className="btn btn-secondary"
                                style={{
                                    flex: '1',
                                    minWidth: '140px',
                                    opacity: signatureMode === 'draw' ? 1 : 0.75,
                                    border:
                                        signatureMode === 'draw'
                                            ? '2px solid var(--accent-primary, #3b82f6)'
                                            : undefined,
                                }}
                            >
                                <PenLine size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                                Draw
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={signatureMode === 'type'}
                                onClick={() => setSignatureMode('type')}
                                className="btn btn-secondary"
                                style={{
                                    flex: '1',
                                    minWidth: '140px',
                                    opacity: signatureMode === 'type' ? 1 : 0.75,
                                    border:
                                        signatureMode === 'type'
                                            ? '2px solid var(--accent-primary, #3b82f6)'
                                            : undefined,
                                }}
                            >
                                <Type size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                                Type name
                            </button>
                        </div>

                        {signatureMode === 'draw' ? (
                            <>
                                <div style={{ border: '2px solid var(--border-color)', borderRadius: '8px', background: 'white' }}>
                                    <SignatureCanvas
                                        ref={signatureRef}
                                        canvasProps={{
                                            width: 700,
                                            height: 200,
                                            style: { width: '100%', height: '200px', touchAction: 'none' },
                                        }}
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => signatureRef.current?.clear()}
                                    className="btn btn-secondary"
                                    style={{ marginTop: '10px' }}
                                >
                                    Clear drawing
                                </button>
                            </>
                        ) : (
                            <>
                                <label
                                    htmlFor="typed-signature"
                                    style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}
                                >
                                    Type your name
                                </label>
                                <input
                                    id="typed-signature"
                                    type="text"
                                    autoComplete="name"
                                    value={typedSignature}
                                    onChange={(e) => setTypedSignature(e.target.value)}
                                    placeholder="Your full name"
                                    style={{ ...fieldStyle, marginBottom: '12px' }}
                                />
                                <div
                                    style={{
                                        border: '2px solid var(--border-color)',
                                        borderRadius: '8px',
                                        background: 'white',
                                        minHeight: '200px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: '16px',
                                        lineHeight: 1.2,
                                        textAlign: 'center',
                                        wordBreak: 'break-word',
                                    }}
                                >
                                    {typedSignature.trim() ? (
                                        <span
                                            className={signatureHandFont.className}
                                            style={{
                                                fontSize: 'clamp(1.75rem, 5vw, 3rem)',
                                                color: '#111',
                                            }}
                                        >
                                            {typedSignature.trim()}
                                        </span>
                                    ) : (
                                        <span style={{ fontSize: '14px', color: '#94a3b8', fontFamily: 'system-ui, sans-serif' }}>
                                            Preview appears here
                                        </span>
                                    )}
                                </div>
                            </>
                        )}
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
