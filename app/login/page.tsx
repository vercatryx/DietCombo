'use client';

import { useActionState, useState } from 'react';
import Image from 'next/image';
import {
    login,
    checkLoginIdentity,
    sendOtp,
    verifyOtp,
    confirmLoginWithPick,
    type LoginAccountChoice,
} from '@/lib/auth-actions';
import styles from './page.module.css';

type Step = 1 | 2 | 3;

type VerifyOtpClientResult = {
    success: boolean;
    message?: string;
    needsAccountChoice?: boolean;
    accountChoices?: LoginAccountChoice[];
    pickToken?: string;
};

export default function LoginPage() {
    const [state, action, isPending] = useActionState(login, undefined);
    const [step, setStep] = useState<Step>(1);
    const [username, setUsername] = useState('');
    const [checkingIdentity, setCheckingIdentity] = useState(false);
    const [identityError, setIdentityError] = useState('');

    const [useOtp, setUseOtp] = useState(false);
    const [otpCode, setOtpCode] = useState('');
    const [verifyingOtp, setVerifyingOtp] = useState(false);
    const [otpMessage, setOtpMessage] = useState('');
    const [resendTimer, setResendTimer] = useState(0);

    const [accountChoices, setAccountChoices] = useState<LoginAccountChoice[]>([]);
    const [pickToken, setPickToken] = useState('');
    const [pickError, setPickError] = useState('');
    const [pickingAccount, setPickingAccount] = useState(false);

    const handleNext = async () => {
        if (!username.trim()) {
            setIdentityError('Please enter a username or email.');
            return;
        }

        setCheckingIdentity(true);
        setIdentityError('');

        try {
            const result = await checkLoginIdentity(username);

            if (result.exists && 'needsAccountChoice' in result && result.needsAccountChoice && result.accountChoices?.length) {
                setAccountChoices(result.accountChoices);
                setUseOtp(true);
                setOtpMessage('Sending security code...');
                const sendResult = await sendOtp(username);
                if (sendResult.success) {
                    setOtpMessage(sendResult.message || `Code sent to ${username.trim()}`);
                    setStep(2);
                    startResendTimer();
                } else {
                    setIdentityError(sendResult.message || 'Failed to send verification code.');
                }
                setCheckingIdentity(false);
                return;
            }

            if (result.exists) {
                if (result.type === 'client' && result.id) {
                    if (result.produceNotAllowed) {
                        setIdentityError('Produce account holders cannot sign in here. Please contact support.');
                        setCheckingIdentity(false);
                        return;
                    }
                    setUseOtp(true);
                    setOtpMessage('Sending security code...');
                    const sendResult = await sendOtp(username);
                    if (sendResult.success) {
                        setOtpMessage(sendResult.message || `Code sent to ${username.trim()}`);
                        setStep(2);
                        startResendTimer();
                    } else {
                        setIdentityError(sendResult.message || 'Failed to send verification code.');
                        setCheckingIdentity(false);
                        return;
                    }
                } else {
                    setUseOtp(false);
                    setStep(2);
                }
                setCheckingIdentity(false);
            } else {
                setIdentityError('No account found with that email, username, or phone number.');
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
            setOtpMessage(result.message || `Code resent to ${username.trim()}`);
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
            const result = (await verifyOtp(username, otpCode)) as VerifyOtpClientResult;
            if (result.needsAccountChoice && result.pickToken && result.accountChoices?.length) {
                setAccountChoices(result.accountChoices);
                setPickToken(result.pickToken);
                setPickError('');
                setStep(3);
                setVerifyingOtp(false);
                return;
            }
            if (!result.success) {
                setOtpMessage(result.message || 'Verification failed.');
                setVerifyingOtp(false);
            }
        } catch {
            // redirect throws
        }
    };

    const handlePickAccount = async (choice: LoginAccountChoice) => {
        if (!pickToken) return;
        setPickError('');
        setPickingAccount(true);
        try {
            const r = await confirmLoginWithPick(pickToken, { type: choice.type, id: choice.id });
            if (!r.success) {
                setPickError(r.message || 'Could not open that account.');
            }
        } catch {
            // redirect
        } finally {
            setPickingAccount(false);
        }
    };

    const handleBack = () => {
        if (step === 3) {
            setStep(1);
            setIdentityError('Start again: enter your email or phone number and request a new code.');
            setOtpCode('');
            setOtpMessage('');
            setUseOtp(false);
            setAccountChoices([]);
            setPickToken('');
            setPickError('');
            return;
        }
        setStep(1);
        setIdentityError('');
        setOtpCode('');
        setOtpMessage('');
        setUseOtp(false);
        setAccountChoices([]);
        setPickToken('');
        setPickError('');
    };

    const title =
        step === 1 ? 'Welcome Back' : step === 2 ? (useOtp ? 'Enter Code' : 'Welcome Back') : 'Choose account';

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
                    <h2 className={styles.title}>{title}</h2>
                    <p className={styles.subtitle}></p>
                </div>

                {step !== 3 ? (
                    <form className={styles.form} action={useOtp ? () => {} : action} onSubmit={useOtp ? handleVerifyOtp : undefined}>
                        <div className={styles.formGroup}>
                            {step === 1 && (
                                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                    <label htmlFor="username" className={styles.label}>
                                        Username, email, or mobile number
                                    </label>
                                    <input
                                        id="username"
                                        name="username"
                                        type="text"
                                        required
                                        className={styles.inputLarge}
                                        placeholder="Email, phone, or username"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
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
                                        <button type="button" onClick={handleBack} className={styles.changeBtn}>
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
                                                onChange={(e) =>
                                                    setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                                }
                                                autoFocus
                                                autoComplete="one-time-code"
                                            />
                                            <div className={styles.resendContainer}>
                                                <span>{otpMessage}</span>
                                                {resendTimer > 0 ? (
                                                    <span style={{ color: 'var(--text-tertiary)' }}>
                                                        Resend in {resendTimer}s
                                                    </span>
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
                            <div className={styles.errorMessage}>{state.message}</div>
                        )}

                        {useOtp && step === 2 && otpMessage && !otpMessage.includes('sent') && !otpMessage.includes('Resend') && (
                            <div className={styles.errorMessage}>{otpMessage}</div>
                        )}

                        <div style={{ marginTop: '1.5rem' }}>
                            {step === 1 ? (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        handleNext();
                                    }}
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
                                    ) : useOtp ? (
                                        'Verify & Sign In'
                                    ) : (
                                        'Sign In'
                                    )}
                                </button>
                            )}
                        </div>

                        <p className={styles.secureText}>
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            Protected by secure authentication
                        </p>
                    </form>
                ) : (
                    <div className={styles.form}>
                        <div className={styles.userInfo}>
                            <span className={styles.userInfoText}>{username}</span>
                            <button type="button" onClick={handleBack} className={styles.changeBtn}>
                                Start over
                            </button>
                        </div>
                        <p className={styles.chooseHint}>
                            This email is linked to more than one account. Choose which one you want to open.
                        </p>
                        <div className={styles.accountChoiceList}>
                            {accountChoices.map((c) => (
                                <button
                                    key={`${c.type}-${c.id}`}
                                    type="button"
                                    className={styles.accountChoiceBtn}
                                    disabled={pickingAccount}
                                    onClick={() => handlePickAccount(c)}
                                >
                                    <span className={styles.accountChoiceTitle}>{c.title}</span>
                                    {c.subtitle ? (
                                        <span className={styles.accountChoiceSubtitle}>{c.subtitle}</span>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                        {pickError ? <div className={styles.errorMessage}>{pickError}</div> : null}
                        {identityError && step === 3 ? (
                            <div className={styles.errorMessage} style={{ marginTop: '0.75rem' }}>
                                {identityError}
                            </div>
                        ) : null}
                        <p className={styles.secureText}>
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                            Protected by secure authentication
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
