'use client';

import styles from '../Admin.module.css';
import { ClientChangesManagement } from '@/components/admin/ClientChangesManagement';

export default function AdminChangesPage() {
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>Changes</h1>
            </header>
            <div className={styles.content}>
                <ClientChangesManagement />
            </div>
        </div>
    );
}
