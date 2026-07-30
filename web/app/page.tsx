'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type Panel = 'chat' | 'sources' | 'graph' | 'history' | 'settings';
type Message = { id: string; role: 'user' | 'assistant'; content: string };
type DocumentRow = { id: string; name: string; status: string; mime_type: string | null; created_at: string; size_bytes?: number | null };
type WorkspaceRow = { id: string; name: string };
type AuthFeedback = { kind: 'success' | 'error' | 'info'; title: string; message: string } | null;

const suggestions = [
  'Summarise the key findings',
  'Compare my documents',
  'Find contradictions',
];

const panelTitles: Record<Panel, [string, string]> = {
  chat: ['Intelligence workspace', 'Ask across everything you know.'],
  sources: ['Source library', 'Your private knowledge, organised.'],
  graph: ['Knowledge graph', 'See how information connects.'],
  history: ['Conversation history', 'Return to earlier thinking.'],
  settings: ['Workspace settings', 'Control your private environment.'],
};

export default function HomePage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
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
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setNotice(error.message);
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) {
        setWorkspace(null);
        setDocuments([]);
        setMessages([]);
      }
    });

    const refreshSession = () => {
      void supabase.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setAuthReady(true);
      });
    };
    window.addEventListener('focus', refreshSession);
    document.addEventListener('visibilitychange', refreshSession);

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      window.removeEventListener('focus', refreshSession);
      document.removeEventListener('visibilitychange', refreshSession);
    };
  }, [supabase]);

  useEffect(() => {
    if (!session || !supabase) return;
    void ensureWorkspace(session);
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

  async function ensureWorkspace(activeSession: Session): Promise<WorkspaceRow | null> {
    if (!supabase) return null;
    if (workspace) return workspace;

    setBusy(true);
    setNotice('Opening your private workspace…');

    const { data: memberships, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces(id,name)')
      .eq('user_id', activeSession.user.id)
      .limit(1);

    if (membershipError) {
      setNotice(membershipError.message);
      setBusy(false);
      return null;
    }

    let current = memberships?.[0]?.workspaces as unknown as WorkspaceRow | null;
    if (!current) {
      const slug = `workspace-${activeSession.user.id.slice(0, 8)}-${Date.now().toString(36)}`;
      const { data: created, error } = await supabase
        .from('workspaces')
        .insert({ name: 'Personal Intelligence', slug, created_by: activeSession.user.id })
        .select('id,name')
        .single();

      if (error) {
        setNotice(`${error.message}. Run the latest Supabase migration, then refresh.`);
        setBusy(false);
        return null;
      }
      current = created;
    }

    setWorkspace(current);
    await loadDocuments(current.id);
    setNotice('Workspace ready');
    setBusy(false);
    return current;
  }

  async function loadDocuments(workspaceId: string) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('documents')
      .select('id,name,status,mime_type,created_at,size_bytes')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) setNotice(error.message);
    else setDocuments((data ?? []) as DocumentRow[]);
  }

  async function getActiveContext() {
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setNotice(error.message);
      return null;
    }
    const activeSession = data.session;
    setSession(activeSession);
    setAuthReady(true);
    if (!activeSession) return null;
    const activeWorkspace = workspace ?? await ensureWorkspace(activeSession);
    if (!activeWorkspace) return null;
    return { activeSession, activeWorkspace };
  }

  async function requestFilePicker() {
    if (!authReady) {
      setNotice('Restoring your secure session…');
      return;
    }
    const context = await getActiveContext();
    if (!context) {
      openAuth('signin');
      return;
    }
    fileInputRef.current?.click();
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthFeedback(null);
    if (!supabase) return setAuthFeedback({ kind: 'error', title: 'Connection unavailable', message: 'Supabase environment variables are missing.' });

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setAuthFeedback({ kind: 'error', title: 'Email required', message: 'Enter the email address you want to use.' });
    if (password.length < 8) return setAuthFeedback({ kind: 'error', title: 'Password is too short', message: 'Use at least 8 characters for your password.' });
    if (authMode === 'signup' && password !== confirmPassword) return setAuthFeedback({ kind: 'error', title: 'Passwords do not match', message: 'Re-enter the same password in both fields.' });

    setBusy(true);
    setAuthFeedback({ kind: 'info', title: authMode === 'signin' ? 'Signing you in…' : 'Creating your account…', message: 'Securing your workspace.' });

    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email: cleanEmail, password, options: { emailRedirectTo: `${window.location.origin}/auth/confirmed` } })
      : await supabase.auth.signInWithPassword({ email: cleanEmail, password });

    setBusy(false);
    if (result.error) return setAuthFeedback({ kind: 'error', title: authMode === 'signin' ? 'Unable to sign in' : 'Unable to create account', message: result.error.message });

    if (authMode === 'signup' && !result.data.session) {
      setAuthFeedback({ kind: 'success', title: 'Check your email', message: `A confirmation link was sent to ${cleanEmail}. Open it to activate your account.` });
      setPassword('');
      setConfirmPassword('');
      return;
    }

    setSession(result.data.session);
    setAuthFeedback({ kind: 'success', title: 'You are signed in', message: 'Opening your private intelligence workspace.' });
    setNotice('Signed in successfully');
    window.setTimeout(() => setAuthOpen(false), 650);
  }

  async function resendConfirmation() {
    if (!supabase || !email.trim()) return;
    setBusy(true);
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase(), options: { emailRedirectTo: `${window.location.origin}/auth/confirmed` } });
    setBusy(false);
    setAuthFeedback(error ? { kind: 'error', title: 'Email not sent', message: error.message } : { kind: 'success', title: 'Confirmation sent', message: `A new confirmation link was sent to ${email.trim().toLowerCase()}.` });
  }

  async function sendPasswordReset() {
    if (!supabase || !email.trim()) return setAuthFeedback({ kind: 'error', title: 'Enter your email', message: 'Enter your email address first.' });
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${window.location.origin}/auth/confirmed?mode=recovery` });
    setBusy(false);
    setAuthFeedback(error ? { kind: 'error', title: 'Reset email not sent', message: error.message } : { kind: 'success', title: 'Check your email', message: 'We sent a secure password-reset link.' });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setNotice('Signed out');
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !supabase) return;

    const allowed = ['application/pdf', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'image/png', 'image/jpeg'];
    if (file.type && !allowed.includes(file.type)) {
      setNotice('Unsupported file. Upload PDF, DOCX, XLSX, CSV, TXT, PNG or JPG.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setNotice('This file is larger than the 25 MB upload limit.');
      return;
    }

    const context = await getActiveContext();
    if (!context) {
      openAuth('signin');
      return;
    }

    setBusy(true);
    setNotice(`Uploading ${file.name}…`);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `${context.activeWorkspace.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('rag-documents').upload(storagePath, file, { upsert: false });

    if (uploadError) {
      setNotice(uploadError.message);
      setBusy(false);
      return;
    }

    const { error: documentError } = await supabase.from('documents').insert({
      workspace_id: context.activeWorkspace.id,
      name: file.name,
      source_type: 'file',
      storage_path: storagePath,
      mime_type: file.type || null,
      size_bytes: file.size,
      status: 'pending',
      created_by: context.activeSession.user.id,
    });

    if (documentError) setNotice(documentError.message);
    else {
      setNotice(`${file.name} was added successfully.`);
      await loadDocuments(context.activeWorkspace.id);
      setPanel('sources');
    }
    setBusy(false);
  }

  async function sendMessage() {
    const text = prompt.trim();
    if (!text || !supabase) return;
    const context = await getActiveContext();
    if (!context) return openAuth('signin');

    setPrompt('');
    setBusy(true);
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((current) => [...current, userMessage]);

    let activeConversation = conversationId;
    if (!activeConversation) {
      const { data, error } = await supabase.from('conversations').insert({ workspace_id: context.activeWorkspace.id, title: text.slice(0, 80), created_by: context.activeSession.user.id }).select('id').single();
      if (error) { setNotice(error.message); setBusy(false); return; }
      activeConversation = data.id;
      setConversationId(data.id);
    }

    await supabase.from('messages').insert({ conversation_id: activeConversation, workspace_id: context.activeWorkspace.id, role: 'user', content: text });
    const response = documents.length
      ? `Your question is saved and connected to ${documents.length} source${documents.length === 1 ? '' : 's'}. Retrieval and generation are the next backend integration.`
      : 'Your question is saved. Add a source to begin grounded retrieval.';
    const assistantMessage: Message = { id: crypto.randomUUID(), role: 'assistant', content: response };
    setMessages((current) => [...current, assistantMessage]);
    await supabase.from('messages').insert({ conversation_id: activeConversation, workspace_id: context.activeWorkspace.id, role: 'assistant', content: response, metadata: { stage: 'frontend-foundation' } });
    setBusy(false);
  }

  function newChat() {
    setConversationId(null);
    setMessages([]);
    setPrompt('');
    setPanel('chat');
  }

  const [eyebrow, title] = panelTitles[panel];

  return (
    <main className="app-shell">
      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg" onChange={uploadFile} />

      <aside className="app-sidebar">
        <button className="app-brand" type="button" onClick={newChat} aria-label="Open new chat">
          <span className="brand-glyph">R</span>
          <div><strong>RAG</strong><small>Private intelligence</small></div>
        </button>

        <nav className="app-nav" aria-label="Workspace navigation">
          {([
            ['chat', '✦', 'Ask'], ['sources', '▱', 'Sources'], ['graph', '⌘', 'Graph'], ['history', '↗', 'History'], ['settings', '··', 'Settings'],
          ] as [Panel, string, string][]).map(([id, icon, label]) => (
            <button key={id} type="button" className={panel === id ? 'active' : ''} onClick={() => setPanel(id)}><span>{icon}</span>{label}</button>
          ))}
        </nav>

        <div className="sidebar-account">
          <span className={session ? 'status-live' : 'status-offline'} />
          <div><strong>{session?.user.email ?? (authReady ? 'Guest' : 'Restoring session')}</strong><small>{session ? 'Private workspace active' : 'Sign in to save your work'}</small></div>
        </div>
      </aside>

      <section className="app-main">
        <header className="app-topbar">
          <div className="topbar-title"><span>{eyebrow}</span><h1>{title}</h1></div>
          <div className="topbar-actions">
            {notice && <span className="inline-notice">{busy && <i />} {notice}</span>}
            {session ? <button className="quiet-button" type="button" onClick={signOut}>Sign out</button> : <button className="quiet-button" type="button" onClick={() => openAuth('signin')}>{authReady ? 'Sign in' : 'Loading…'}</button>}
            <button className="primary-button" type="button" onClick={newChat}>New chat <span>＋</span></button>
          </div>
        </header>

        {panel === 'chat' && (
          <div className="chat-stage">
            <div className="message-stream">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="hero-orbit"><span /><span /><b>✦</b></div>
                  <span className="hero-kicker">One workspace. Every source.</span>
                  <h2>Think beyond<br /><em>the document.</em></h2>
                  <p>Upload research, reports and data. Ask one clear question and build understanding across all of it.</p>
                  <div className="workspace-stats"><span><b>{documents.length}</b> sources</span><span><b>{session ? 'On' : 'Off'}</b> secure sync</span><span><b>25 MB</b> per file</span></div>
                </div>
              ) : messages.map((message) => <article key={message.id} className={`message-card ${message.role}`}><span>{message.role === 'user' ? 'You' : 'RAG'}</span><p>{message.content}</p></article>)}
            </div>

            <div className="composer-zone">
              <div className="composer-wrap">
                <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Ask a precise question…" rows={3} />
                <div className="composer-toolbar">
                  <button type="button" className="attach-button" disabled={busy || !authReady} onClick={() => void requestFilePicker()}>＋ Attach</button>
                  <span>{documents.length ? `${documents.length} connected` : 'PDF · DOCX · XLSX · CSV'}</span>
                  <button type="button" className="send-button" disabled={busy || !prompt.trim()} onClick={() => void sendMessage()} aria-label="Send question">↑</button>
                </div>
              </div>
              <div className="suggestion-row">{suggestions.map((item) => <button type="button" key={item} onClick={() => setPrompt(item)}>{item}</button>)}</div>
            </div>
          </div>
        )}

        {panel === 'sources' && (
          <div className="panel-content">
            <div className="panel-toolbar"><div><span>Knowledge inventory</span><h2>{documents.length ? `${documents.length} connected source${documents.length === 1 ? '' : 's'}` : 'Start with a source'}</h2><p>Private files stored inside your workspace-scoped Supabase bucket.</p></div><button className="primary-button" type="button" disabled={busy || !authReady} onClick={() => void requestFilePicker()}>Upload source <span>＋</span></button></div>
            <div className="source-grid">
              {documents.length ? documents.map((document, index) => <article className="source-card" key={document.id}><div className="source-index">{String(index + 1).padStart(2, '0')}</div><div><strong>{document.name}</strong><small>{document.mime_type || 'Document'} · {new Date(document.created_at).toLocaleDateString('en-IN')}</small></div><span className={`source-status ${document.status}`}>{document.status}</span></article>) : <button className="empty-panel" type="button" onClick={() => void requestFilePicker()}><span>＋</span><strong>Drop knowledge into the workspace</strong><small>Upload PDF, DOCX, XLSX, CSV, TXT, PNG or JPG up to 25 MB.</small></button>}
            </div>
          </div>
        )}

        {panel === 'graph' && <div className="panel-content graph-panel"><div className="graph-visual"><i /><i /><i /><b>R</b></div><div><span className="panel-kicker">Relationship layer</span><h2>Your knowledge will become visible.</h2><p>Entities, topics and relationships will appear after the ingestion pipeline processes your connected sources.</p></div></div>}
        {panel === 'history' && <div className="panel-content"><div className="editorial-empty"><span>History / 00</span><h2>Past thinking,<br />ready to resume.</h2><p>Your messages are already persisted in Supabase. Searchable conversation cards are the next module.</p></div></div>}
        {panel === 'settings' && <div className="panel-content"><div className="settings-grid"><article><span>Database</span><strong>{supabase ? 'Configured' : 'Missing variables'}</strong><small>Supabase project connection</small></article><article><span>Authentication</span><strong>{session ? 'Active' : 'Guest'}</strong><small>{session?.user.email ?? 'No active user'}</small></article><article><span>Workspace</span><strong>{workspace?.name ?? 'Initialising'}</strong><small>Private tenant boundary</small></article><article><span>Storage</span><strong>rag-documents</strong><small>Workspace-scoped private bucket</small></article></div></div>}
      </section>

      {authOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !busy && setAuthOpen(false)}>
          <form className="auth-modal" onSubmit={submitAuth} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" aria-label="Close" disabled={busy} onClick={() => setAuthOpen(false)}>×</button>
            <div className="auth-brand"><span className="brand-glyph">R</span><div><strong>RAG</strong><small>Private intelligence workspace</small></div></div>
            <span className="section-kicker">Secure access</span>
            <h2>{authMode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h2>
            <p>{authMode === 'signin' ? 'Continue to your private workspace.' : 'Save conversations, upload sources and build connected knowledge.'}</p>
            {authFeedback && <div className={`auth-feedback ${authFeedback.kind}`} role="status"><span>{authFeedback.kind === 'success' ? '✓' : authFeedback.kind === 'error' ? '!' : '↻'}</span><div><strong>{authFeedback.title}</strong><p>{authFeedback.message}</p></div></div>}
            <label>Email address<input type="email" required autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => { setEmail(event.target.value); setAuthFeedback(null); }} /></label>
            <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} placeholder="At least 8 characters" value={password} onChange={(event) => { setPassword(event.target.value); setAuthFeedback(null); }} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
            {authMode === 'signup' && <label>Confirm password<input type={showPassword ? 'text' : 'password'} required minLength={8} autoComplete="new-password" placeholder="Repeat your password" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setAuthFeedback(null); }} /></label>}
            {authMode === 'signin' && <button className="forgot-button" type="button" disabled={busy} onClick={() => void sendPasswordReset()}>Forgot password?</button>}
            <button className="primary-button full auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in securely' : 'Create account'}</button>
            {authMode === 'signup' && authFeedback?.kind === 'success' && <button className="quiet-button full" type="button" disabled={busy} onClick={() => void resendConfirmation()}>Resend confirmation email</button>}
            <div className="auth-switch"><span>{authMode === 'signin' ? 'New here?' : 'Already registered?'}</span><button className="text-button" type="button" disabled={busy} onClick={switchAuthMode}>{authMode === 'signin' ? 'Create an account' : 'Sign in instead'}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
