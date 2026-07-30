'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type Panel = 'chat' | 'sources' | 'graph' | 'history' | 'settings';
type Message = { id: string; role: 'user' | 'assistant'; content: string };
type DocumentRow = { id: string; name: string; status: string; mime_type: string | null; created_at: string };
type WorkspaceRow = { id: string; name: string };
type AuthFeedback = { kind: 'success' | 'error' | 'info'; title: string; message: string } | null;

const suggestions = [
  'Summarise the most important findings in my sources',
  'Compare two documents and highlight contradictions',
  'Analyse the uploaded spreadsheet and explain the trends',
];

export default function HomePage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceRow | null>(null);
  const [panel, setPanel] = useState<Panel>('chat');
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState('');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setWorkspace(null);
        setDocuments([]);
        setMessages([]);
      }
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session || !supabase) return;
    void initialiseWorkspace();
  }, [session, supabase]);

  function openAuth(mode: 'signin' | 'signup' = 'signin') {
    setAuthMode(mode);
    setAuthFeedback(null);
    setPassword('');
    setConfirmPassword('');
    setAuthOpen(true);
  }

  function switchAuthMode() {
    setAuthMode((current) => (current === 'signin' ? 'signup' : 'signin'));
    setAuthFeedback(null);
    setPassword('');
    setConfirmPassword('');
  }

  async function initialiseWorkspace() {
    if (!supabase || !session) return;
    setBusy(true);
    setNotice('Connecting secure workspace…');

    const { data: memberships, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces(id,name)')
      .eq('user_id', session.user.id)
      .limit(1);

    if (membershipError) {
      setNotice(membershipError.message);
      setBusy(false);
      return;
    }

    let current = memberships?.[0]?.workspaces as unknown as WorkspaceRow | null;
    if (!current) {
      const slug = `workspace-${session.user.id.slice(0, 8)}-${Date.now().toString(36)}`;
      const { data: created, error } = await supabase
        .from('workspaces')
        .insert({ name: 'My Knowledge Workspace', slug, created_by: session.user.id })
        .select('id,name')
        .single();
      if (error) {
        setNotice(`${error.message}. Run the latest Supabase migration, then refresh.`);
        setBusy(false);
        return;
      }
      current = created;
    }

    setWorkspace(current);
    await loadDocuments(current.id);
    setNotice('Workspace connected');
    setBusy(false);
  }

  async function loadDocuments(workspaceId: string) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('documents')
      .select('id,name,status,mime_type,created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) setNotice(error.message);
    else setDocuments((data ?? []) as DocumentRow[]);
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthFeedback(null);

    if (!supabase) {
      setAuthFeedback({ kind: 'error', title: 'Connection unavailable', message: 'Supabase environment variables are missing.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setAuthFeedback({ kind: 'error', title: 'Email required', message: 'Enter the email address you want to use.' });
      return;
    }
    if (password.length < 8) {
      setAuthFeedback({ kind: 'error', title: 'Password is too short', message: 'Use at least 8 characters for your password.' });
      return;
    }
    if (authMode === 'signup' && password !== confirmPassword) {
      setAuthFeedback({ kind: 'error', title: 'Passwords do not match', message: 'Re-enter the same password in both fields.' });
      return;
    }

    setBusy(true);
    setAuthFeedback({
      kind: 'info',
      title: authMode === 'signin' ? 'Signing you in…' : 'Creating your account…',
      message: 'Please wait while we securely process your request.',
    });

    const result = authMode === 'signup'
      ? await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirmed`,
          },
        })
      : await supabase.auth.signInWithPassword({ email: cleanEmail, password });

    setBusy(false);

    if (result.error) {
      setAuthFeedback({ kind: 'error', title: authMode === 'signin' ? 'Unable to sign in' : 'Unable to create account', message: result.error.message });
      return;
    }

    if (authMode === 'signup' && !result.data.session) {
      setAuthFeedback({
        kind: 'success',
        title: 'Check your email',
        message: `We sent a confirmation link to ${cleanEmail}. Open it to activate your account, then return here to sign in.`,
      });
      setPassword('');
      setConfirmPassword('');
      return;
    }

    setAuthFeedback({ kind: 'success', title: 'Signed in successfully', message: 'Your secure workspace is being prepared.' });
    setNotice('Signed in successfully');
    window.setTimeout(() => setAuthOpen(false), 700);
  }

  async function resendConfirmation() {
    if (!supabase || !email.trim()) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirmed` },
    });
    setBusy(false);
    setAuthFeedback(error
      ? { kind: 'error', title: 'Email not sent', message: error.message }
      : { kind: 'success', title: 'Confirmation email resent', message: `A new confirmation link was sent to ${email.trim().toLowerCase()}.` });
  }

  async function sendPasswordReset() {
    if (!supabase || !email.trim()) {
      setAuthFeedback({ kind: 'error', title: 'Enter your email', message: 'Enter your email address first, then choose Forgot password.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/confirmed?mode=recovery`,
    });
    setBusy(false);
    setAuthFeedback(error
      ? { kind: 'error', title: 'Reset email not sent', message: error.message }
      : { kind: 'success', title: 'Check your email', message: 'We sent you a secure password-reset link.' });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setNotice('Signed out');
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!session || !workspace || !supabase) {
      openAuth('signin');
      return;
    }

    setBusy(true);
    setNotice(`Uploading ${file.name}…`);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `${workspace.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('rag-documents').upload(storagePath, file);
    if (uploadError) {
      setNotice(uploadError.message);
      setBusy(false);
      return;
    }

    const { error: documentError } = await supabase.from('documents').insert({
      workspace_id: workspace.id,
      name: file.name,
      source_type: 'file',
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      status: 'pending',
      created_by: session.user.id,
    });

    if (documentError) setNotice(documentError.message);
    else {
      setNotice(`${file.name} added. Ingestion is queued for the backend step.`);
      await loadDocuments(workspace.id);
      setPanel('sources');
    }
    setBusy(false);
  }

  async function sendMessage() {
    const text = prompt.trim();
    if (!text) return;
    if (!session || !workspace || !supabase) {
      openAuth('signin');
      return;
    }

    setPrompt('');
    setBusy(true);
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((current) => [...current, userMessage]);

    let activeConversation = conversationId;
    if (!activeConversation) {
      const { data, error } = await supabase.from('conversations').insert({
        workspace_id: workspace.id,
        title: text.slice(0, 80),
        created_by: session.user.id,
      }).select('id').single();
      if (error) {
        setNotice(error.message);
        setBusy(false);
        return;
      }
      activeConversation = data.id;
      setConversationId(data.id);
    }

    await supabase.from('messages').insert({
      conversation_id: activeConversation,
      workspace_id: workspace.id,
      role: 'user',
      content: text,
    });

    const sourceCount = documents.length;
    const response = sourceCount
      ? `Your question has been saved and linked to ${sourceCount} source${sourceCount === 1 ? '' : 's'}. The retrieval and generation backend is the next integration step.`
      : 'Your question has been saved. Add at least one source to begin grounded retrieval; the generation backend is the next integration step.';

    const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: response };
    setMessages((current) => [...current, assistantMessage]);
    await supabase.from('messages').insert({
      conversation_id: activeConversation,
      workspace_id: workspace.id,
      role: 'assistant',
      content: response,
      metadata: { stage: 'frontend-foundation' },
    });
    setBusy(false);
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setPrompt('');
    setPanel('chat');
  }

  return (
    <main className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand"><span className="brand-orb" /><div><strong>RAG Assistant</strong><small>Knowledge OS</small></div></div>
        <nav className="app-nav">
          {([
            ['chat', '◌', 'Chat'], ['sources', '◇', 'Sources'], ['graph', '⌘', 'Knowledge graph'], ['history', '↺', 'History'], ['settings', '⚙', 'Settings'],
          ] as [Panel, string, string][]).map(([id, icon, label]) => (
            <button key={id} type="button" className={panel === id ? 'active' : ''} onClick={() => setPanel(id)}><span>{icon}</span>{label}</button>
          ))}
        </nav>
        <div className="sidebar-account">
          <span className={session ? 'status-live' : 'status-offline'} />
          <div><strong>{session?.user.email ?? 'Guest workspace'}</strong><small>{session ? 'Supabase connected' : 'Sign in to save activity'}</small></div>
        </div>
      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div><span className="app-kicker">{workspace?.name ?? 'Private workspace'}</span><h1>{panel === 'chat' ? 'Ask your knowledge' : panel === 'sources' ? 'Connected sources' : panel === 'graph' ? 'Knowledge graph' : panel === 'history' ? 'Conversation history' : 'Workspace settings'}</h1></div>
          <div className="topbar-actions">
            {notice && <span className="inline-notice">{notice}</span>}
            {session ? <button className="quiet-button" type="button" onClick={signOut}>Sign out</button> : <button className="primary-button" type="button" onClick={() => openAuth('signin')}>Sign in</button>}
            <button className="primary-button" type="button" onClick={newChat}>New chat</button>
          </div>
        </header>

        {panel === 'chat' && (
          <div className="chat-stage">
            <div className="message-stream">
              {messages.length === 0 ? (
                <div className="empty-state"><div className="intelligence-mark"><span className="brand-orb" /></div><h2>What would you like to understand?</h2><p>Search across documents, websites, spreadsheets, repositories, and connected enterprise knowledge.</p></div>
              ) : messages.map((message) => <article key={message.id} className={`message-card ${message.role}`}><span>{message.role === 'user' ? 'You' : 'RAG Assistant'}</span><p>{message.content}</p></article>)}
            </div>
            <div className="composer-wrap">
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Ask anything about your connected knowledge…" rows={3} />
              <div className="composer-toolbar">
                <button type="button" className="attach-button" onClick={() => fileInputRef.current?.click()}>＋ Add source</button>
                <input ref={fileInputRef} type="file" hidden onChange={uploadFile} />
                <span>{documents.length} sources</span>
                <button type="button" className="send-button" disabled={busy || !prompt.trim()} onClick={() => void sendMessage()}>→</button>
              </div>
            </div>
            <div className="suggestion-row">{suggestions.map((item) => <button type="button" key={item} onClick={() => setPrompt(item)}>{item}</button>)}</div>
          </div>
        )}

        {panel === 'sources' && (
          <div className="panel-content">
            <div className="panel-toolbar"><div><h2>Sources</h2><p>Files are private and stored in the workspace-scoped Supabase bucket.</p></div><button className="primary-button" type="button" onClick={() => fileInputRef.current?.click()}>Upload file</button></div>
            <input ref={fileInputRef} type="file" hidden onChange={uploadFile} />
            <div className="source-grid">
              {documents.length ? documents.map((document) => <article className="source-card" key={document.id}><div className="source-icon">◇</div><div><strong>{document.name}</strong><small>{document.mime_type || 'Unknown type'} · {new Date(document.created_at).toLocaleDateString()}</small></div><span className={`source-status ${document.status}`}>{document.status}</span></article>) : <div className="empty-panel">No sources connected yet. Upload a document to begin.</div>}
            </div>
          </div>
        )}

        {panel === 'graph' && <div className="panel-content"><div className="graph-placeholder"><div className="graph-core" /><h2>Knowledge graph foundation ready</h2><p>Entities and relationships will appear here after the ingestion pipeline extracts them from your sources.</p></div></div>}
        {panel === 'history' && <div className="panel-content"><div className="empty-panel">Conversation persistence is connected. The full searchable history list is the next UI module.</div></div>}
        {panel === 'settings' && <div className="panel-content"><div className="settings-grid"><article><span>Database</span><strong>{supabase ? 'Configured' : 'Missing environment variables'}</strong></article><article><span>Authentication</span><strong>{session ? 'Signed in' : 'Guest'}</strong></article><article><span>Workspace</span><strong>{workspace?.name ?? 'Not initialised'}</strong></article><article><span>Storage</span><strong>rag-documents</strong></article></div></div>}
      </section>

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && setAuthOpen(false)}>
          <form className="auth-modal auth-modal-enhanced" onSubmit={submitAuth} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close" disabled={busy} onClick={() => setAuthOpen(false)}>×</button>
            <div className="auth-brand"><span className="brand-orb" /><div><strong>RAG Assistant</strong><small>Secure knowledge workspace</small></div></div>
            <span className="section-kicker">Secure access</span>
            <h2>{authMode === 'signin' ? 'Welcome back' : 'Create your account'}</h2>
            <p>{authMode === 'signin' ? 'Sign in to continue to your private workspace.' : 'Create an account to save conversations, upload sources, and build your knowledge workspace.'}</p>

            {authFeedback && (
              <div className={`auth-feedback ${authFeedback.kind}`} role="status">
                <span>{authFeedback.kind === 'success' ? '✓' : authFeedback.kind === 'error' ? '!' : '↻'}</span>
                <div><strong>{authFeedback.title}</strong><p>{authFeedback.message}</p></div>
              </div>
            )}

            <label>Email address
              <input type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setAuthFeedback(null); }} />
            </label>
            <label>Password
              <div className="password-field">
                <input type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" value={password} onChange={(event) => { setPassword(event.target.value); setAuthFeedback(null); }} />
                <button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</button>
              </div>
            </label>
            {authMode === 'signup' && (
              <label>Confirm password
                <input type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete="new-password" placeholder="Enter the same password again" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setAuthFeedback(null); }} />
              </label>
            )}

            {authMode === 'signin' && <button className="forgot-button" type="button" disabled={busy} onClick={() => void sendPasswordReset()}>Forgot password?</button>}
            <button className="primary-button full auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in securely' : 'Create account'}</button>

            {authMode === 'signup' && authFeedback?.kind === 'success' && (
              <button className="quiet-button full" type="button" disabled={busy} onClick={() => void resendConfirmation()}>Resend confirmation email</button>
            )}

            <div className="auth-switch">
              <span>{authMode === 'signin' ? 'New to RAG Assistant?' : 'Already have an account?'}</span>
              <button className="text-button" type="button" disabled={busy} onClick={switchAuthMode}>{authMode === 'signin' ? 'Create an account' : 'Sign in instead'}</button>
            </div>
            <small className="auth-legal">By continuing, you agree to use this workspace responsibly. Authentication is securely managed by Supabase.</small>
          </form>
        </div>
      )}
    </main>
  );
}
