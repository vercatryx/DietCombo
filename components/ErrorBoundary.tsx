'use client';

import React from 'react';

interface Props {
    children: React.ReactNode;
}

interface State {
    hasError: boolean;
    error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo);
    }

    render() {
        if (this.state.hasError && this.state.error) {
            return (
                <div
                    style={{
                        padding: '2rem',
                        margin: '2rem',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 'var(--radius-lg)',
                        color: 'var(--text-primary)',
                        fontFamily: 'inherit',
                        maxWidth: '600px',
                    }}
                >
                    <h2 style={{ marginTop: 0, color: 'var(--color-danger)' }}>Something went wrong</h2>
                    <p style={{ marginBottom: '1rem' }}>
                        An error occurred while loading this page. Check the browser console for details.
                    </p>
                    <pre
                        style={{
                            padding: '1rem',
                            background: '#f8fafc',
                            borderRadius: 'var(--radius-md)',
                            overflow: 'auto',
                            fontSize: '0.875rem',
                        }}
                    >
                        {this.state.error.message}
                    </pre>
                    <button
                        type="button"
                        onClick={() => this.setState({ hasError: false, error: undefined })}
                        style={{
                            marginTop: '1rem',
                            padding: '0.5rem 1rem',
                            background: 'var(--color-primary)',
                            color: 'white',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            cursor: 'pointer',
                        }}
                    >
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
