'use client';

import React from 'react';
import { ClientProfile } from '@/lib/types';
import { Plus, AlertTriangle, Calendar, Info } from 'lucide-react';
import styles from './ClientPortal.module.css';

interface Props {
    // Basic Data
    client: ClientProfile;

    // Status / Validation
    totalMealCount: number;
    approvedLimit?: number | null;
    validationError?: string | null;
    takingEffectDate?: string | null;

    // Actions
    onAddVendor?: () => void;
    onAddMeal?: (mealType: string) => void;

    // UI State
    isCompact?: boolean;
    mealCategories?: { id: string, name: string, mealType: string }[];
    orderConfig?: any;
}

export default function ClientPortalHeader({
    client,
    totalMealCount,
    approvedLimit,
    validationError,
    takingEffectDate,
    onAddVendor,
    onAddMeal,
    mealCategories = [],
    orderConfig = {}
}: Props) {
    const isOverLimit = approvedLimit && totalMealCount > approvedLimit;
    const isUnderLimit = approvedLimit && totalMealCount < (approvedLimit * 0.5); // Just a heuristic

    const countColor = isOverLimit ? 'var(--color-danger)' : 'var(--color-primary)';

    return (
        <div className={styles.headerContainer}>
            {/* Top Row: Meta Info & Warnings */}
            <div className={styles.headerTopRow}>
                <div className={styles.headerMeta}>
                    {/* Meal Count - Only show for Food Service */}
                    {client.serviceType === 'Food' && (
                        <div className={styles.headerCount}>
                            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                                Current Order
                            </span>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: countColor, lineHeight: 1 }}>
                                {totalMealCount}
                                {approvedLimit && <span style={{ fontSize: '1rem', color: 'var(--text-tertiary)', fontWeight: 500 }}> / {approvedLimit}</span>}
                            </div>
                        </div>
                    )}

                    {/* Effect Date */}
                    {takingEffectDate && (
                        <div className={styles.headerEffectDate}>
                            <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                                Changes take effect from
                            </span>
                            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Calendar size={16} />
                                {takingEffectDate}
                            </div>
                        </div>
                    )}
                </div>

                {/* Warning Box */}
                {validationError && (
                    <div className={styles.headerWarning}>
                        <AlertTriangle size={18} />
                        {validationError}
                    </div>
                )}
            </div>

            {/* Bottom Row: Actions */}
            <div className={styles.headerBottomRow}>
                {client.serviceType === 'Food' && (
                    <>
                        {onAddVendor && (
                            <button
                                onClick={onAddVendor}
                                className="btn btn-warning"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    backgroundColor: '#fbbf24',
                                    border: 'none',
                                    color: 'black',
                                    fontWeight: 600,
                                    padding: '10px 24px',
                                    borderRadius: '8px',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                }}
                            >
                                <Plus size={16} /> Add Vendor
                            </button>
                        )}

                        {onAddMeal && Array.from(new Set(mealCategories.map(c => c.mealType)))
                            .filter(type => !orderConfig?.mealSelections?.[type])
                            .map(type => (
                                <button
                                    key={type}
                                    onClick={() => onAddMeal(type)}
                                    className="btn btn-outline"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        borderColor: '#fbbf24',
                                        color: '#fbbf24',
                                        fontWeight: 600,
                                        padding: '10px 24px',
                                        borderRadius: '8px',
                                        backgroundColor: 'transparent'
                                    }}
                                >
                                    <Plus size={16} /> Add {type}
                                </button>
                            ))}
                    </>
                )}
            </div>
        </div>
    );
}
