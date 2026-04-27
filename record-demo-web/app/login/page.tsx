'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'email' | 'code' | 'verifying';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('admin@example.com');
  const [code, setCode] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSendingCode(true);
    await new Promise((r) => setTimeout(r, 900));
    setSendingCode(false);
    setStep('code');
    setTimeout(() => codeRef.current?.focus(), 50);
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setStep('verifying');
    await new Promise((r) => setTimeout(r, 700));
    router.push('/client-portal/demo-cli-043');
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: '0 20px 40px -12px rgb(0 0 0 / 0.12), 0 4px 8px -4px rgb(0 0 0 / 0.06)',
    padding: '2.5rem 2.25rem',
    width: '100%',
    maxWidth: '400px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.625rem 0.875rem',
    fontSize: '0.9375rem',
    border: '1.5px solid var(--border-color)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--bg-app)',
    color: 'var(--text-primary)',
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  };

  const btnPrimary: React.CSSProperties = {
    width: '100%',
    padding: '0.7rem 1.25rem',
    background: 'var(--color-primary)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    fontSize: '0.9375rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.15s ease, transform 0.1s ease',
    letterSpacing: '0.01em',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '0.375rem',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f0fdf4 0%, #f8fafc 50%, #eff6ff 100%)',
        padding: '1.5rem',
      }}
    >
      <div style={{ width: '100%', maxWidth: '400px' }}>
        {/* Logo / wordmark */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 48,
              height: 48,
              borderRadius: '14px',
              background: 'var(--color-primary)',
              marginBottom: '0.875rem',
            }}
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3C7.03 3 3 7.03 3 12s4.03 9 9 9 9-4.03 9-9-4.03-9-9-9zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 14c-2.67 0-5.04-1.17-6.67-3.03C6.77 16.36 9.27 15.5 12 15.5s5.23.86 6.67 2.47C17.04 19.83 14.67 21 12 21z"
                fill="#fff"
              />
            </svg>
          </div>
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              marginTop: '0.5rem',
              fontStyle: 'italic',
            }}
          >
            Your company logo here
          </p>
        </div>

        <div style={cardStyle}>
          {step === 'email' && (
            <>
              <h2
                style={{
                  fontSize: '1.0625rem',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  marginBottom: '0.25rem',
                }}
              >
                Sign in
              </h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                Enter your work email and we&apos;ll send you a one-time code.
              </p>
              <form onSubmit={handleSendCode}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label htmlFor="email" style={labelStyle}>
                    Work email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    placeholder="you@yourorg.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) =>
                      (e.currentTarget.style.boxShadow = '0 0 0 3px rgba(72,190,133,0.18)')
                    }
                    onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
                  />
                </div>
                <button
                  type="submit"
                  disabled={sendingCode}
                  style={{ ...btnPrimary, opacity: sendingCode ? 0.7 : 1 }}
                >
                  {sendingCode ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Spinner /> Sending code…
                    </span>
                  ) : (
                    'Send code'
                  )}
                </button>
              </form>
            </>
          )}

          {(step === 'code' || step === 'verifying') && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1rem' }}>
                <button
                  onClick={() => {
                    setStep('email');
                    setCode('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text-tertiary)',
                    padding: '0.125rem',
                    borderRadius: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                  aria-label="Go back"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M19 12H5M12 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <h2
                  style={{
                    fontSize: '1.0625rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                  }}
                >
                  Check your inbox
                </h2>
              </div>

              {/* Inbox callout */}
              <div
                style={{
                  background: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 'var(--radius-md)',
                  padding: '0.75rem 1rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.625rem',
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{ color: '#16a34a', flexShrink: 0, marginTop: '1px' }}
                  aria-hidden="true"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.75" />
                  <path d="M2 8l10 7 10-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                </svg>
                <p style={{ fontSize: '0.8125rem', color: '#166534', lineHeight: 1.5 }}>
                  We sent a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
                </p>
              </div>

              <form onSubmit={handleVerify}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label htmlFor="code" style={labelStyle}>
                    One-time code
                  </label>
                  <input
                    id="code"
                    ref={codeRef}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    maxLength={8}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    style={{
                      ...inputStyle,
                      fontSize: '1.5rem',
                      fontWeight: 700,
                      letterSpacing: '0.25em',
                      textAlign: 'center',
                    }}
                    onFocus={(e) =>
                      (e.currentTarget.style.boxShadow = '0 0 0 3px rgba(72,190,133,0.18)')
                    }
                    onBlur={(e) => (e.currentTarget.style.boxShadow = 'none')}
                    disabled={step === 'verifying'}
                  />
                </div>
                <button
                  type="submit"
                  disabled={step === 'verifying' || !code.trim()}
                  style={{
                    ...btnPrimary,
                    opacity: step === 'verifying' || !code.trim() ? 0.7 : 1,
                  }}
                >
                  {step === 'verifying' ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Spinner /> Verifying…
                    </span>
                  ) : (
                    'Verify and sign in'
                  )}
                </button>
              </form>

              <p style={{ textAlign: 'center', fontSize: '0.8125rem', color: 'var(--text-tertiary)', marginTop: '1rem' }}>
                Didn&apos;t get an email?{' '}
                <button
                  onClick={() => {
                    setStep('email');
                    setCode('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-primary)',
                    fontWeight: 600,
                    fontSize: '0.8125rem',
                    padding: 0,
                  }}
                >
                  Resend
                </button>
              </p>
            </>
          )}
        </div>

        <p
          style={{
            textAlign: 'center',
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            marginTop: '1.25rem',
          }}
        >
          Secure sign-in · No password required
        </p>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ animation: 'spin 0.7s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
