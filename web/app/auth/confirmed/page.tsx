'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type Status = 'loading' | 'success' | 'error' | 'recovery';

function ConfirmationLoading() {
  return (
    <main className="confirmation-page">
      <section className="confirmation-card">
        <div className="confirmation-icon"><span className="confirmation-spinner" /></div>
        <span className="section-kicker">RAG Assistant secure access</span>
        <h1>Confirming your account</h1>
        <p>Verifying your secure confirmation link…</p>
        <div className="confirmation-detail">Private by design · Secure authentication powered by Supabase</div>
      </section>
    </main>
  );
}

function AuthConfirmationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('Verifying your secure confirmation link…');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void completeConfirmation();
    // searchParams is stable for the lifetime of this callback page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function completeConfirmation() {
    if (!supabase) {
      setStatus('error');
      setMessage('Supabase is not configured for this deployment.');
      return;
    }

    const errorDescription = searchParams.get('error_description');
    if (errorDescription) {
      setStatus('error');
      setMessage(errorDescription);
      return;
    }

    const code = searchParams.get('code');
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        setStatus('error');
        setMessage(error.message);
        return;
      }
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }

    const isRecovery = searchParams.get('mode') === 'recovery';
    if (isRecovery && data.session) {
      setStatus('recovery');
      setMessage('Your reset link is valid. Choose a new password below.');
      return;
    }

    if (data.session) {
      setStatus('success');
      setMessage('Your email has been confirmed and your account is ready.');
      return;
    }

    setStatus('error');
    setMessage('This confirmation link is invalid, expired, or has already been used.');
  }

  async function updatePassword() {
    if (!supabase) return;
    if (newPassword.length < 8) {
      setMessage('Use at least 8 characters for your new password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setBusy(false);
    if (error) {
      setStatus('error');
      setMessage(error.message);
      return;
    }
    setStatus('success');
    setMessage('Your password has been updated successfully.');
  }

  const icon = status === 'loading' ? <span className="confirmation-spinner" /> : status === 'error' ? '!' : status === 'recovery' ? '↻' : '✓';
  const title = status === 'loading' ? 'Confirming your account' : status === 'error' ? 'Confirmation unsuccessful' : status === 'recovery' ? 'Create a new password' : 'Email confirmed';

  return (
    <main className="confirmation-page">
      <section className="confirmation-card">
        <div className="confirmation-icon">{icon}</div>
        <span className="section-kicker">RAG Assistant secure access</span>
        <h1>{title}</h1>
        <p>{message}</p>

        {status === 'recovery' && (
          <div className="confirmation-actions">
            <input type="password" minLength={8} placeholder="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <input type="password" minLength={8} placeholder="Confirm new password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            <button className="primary-button full" type="button" disabled={busy} onClick={() => void updatePassword()}>{busy ? 'Updating…' : 'Update password'}</button>
          </div>
        )}

        {status === 'success' && (
          <div className="confirmation-actions">
            <button className="primary-button full" type="button" onClick={() => router.replace('/')}>Open my workspace</button>
          </div>
        )}

        {status === 'error' && (
          <div className="confirmation-actions">
            <button className="primary-button full" type="button" onClick={() => router.replace('/')}>Return to sign in</button>
          </div>
        )}

        <div className="confirmation-detail">Private by design · Secure authentication powered by Supabase</div>
      </section>
    </main>
  );
}

export default function AuthConfirmedPage() {
  return (
    <Suspense fallback={<ConfirmationLoading />}>
      <AuthConfirmationContent />
    </Suspense>
  );
}
