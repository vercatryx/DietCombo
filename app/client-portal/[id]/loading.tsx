'use client';

import { logout } from '@/lib/auth-actions';
import { LogOut, Loader2 } from 'lucide-react';

export default function ClientPortalLoading() {
  return (
    <div style={{ padding: '20px' }}>
      {/* Same header as page – visible while client data loads */}
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: 32, height: 32, background: 'var(--primary)', borderRadius: '8px' }} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Client Portal</h1>
        </div>
        <form action={logout}>
          <button
            type="submit"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              transition: 'all 0.2s'
            }}
          >
            <LogOut size={16} />
            Log out
          </button>
        </form>
      </div>

      {/* Loading state for content */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '200px',
          gap: '12px',
          color: 'var(--text-secondary)',
          fontSize: '0.9rem'
        }}
      >
        <Loader2 size={32} className="animate-spin" />
        <span>Loading your dashboard...</span>
      </div>
    </div>
  );
}
