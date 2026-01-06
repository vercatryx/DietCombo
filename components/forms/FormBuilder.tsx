"use client";

import { useState, useEffect } from 'react';
import { FormSchema, Question, QuestionType } from '@/lib/form-types';
import { v4 as uuidv4 } from 'uuid';
import { saveSingleForm, getSingleForm } from '@/lib/form-actions';
import { Plus, Trash2, Save, Type, List, X } from 'lucide-react';
import styles from './FormBuilder.module.css';

interface FormBuilderProps {
    onSave: (schema: FormSchema) => void;
}

export default function FormBuilder({ onSave }: FormBuilderProps) {
    const [questions, setQuestions] = useState<Question[]>([]);
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadForm();
    }, []);

    const loadForm = async () => {
        setIsLoading(true);
        try {
            const result = await getSingleForm();
            if (result.success && result.data) {
                setQuestions(result.data.questions);
            }
        } catch (err) {
            console.error("Failed to load form", err);
        } finally {
            setIsLoading(false);
        }
    };

    const addQuestion = () => {
        const newQuestion: Question = {
            id: uuidv4(),
            type: 'text',
            text: '',
            options: []
        };
        setQuestions([...questions, newQuestion]);
    };

    const updateQuestion = (id: string, updates: Partial<Question>) => {
        setQuestions(questions.map(q => q.id === id ? { ...q, ...updates } : q));
    };

    const removeQuestion = (id: string) => {
        setQuestions(questions.filter(q => q.id !== id));
    };

    const addOption = (questionId: string) => {
        setQuestions(questions.map(q => {
            if (q.id === questionId) {
                return { ...q, options: [...(q.options || []), ''] };
            }
            return q;
        }));
    };


    const removeOption = (questionId: string, index: number) => {
        setQuestions(questions.map(q => {
            if (q.id === questionId) {
                const newOptions = [...(q.options || [])];
                const removedOption = newOptions[index];
                newOptions.splice(index, 1);
                // Also remove from conditionalTextInputs if it exists
                const newConditionalTextInputs = { ...q.conditionalTextInputs };
                if (removedOption && newConditionalTextInputs[removedOption]) {
                    delete newConditionalTextInputs[removedOption];
                }
                return { ...q, options: newOptions, conditionalTextInputs: Object.keys(newConditionalTextInputs).length > 0 ? newConditionalTextInputs : undefined };
            }
            return q;
        }));
    };

    const toggleConditionalTextInput = (questionId: string, option: string) => {
        setQuestions(questions.map(q => {
            if (q.id === questionId) {
                const current = q.conditionalTextInputs || {};
                const newConditional = { ...current };
                if (newConditional[option]) {
                    delete newConditional[option];
                } else {
                    newConditional[option] = true;
                }
                return { ...q, conditionalTextInputs: Object.keys(newConditional).length > 0 ? newConditional : undefined };
            }
            return q;
        }));
    };

    const updateOption = (questionId: string, index: number, value: string) => {
        setQuestions(questions.map(q => {
            if (q.id === questionId) {
                const newOptions = [...(q.options || [])];
                const oldOption = newOptions[index];
                newOptions[index] = value;
                // Update conditionalTextInputs key if option text changed
                if (oldOption !== value && q.conditionalTextInputs?.[oldOption]) {
                    const newConditionalTextInputs = { ...q.conditionalTextInputs };
                    newConditionalTextInputs[value] = newConditionalTextInputs[oldOption];
                    delete newConditionalTextInputs[oldOption];
                    return { ...q, options: newOptions, conditionalTextInputs: newConditionalTextInputs };
                }
                return { ...q, options: newOptions };
            }
            return q;
        }));
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            // Always delete old forms when creating a new one (only one screening form at a time)
            const result = await saveSingleForm(questions, true);

            if (result.success) {
                const schema: FormSchema = {
                    id: result.formId,
                    title: "Screening Form",
                    questions: questions
                };
                onSave(schema);
            } else {
                setError(result.error || 'Failed to save form');
            }
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setIsSaving(false);
        }
    };

    if (isLoading) {
        return <div className={styles.loadingContainer}>Loading form configuration...</div>;
    }

    return (
        <div className={styles.container}>
            {error && (
                <div className={styles.error}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#EF4444' }} />
                    {error}
                </div>
            )}

            {/* Questions List */}
            <div className={styles.questionList}>
                {questions.length === 0 && (
                    <div className={styles.emptyState}>
                        <p>No questions yet. Add one to get started.</p>
                    </div>
                )}

                {questions.map((q, index) => (
                    <div key={q.id} className={styles.questionItem}>
                        {/* Drag Handle (Visual only for now) */}
                        <div className={styles.dragHandle} />

                        <div className={styles.row}>
                            <div className={styles.flex1}>
                                <input
                                    type="text"
                                    value={q.text}
                                    onChange={(e) => updateQuestion(q.id, { text: e.target.value })}
                                    placeholder="Question Text"
                                    className={styles.input}
                                />
                            </div>
                            <div className={styles.selectWrapper}>
                                <select
                                    value={q.type}
                                    onChange={(e) => updateQuestion(q.id, { type: e.target.value as QuestionType })}
                                    className={styles.select}
                                >
                                    <option value="text">Short Answer</option>
                                    <option value="select">Multiple Choice</option>
                                </select>
                                <div className={styles.selectIcon}>
                                    {q.type === 'text' ? <Type size={16} /> : <List size={16} />}
                                </div>
                            </div>
                        </div>

                        {q.type === 'select' && (
                            <div className={styles.optionsList}>
                                {q.options?.map((opt, optIndex) => (
                                    <div key={optIndex} className={styles.optionRowContainer}>
                                        <div className={styles.optionRow}>
                                            <div className={styles.optionDot} />
                                            <input
                                                type="text"
                                                value={opt}
                                                onChange={(e) => updateOption(q.id, optIndex, e.target.value)}
                                                placeholder={`Option ${optIndex + 1} `}
                                                className={styles.optionInput}
                                            />
                                            <button
                                                onClick={() => removeOption(q.id, optIndex)}
                                                className={styles.removeOptionBtn}
                                                type="button"
                                                title="Remove Option"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                        {opt.trim() && (
                                            <label className={styles.conditionalCheckboxLabel}>
                                                <input
                                                    type="checkbox"
                                                    checked={q.conditionalTextInputs?.[opt] || false}
                                                    onChange={() => toggleConditionalTextInput(q.id, opt)}
                                                    className={styles.conditionalCheckbox}
                                                />
                                                <span className={styles.conditionalCheckboxText}>
                                                    Requires text input when selected
                                                </span>
                                            </label>
                                        )}
                                    </div>
                                ))}
                                <button
                                    onClick={() => addOption(q.id)}
                                    className={styles.addOptionBtn}
                                    type="button"
                                >
                                    <Plus size={16} />
                                    Add Option
                                </button>
                            </div>
                        )}

                        <div className={styles.actionsFooter}>
                            <button
                                onClick={() => removeQuestion(q.id)}
                                className={styles.iconBtn}
                                title="Delete Question"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Sticky Action Footer */}
            <div className={styles.stickyFooter}>
                <span className={styles.questionCount}>
                    {questions.length} Questions
                </span>

                <button
                    onClick={addQuestion}
                    className={styles.btnSecondary}
                >
                    <Plus size={18} />
                    <span>Add Question</span>
                </button>

                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className={styles.btnPrimary}
                >
                    {isSaving ? (
                        <div className={styles.loadingSpinner} />
                    ) : (
                        <Save size={18} />
                    )}
                    <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
                </button>
            </div>
        </div>
    );
}
