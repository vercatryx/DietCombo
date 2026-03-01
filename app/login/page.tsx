'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { login, checkEmailIdentity, sendOtp, verifyOtp } from '@/lib/auth-actions';
import styles from './page.module.css';

export default function LoginPage() {
    const router = useRouter();
    const [state, action, isPending] = useActionState(login, undefined);
    const [step, setStep] = useState<1 | 2>(1);
    const [username, setUsername] = useState('');
    const [checkingIdentity, setCheckingIdentity] = useState(false);
    const [identityError, setIdentityError] = useState('');

    // New state for OTP
    const [useOtp, setUseOtp] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [verifyingOtp, setVerifyingOtp] = useState(false);
    const [otpMessage, setOtpMessage] = useState('');
    const [resendTimer, setResendTimer] = useState(0);

    const handleNext = async () => {
        if (!username.trim()) {
            setIdentityError('Please enter a username or email.');
            return;
        }

        setCheckingIdentity(true);
        setIdentityError('');

        try {
            console.log('Checking identity for:', username);
            const result = await checkEmailIdentity(username);
            console.log('Identity result:', result);

            // Check for multiple accounts first
            // Note: If multiple accounts exist and one is admin, checkEmailIdentity now returns the admin account
            // So multipleAccounts will only be true if there are multiple non-admin accounts
            if (result.multipleAccounts) {
                setIdentityError('Multiple accounts found with that email address. Please contact support.');
                setCheckingIdentity(false);
                return;
            }

            if (result.exists) {
                if (result.type === 'client' && result.id) {
                    if ((result as { produceNotAllowed?: boolean }).produceNotAllowed) {
                        setIdentityError('Produce account holders cannot sign in here. Please contact support.');
                        setCheckingIdentity(false);
                        return;
                    }
                    // Check if passwordless is enabled for this user (which means global enabled + is client)
                    if (result.enablePasswordless) {
                        setUseOtp(true);

                        // Trigger OTP send immediately
                        setOtpMessage('Sending security code...');
                        const sendResult = await sendOtp(username);
                        if (sendResult.success) {
                            setOtpMessage(`Code sent to ${username}`);
                            setStep(2);
                            startResendTimer();
                        } else {
                            setIdentityError(sendResult.message || 'Failed to send verification code.');
                            setCheckingIdentity(false);
                            return;
                        }
                    } else {
                        // Original flow for client without passwordless
                        console.log('Redirecting to client portal:', result.id);
                        router.push(`/client-portal/${result.id}`);
                        // Don't turn off checkingIdentity so we show loading state during redirect
                        return;
                    }
                } else {
                    // Not a client, or passwordless disabled
                    setUseOtp(false);
                    setStep(2);
                }
                setCheckingIdentity(false);
            } else {
                setIdentityError('No account found with that email/username.');
                setCheckingIdentity(false);
            }
        } catch (err) {
            console.error('Identity check error:', err);
            setIdentityError('An error occurred. Please try again.');
            setCheckingIdentity(false);
        }
    };

    const startResendTimer = () => {
        setResendTimer(60);
        const interval = setInterval(() => {
            setResendTimer((prev) => {
                if (prev <= 1) {
                    clearInterval(interval);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const handleResendOtp = async () => {
        if (resendTimer > 0) return;
        setOtpMessage('Resending code...');
        const result = await sendOtp(username);
        if (result.success) {
            setOtpMessage(`Code resent to ${username}`);
            startResendTimer();
        } else {
            setOtpMessage(result.message || 'Failed to resend code.');
        }
    };

    const handleVerifyOtp = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!otpCode) return;

        setVerifyingOtp(true);
        setOtpMessage('');

        try {
            const result = await verifyOtp(username, otpCode);
            if (!result.success) {
                setOtpMessage(result.message || 'Verification failed.');
                setVerifyingOtp(false);
            } else {
                // Redirect happens in verifyOtp
            }
        } catch (error: any) {
            // redirect throws error, ignore
        }
    };

    const handleBack = () => {
        setStep(1);
        setIdentityError('');
        setOtpCode('');
        setOtpMessage('');
        setUseOtp(false);
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
                    <h2 className={styles.title}>
                        {step === 1 ? 'Welcome Back' : (useOtp ? 'Enter Code' : 'Welcome Back')}
                    </h2>
                    <p className={styles.subtitle}>
                    </p>
                </div>


                <form className={styles.form} action={useOtp ? () => { } : action} onSubmit={useOtp ? handleVerifyOtp : undefined}>
                    <div className={styles.formGroup}>
                        {step === 1 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <label htmlFor="username" className={styles.label}>
                                    Username or Email
                                </label>
                                <input
                                    id="username"
                                    name="username"
                                    type="text"
                                    required
                                    className={styles.inputLarge}
                                    placeholder="Enter your username or email"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    // Allow Enter key to trigger Next
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleNext();
                                        }
                                    }}
                                    disabled={checkingIdentity}
                                    autoFocus
                                />
                                {identityError && (
                                    <div className={styles.errorMessage} style={{ marginTop: '0.5rem' }}>
                                        {identityError}
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 2 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <div className={styles.userInfo}>
                                    <span className={styles.userInfoText}>{username}</span>
                                    <button
                                        type="button"
                                        onClick={handleBack}
                                        className={styles.changeBtn}
                                    >
                                        Change
                                    </button>
                                </div>
                                <input type="hidden" name="username" value={username} />

                                {useOtp ? (
                                    <div>
                                        <label htmlFor="otp" className={styles.label}>
                                            Security Code
                                        </label>
                                        <input
                                            id="otp"
                                            name="otpCode"
                                            type="text"
                                            required
                                            className={styles.inputOtp}
                                            placeholder="------"
                                            value={otpCode}
                                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                            autoFocus
                                            autoComplete="one-time-code"
                                        />
                                        <div className={styles.resendContainer}>
                                            <span>{otpMessage}</span>
                                            {resendTimer > 0 ? (
                                                <span style={{ color: 'var(--text-tertiary)' }}>Resend in {resendTimer}s</span>
                                            ) : (
                                                <button type="button" onClick={handleResendOtp} className={styles.resendBtn}>
                                                    Resend Code
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <label htmlFor="password" className={styles.label}>
                                            Password
                                        </label>
                                        <input
                                            id="password"
                                            name="password"
                                            type="password"
                                            required
                                            className={styles.inputLarge}
                                            placeholder="Enter your password"
                                            autoFocus
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {!useOtp && step === 2 && state?.message && (
                        <div className={styles.errorMessage}>
                            {state.message}
                        </div>
                    )}

                    {useOtp && step === 2 && otpMessage && !otpMessage.includes('sent') && !otpMessage.includes('Resend') && (
                        <div className={styles.errorMessage}>
                            {otpMessage}
                        </div>
                    )}

                    <div style={{ marginTop: '1.5rem' }}>
                        {step === 1 ? (
                            <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); handleNext(); }}
                                disabled={checkingIdentity}
                                className={styles.btnLarge}
                            >
                                {checkingIdentity ? (
                                    <>
                                        <div className={styles.spinner} />
                                        Checking...
                                    </>
                                ) : (
                                    'Next'
                                )}
                            </button>
                        ) : (
                            <button
                                type="submit"
                                disabled={isPending || verifyingOtp}
                                className={styles.btnLarge}
                            >
                                {isPending || verifyingOtp ? (
                                    <>
                                        <div className={styles.spinner} />
                                        {useOtp ? 'Verifying...' : 'Signing in...'}
                                    </>
                                ) : (
                                    useOtp ? 'Verify & Sign In' : 'Sign In'
                                )}
                            </button>
                        )}
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
