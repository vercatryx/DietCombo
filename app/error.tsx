'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App error:', error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        background: 'var(--bg-app, #f8fafc)',
        color: 'var(--text-primary, #020617)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          padding: '2rem',
          background: 'var(--bg-surface, #fff)',
          border: '1px solid var(--border-color, #cbd5e1)',
          borderRadius: '0.75rem',
          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--color-danger, #ef4444)', fontSize: '1.25rem' }}>
          Something went wrong
        </h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary, #334155)' }}>
          An error occurred. Check the browser console for details.
        </p>
        <pre
          style={{
            padding: '1rem',
            marginBottom: '1rem',
            background: '#f1f5f9',
            borderRadius: '0.5rem',
            fontSize: '0.875rem',
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--color-primary, #48be85)',
            color: '#fff',
            border: 'none',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
