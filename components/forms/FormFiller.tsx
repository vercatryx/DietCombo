"use client";

import { useState, useEffect } from 'react';
import { FormSchema } from '@/lib/form-types';
import { createSubmission, sendSubmissionToNutritionist } from '@/lib/form-actions';
import { getNutritionists } from '@/lib/actions';
import { Nutritionist } from '@/lib/types';
import { AlertCircle, ArrowLeft, Mail, Check } from 'lucide-react';
import styles from './FormFiller.module.css';

interface FormFillerProps {
    schema: FormSchema;
    onBack: () => void;
    clientId?: string;
}

export default function FormFiller({ schema, onBack, clientId }: FormFillerProps) {
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [emailSent, setEmailSent] = useState(false);
    const [nutritionists, setNutritionists] = useState<Nutritionist[]>([]);
    const [selectedNutritionistId, setSelectedNutritionistId] = useState<string>('');
    const [loadingNutritionists, setLoadingNutritionists] = useState(true);

    useEffect(() => {
        loadNutritionists();
    }, []);

    async function loadNutritionists() {
        try {
            const data = await getNutritionists();
            setNutritionists(data);
        } catch (err) {
            console.error('Failed to load nutritionists:', err);
        } finally {
            setLoadingNutritionists(false);
        }
    }

    const handleAnswerChange = (questionId: string, value: string) => {
        setAnswers(prev => {
            const newAnswers = { ...prev, [questionId]: value };
            // Clear conditional text if option changed
            const conditionalKey = `${questionId}_conditional`;
            if (prev[questionId] !== value) {
                delete newAnswers[conditionalKey];
            }
            return newAnswers;
        });
    };

    const handleConditionalTextChange = (questionId: string, value: string) => {
        setAnswers(prev => ({
            ...prev,
            [`${questionId}_conditional`]: value
        }));
    };

    const handleSendToNutritionist = async () => {
        if (!selectedNutritionistId) {
            setError('Please select a nutritionist');
            return;
        }

        setIsSending(true);
        setError(null);
        try {
            // Create submission first
            const result = await createSubmission(answers, clientId);

            if (!result.success) {
                throw new Error(result.error || 'Failed to create submission');
            }

            // Send email to nutritionist with token for approval link
            const emailResult = await sendSubmissionToNutritionist(
                selectedNutritionistId,
                answers,
                clientId,
                result.token
            );

            if (emailResult.success) {
                setEmailSent(true);
            } else {
                throw new Error(emailResult.error || 'Failed to send email');
            }

        } catch (err: any) {
            console.error("Send Error:", err);
            setError(err.message || 'Failed to send submission');
        } finally {
            setIsSending(false);
        }
    };

    // Calculate progress
    const totalQuestions = schema.questions.length;
    let answeredCount = 0;
    schema.questions.forEach(q => {
        if (answers[q.id]) {
            answeredCount++;
            // Check if conditional text is required and filled
            if (q.type === 'select' && q.conditionalTextInputs?.[answers[q.id]]) {
                if (answers[`${q.id}_conditional`]) {
                    // Both option and conditional text are answered
                } else {
                    // Option selected but conditional text not filled - don't count as complete
                    answeredCount--;
                }
            }
        }
    });
    const progress = totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0;

    // If email sent, show success state
    if (emailSent) {
        const selectedNutritionist = nutritionists.find(n => n.id === selectedNutritionistId);
        return (
            <div className={styles.container}>
                <div className={styles.headerCard} style={{ textAlign: 'center', padding: '40px' }}>
                    <Check size={64} color="#10b981" style={{ margin: '0 auto 20px' }} />
                    <h1 className={styles.title}>Submission Sent!</h1>
                    <p className={styles.description}>
                        The form has been sent to {selectedNutritionist?.name || 'the nutritionist'}.
                    </p>
                    {selectedNutritionist?.email && (
                        <p style={{ color: 'var(--text-secondary)', marginTop: '10px' }}>
                            Sent to: {selectedNutritionist.email}
                        </p>
                    )}

                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '30px' }}>
                        <button
                            onClick={onBack}
                            className="btn btn-primary"
                        >
                            <ArrowLeft size={16} />
                            Back to Profile
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Header */}
            <div>
                <button
                    onClick={onBack}
                    className={styles.backButton}
                >
                    <ArrowLeft size={16} />
                    Back
                </button>

                <div className={styles.headerCard}>
                    <h1 className={styles.title}>{schema.title}</h1>
                    <p className={styles.description}>Please complete all fields below.</p>
                </div>
            </div>

            {error && (
                <div className={styles.error}>
                    <AlertCircle size={20} color="#f87171" />
                    {error}
                </div>
            )}

            <div className={styles.formGrid}>
                {schema.questions.map((q, index) => (
                    <div key={q.id} className={styles.questionCard}>
                        <label className={styles.questionLabel}>
                            <span className={styles.questionNumber}>{index + 1}.</span>
                            {q.text}
                        </label>

                        {q.type === 'text' ? (
                            <input
                                type="text"
                                value={answers[q.id] || ''}
                                onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                className={styles.textInput}
                                placeholder="Your answer"
                            />
                        ) : (
                            <>
                                <div className={styles.radioGroup}>
                                    {q.options?.map((opt, i) => (
                                        <label key={i} className={styles.radioLabel}>
                                            <div className={styles.radioInputWrapper}>
                                                <input
                                                    type="radio"
                                                    name={q.id}
                                                    value={opt}
                                                    checked={answers[q.id] === opt}
                                                    onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                                                    className={styles.radioInput}
                                                />
                                                <div className={styles.radioDot} />
                                            </div>
                                            <span className={answers[q.id] === opt ? styles.optionTextSelected : styles.optionText}>
                                                {opt}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                {q.type === 'select' && answers[q.id] && q.conditionalTextInputs?.[answers[q.id]] && (
                                    <div className={styles.conditionalTextContainer}>
                                        <input
                                            type="text"
                                            value={answers[`${q.id}_conditional`] || ''}
                                            onChange={(e) => handleConditionalTextChange(q.id, e.target.value)}
                                            className={styles.conditionalTextInput}
                                            placeholder="Please provide details..."
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>

            {/* Sticky Action Footer */}
            <div className={styles.stickyFooter}>
                <div className={styles.footerContent}>
                    <div className={styles.progressContainer}>
                        <div className={styles.progressLabels}>
                            <span>Progress</span>
                            <span>{Math.round(progress)}%</span>
                        </div>
                        <div className={styles.track}>
                            <div
                                className={styles.bar}
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <select
                            value={selectedNutritionistId}
                            onChange={(e) => setSelectedNutritionistId(e.target.value)}
                            className="input"
                            style={{ minWidth: '200px' }}
                            disabled={loadingNutritionists || isSending}
                        >
                            <option value="">Select Nutritionist...</option>
                            {nutritionists.map(nutritionist => (
                                <option key={nutritionist.id} value={nutritionist.id}>
                                    {nutritionist.name} {nutritionist.email ? `(${nutritionist.email})` : ''}
                                </option>
                            ))}
                        </select>

                        <button
                            onClick={handleSendToNutritionist}
                            disabled={isSending || !selectedNutritionistId || loadingNutritionists}
                            className={styles.submitBtn}
                        >
                            {isSending ? (
                                <div className={styles.spinner} />
                            ) : (
                                <>
                                    <span>Send</span>
                                    <Mail size={16} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
