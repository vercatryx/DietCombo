'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { verifyOtp } from '@/lib/auth-actions';
import Image from 'next/image';
import styles from '../page.module.css';

export default function VerifyLoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        // Get email and code from URL parameters
        const emailParam = searchParams.get('email');
        const codeParam = searchParams.get('code');

        if (emailParam) {
            setEmail(emailParam);
        }
        if (codeParam) {
            setCode(codeParam);
            // Auto-verify if both email and code are provided
            if (emailParam) {
                handleVerify(emailParam, codeParam);
            }
        }
    }, [searchParams]);

    const handleVerify = async (emailToVerify: string, codeToVerify: string) => {
        if (!emailToVerify || !codeToVerify) {
            setError('Email and code are required.');
            return;
        }

        setIsVerifying(true);
        setError('');
        setMessage('Verifying code...');

        try {
            const result = await verifyOtp(emailToVerify, codeToVerify);
            if (!result.success) {
                setError(result.message || 'Verification failed. The code may be invalid or expired.');
                setIsVerifying(false);
            } else {
                // Redirect happens in verifyOtp action
                setMessage('Verification successful! Redirecting...');
            }
        } catch (error: any) {
            // Redirect throws error, ignore it
            if (error.message !== 'NEXT_REDIRECT') {
                setError('An error occurred during verification.');
                setIsVerifying(false);
            }
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        await handleVerify(email, code);
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className="text-center">
                    <div className={styles.logoContainer}>
                        <Image
                            src="/diet-fantasy-logo.png"
                            alt="Diet Fantasy Logo"
                            width={200}
                            height={200}
                            className={styles.logo}
                            priority
                        />
                    </div>
                    <h2 className={styles.title}>Verify Your Login</h2>
                    <p className={styles.subtitle}>
                        Enter the code sent to your email to complete login
                    </p>
                </div>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <div className={styles.formGroup}>
                        <label htmlFor="email" className={styles.label}>
                            Email
                        </label>
                        <input
                            id="email"
                            type="email"
                            required
                            className={styles.inputLarge}
                            placeholder="Enter your email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isVerifying}
                            autoFocus
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label htmlFor="code" className={styles.label}>
                            Verification Code
                        </label>
                        <input
                            id="code"
                            type="text"
                            required
                            className={styles.inputOtp}
                            placeholder="------"
                            value={code}
                            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            disabled={isVerifying}
                            autoComplete="one-time-code"
                        />
                    </div>

                    {error && (
                        <div className={styles.errorMessage}>
                            {error}
                        </div>
                    )}

                    {message && !error && (
                        <div style={{ 
                            padding: '12px', 
                            backgroundColor: 'var(--color-success-light)', 
                            color: 'var(--color-success)', 
                            borderRadius: '8px',
                            marginBottom: '1rem'
                        }}>
                            {message}
                        </div>
                    )}

                    <div style={{ marginTop: '1.5rem' }}>
                        <button
                            type="submit"
                            disabled={isVerifying || !email || !code}
                            className={styles.btnLarge}
                        >
                            {isVerifying ? (
                                <>
                                    <div className={styles.spinner} />
                                    Verifying...
                                </>
                            ) : (
                                'Verify & Sign In'
                            )}
                        </button>
                    </div>

                    <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                        <button
                            type="button"
                            onClick={() => router.push('/login')}
                            className={styles.resendBtn}
                            style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer' }}
                        >
                            Back to Login
                        </button>
                    </div>

                    <p className={styles.secureText}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Protected by secure authentication
                    </p>
                </form>
            </div>
        </div>
    );
}
