'use client';

import { OrderHistoryLog } from '@/lib/types';
import { User, Clock, FileText, ChevronRight } from 'lucide-react';
import styles from './OrderHistoryItem.module.css';

interface Props {
    log: OrderHistoryLog;
}

export function OrderHistoryItem({ log }: Props) {
    const formattedDate = new Date(log.timestamp).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });

    return (
        <div className={styles.item}>
            <div className={styles.header}>
                <div className={styles.author}>
                    <div className={styles.iconWrapper}>
                        <User size={14} />
                    </div>
                    <span className={styles.who}>{log.who}</span>
                </div>
                <div className={styles.time}>
                    <Clock size={12} />
                    <span>{formattedDate}</span>
                </div>
            </div>
            <div className={styles.content}>
                <div className={styles.summaryIcon}>
                    <FileText size={16} />
                </div>
                <p className={styles.summaryText}>{log.summary}</p>
            </div>
            <div className={styles.footer}>
                <span className={styles.logId}>ID: {log.id?.slice(0, 8)}...</span>
                <ChevronRight size={12} className={styles.arrow} />
            </div>
        </div>
    );
}
