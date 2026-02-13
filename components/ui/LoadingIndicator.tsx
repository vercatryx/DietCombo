'use client';

import { Loader2 } from 'lucide-react';
import styles from './LoadingIndicator.module.css';

interface LoadingIndicatorProps {
    /** Message shown below the spinner. Default: "Loading..." */
    message?: string;
    /** Optional extra class for the wrapper */
    className?: string;
    /** Spinner size in pixels. Default: 32 */
    size?: number;
}

export function LoadingIndicator({ message = 'Loading...', className, size = 32 }: LoadingIndicatorProps) {
    return (
        <div className={[styles.container, className].filter(Boolean).join(' ')}>
            <Loader2 className="animate-spin" size={size} />
            <p>{message}</p>
        </div>
    );
}
