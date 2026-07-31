'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type Panel = 'chat' | 'sources' | 'history' | 'settings';
type Workspace = { id: string; name: string };
type Conversation = { id: string; title: string; created_at: string; updated_at: string };
type DocumentRow = { id: string; name: string; status: string; mime_type: string | null; created_at: string };
type Citation = { source_id: string; file_name: string; locator: string; url?: string | null };
type Message = { id: string; role: 'user' | 'assistant'; content: string; citations?: Citation[] };

type AuthFeedback = {
  kind: 'success' | 'error' | 'info';
  title: string;
  message: string;
} | null;

const allowedTypes = [
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
];

const suggestions = ['Summarise the attached sources', 'Compare the documents', 'Find contradictions'];

export default function HomePage() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [panel, setPanel] = useState<Panel>('chat');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [authFeedback, setAuthFeedback] = useState<AuthFeedback>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setNotice(error.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (!nextSession) resetPrivateState();
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (session) void initialiseAccount(session);
  }, [session]);

  function resetPrivateState() {
    setWorkspace(null);
    setConversations([]);
    setConversationId(null);
    setDocuments([]);
    setMessages([]);
  }

  async function initialiseAccount(activeSession: Session) {
    setNotice('Preparing your private account…');
    const { data: memberships, error: membershipError } = await supabase
      .from('workspace_members')
      .select('workspace_id, workspaces(id,name)')
      .eq('user_id', activeSession.user.id)
      .limit(1);

    if (membershipError) {
      setNotice(`Workspace access failed: ${membershipError.message}`);
      return;
    }

    let current = memberships?.[0]?.workspaces as unknown as Workspace | null;
    if (!current) {
      const { data: created, error } = await supabase
        .from('workspaces')
        .insert({
          name: 'Personal Intelligence',
          slug: `workspace-${activeSession.user.id.slice(0, 8)}-${Date.now().toString(36)}`,
          created_by: activeSession.user.id,
        })
        .select('id,name')
        .single();
      if (error) {
        setNotice(`Workspace setup failed: ${error.message}`);
        return;
      }
      current = created;
    }

    setWorkspace(current);
    await loadConversations(current.id);
    setNotice('Ready');
  }

  async function loadConversations(workspaceId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,created_at,updated_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) {
      setNotice(error.message);
      return;
    }
    setConversations((data ?? []) as Conversation[]);
  }

  async function createConversation(title = 'New conversation'): Promise<string | null> {
    if (!session || !workspace) return null;
    const { data, error } = await supabase
      .from('conversations')
      .insert({ workspace_id: workspace.id, title, created_by: session.user.id })
      .select('id,title,created_at,updated_at')
      .single();
    if (error) {
      setNotice(error.message);
      return null;
    }
    setConversations((current) => [data as Conversation, ...current]);
    setConversationId(data.id);
    setDocuments([]);
    setMessages([]);
    setPanel('chat');
    return data.id;
  }

  async function openConversation(id: string) {
    setBusy(true);
    setConversationId(id);
    setPanel('chat');
    const [{ data: docs, error: docsError }, { data: history, error: historyError }] = await Promise.all([
      supabase
        .from('documents')
        .select('id,name,status,mime_type,created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('messages')
        .select('id,role,content,citations')
        .eq('conversation_id', id)
        .in('role', ['user', 'assistant'])
        .order('created_at', { ascending: true }),
    ]);
    if (docsError || historyError) setNotice(docsError?.message ?? historyError?.message ?? 'Unable to open chat.');
    setDocuments((docs ?? []) as DocumentRow[]);
    setMessages((history ?? []) as Message[]);
    setBusy(false);
  }

  async function ensureConversation(title?: string) {
    return conversationId ?? createConversation(title);
  }

  async function requestFilePicker() {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    const id = await ensureConversation('New conversation');
    if (id) fileInputRef.current?.click();
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !session || !workspace) return;
    if (file.type && !allowedTypes.includes(file.type)) {
      setNotice('Upload PDF, DOCX, XLSX, CSV, TXT, PNG or JPG.');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setNotice('The file exceeds the 25 MB limit.');
      return;
    }

    const activeConversation = await ensureConversation(file.name);
    if (!activeConversation) return;
    setBusy(true);
    setNotice(`Uploading and indexing ${file.name}…`);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `${workspace.id}/${activeConversation}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('rag-documents').upload(storagePath, file);
    if (uploadError) {
      setNotice(`Upload failed: ${uploadError.message}`);
      setBusy(false);
      return;
    }

    const { data: document, error: documentError } = await supabase
      .from('documents')
      .insert({
        workspace_id: workspace.id,
        conversation_id: activeConversation,
        name: file.name,
        source_type: 'file',
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
        status: 'processing',
        created_by: session.user.id,
      })
      .select('id,name,status,mime_type,created_at')
      .single();

    if (documentError) {
      await supabase.storage.from('rag-documents').remove([storagePath]);
      setNotice(`File record failed: ${documentError.message}`);
      setBusy(false);
      return;
    }

    setDocuments((current) => [document as DocumentRow, ...current]);
    const formData = new FormData();
    formData.append('files', file);
    formData.append('conversation_id', activeConversation);
    const response = await fetch('/api/rag/ingest', { method: 'POST', body: formData });
    const payload = await response.json();
    const status = response.ok ? 'ready' : 'failed';
    await supabase.from('documents').update({ status, error: response.ok ? null : payload.error ?? payload.detail }).eq('id', document.id);
    setDocuments((current) => current.map((item) => item.id === document.id ? { ...item, status } : item));
    setNotice(response.ok ? `${file.name} is ready in this chat.` : `Indexing failed: ${payload.error ?? payload.detail ?? 'Backend unavailable.'}`);
    setBusy(false);
  }

  async function sendMessage() {
    const question = prompt.trim();
    if (!question || !session || !workspace) {
      if (!session) setAuthOpen(true);
      return;
    }
    const activeConversation = await ensureConversation(question.slice(0, 80));
    if (!activeConversation) return;
    setPrompt('');
    setBusy(true);
    const optimistic: Message = { id: crypto.randomUUID(), role: 'user', content: question };
    setMessages((current) => [...current, optimistic]);
    await supabase.from('messages').insert({
      conversation_id: activeConversation,
      workspace_id: workspace.id,
      role: 'user',
      content: question,
    });

    const response = await fetch('/api/rag/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, conversation_id: activeConversation }),
    });
    const payload = await response.json();
    const answer = response.ok ? payload.answer : `Unable to answer: ${payload.error ?? payload.detail ?? 'RAG backend unavailable.'}`;
    const assistant: Message = { id: crypto.randomUUID(), role: 'assistant', content: answer, citations: payload.citations ?? [] };
    setMessages((current) => [...current, assistant]);
    await supabase.from('messages').insert({
      conversation_id: activeConversation,
      workspace_id: workspace.id,
      role: 'assistant',
      content: answer,
      citations: payload.citations ?? [],
      metadata: { route: payload.route, retries: payload.retries },
    });
    await supabase.from('conversations').update({ updated_at: new Date().toISOString(), title: question.slice(0, 80) }).eq('id', activeConversation);
    await loadConversations(workspace.id);
    setNotice(response.ok ? 'Answer generated from this chat only.' : answer);
    setBusy(false);
  }

  async function deleteConversation(id: string) {
    if (!workspace || !confirm('Delete this chat, its sources and messages?')) return;
    setBusy(true);
    const { data: files } = await supabase.from('documents').select('storage_path').eq('conversation_id', id);
    const paths = (files ?? []).map((item) => item.storage_path).filter(Boolean) as string[];
    if (paths.length) await supabase.storage.from('rag-documents').remove(paths);
    await fetch(`/api/rag/conversations/${id}`, { method: 'DELETE' }).catch(() => undefined);
    const { error } = await supabase.from('conversations').delete().eq('id', id);
    if (error) setNotice(error.message);
    if (conversationId === id) {
      setConversationId(null);
      setDocuments([]);
      setMessages([]);
    }
    await loadConversations(workspace.id);
    setBusy(false);
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthFeedback(null);
    if (password.length < 8) {
      setAuthFeedback({ kind: 'error', title: 'Password too short', message: 'Use at least 8 characters.' });
      return;
    }
    if (authMode === 'signup' && password !== confirmPassword) {
      setAuthFeedback({ kind: 'error', title: 'Passwords do not match', message: 'Enter the same password twice.' });
      return;
    }
    setBusy(true);
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/auth/confirmed` } })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (result.error) {
      setAuthFeedback({ kind: 'error', title: 'Authentication failed', message: result.error.message });
      return;
    }
    if (!result.data.session) {
      setAuthFeedback({ kind: 'success', title: 'Check your email', message: 'Open the confirmation link to activate your account.' });
      return;
    }
    setAuthFeedback({ kind: 'success', title: 'Signed in', message: 'Your private chats are ready.' });
    window.setTimeout(() => setAuthOpen(false), 500);
  }

  const activeConversation = conversations.find((item) => item.id === conversationId);

  return (
    <main className="app-shell">
      <input ref={fileInputRef} className="visually-hidden" type="file" accept=".pdf,.docx,.xlsx,.csv,.txt,.png,.jpg,.jpeg" onChange={uploadFile} />
      <aside className="app-sidebar">
        <button className="app-brand" type="button" onClick={() => void createConversation()}><span className="brand-glyph">R</span><div><strong>RAG</strong><small>Chat-scoped intelligence</small></div></button>
        <button className="primary-button full" type="button" disabled={!session || busy} onClick={() => void createConversation()}>New chat <span>＋</span></button>
        <nav className="app-nav" aria-label="Navigation">
          <button className={panel === 'chat' ? 'active' : ''} onClick={() => setPanel('chat')}><span>✦</span>Chat</button>
          <button className={panel === 'sources' ? 'active' : ''} onClick={() => setPanel('sources')}><span>▱</span>Sources</button>
          <button className={panel === 'history' ? 'active' : ''} onClick={() => setPanel('history')}><span>↗</span>History</button>
          <button className={panel === 'settings' ? 'active' : ''} onClick={() => setPanel('settings')}><span>··</span>Settings</button>
        </nav>
        <div className="conversation-list">
          {conversations.map((item) => <div key={item.id} className={item.id === conversationId ? 'conversation-item active' : 'conversation-item'}><button type="button" onClick={() => void openConversation(item.id)}><strong>{item.title}</strong><small>{new Date(item.updated_at).toLocaleDateString('en-IN')}</small></button><button type="button" aria-label="Delete chat" onClick={() => void deleteConversation(item.id)}>×</button></div>)}
        </div>
        <div className="sidebar-account"><span className={session ? 'status-live' : 'status-offline'} /><div><strong>{session?.user.email ?? 'Guest'}</strong><small>{session ? 'Private session active' : 'Sign in to continue'}</small></div></div>
      </aside>

      <section className="app-main">
        <header className="app-topbar"><div className="topbar-title"><span>{activeConversation ? 'Current chat' : 'Private intelligence'}</span><h1>{activeConversation?.title ?? 'Start a new conversation'}</h1></div><div className="topbar-actions">{notice && <span className="inline-notice">{busy && <i />} {notice}</span>}{session ? <button className="quiet-button" onClick={() => void supabase.auth.signOut()}>Sign out</button> : <button className="quiet-button" disabled={authLoading} onClick={() => setAuthOpen(true)}>{authLoading ? 'Restoring…' : 'Sign in'}</button>}<button className="primary-button" onClick={() => void requestFilePicker()}>Attach <span>＋</span></button></div></header>

        {panel === 'chat' && <div className="chat-stage"><div className="message-stream">{messages.length ? messages.map((message) => <article key={message.id} className={`message-card ${message.role}`}><span>{message.role === 'user' ? 'You' : 'RAG'}</span><p>{message.content}</p>{Boolean(message.citations?.length) && <div className="citation-list">{message.citations?.map((citation, index) => <small key={`${citation.source_id}-${index}`}>[{index + 1}] {citation.file_name}{citation.locator ? ` · ${citation.locator}` : ''}</small>)}</div>}</article>) : <div className="empty-state"><div className="hero-orbit"><span /><span /><b>✦</b></div><span className="hero-kicker">One chat. Its own sources.</span><h2>Ask only what<br /><em>this thread knows.</em></h2><p>Files attached here remain isolated from every other conversation.</p><div className="workspace-stats"><span><b>{documents.length}</b> sources</span><span><b>{conversationId ? 'Isolated' : 'New'}</b> context</span><span><b>25 MB</b> per file</span></div></div>}</div><div className="composer-zone"><div className="composer-wrap"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder="Ask this chat…" rows={3} /><div className="composer-toolbar"><button className="attach-button" type="button" disabled={busy} onClick={() => void requestFilePicker()}>＋ Attach</button><span>{documents.length ? `${documents.length} source${documents.length === 1 ? '' : 's'} in this chat` : 'No sources attached'}</span><button className="send-button" disabled={busy || !prompt.trim()} onClick={() => void sendMessage()}>↑</button></div></div><div className="suggestion-row">{suggestions.map((item) => <button key={item} onClick={() => setPrompt(item)}>{item}</button>)}</div></div></div>}

        {panel === 'sources' && <div className="panel-content"><div className="panel-toolbar"><div><span>Current chat only</span><h2>{documents.length ? `${documents.length} attached source${documents.length === 1 ? '' : 's'}` : 'No sources yet'}</h2><p>These files are unavailable to every other conversation.</p></div><button className="primary-button" onClick={() => void requestFilePicker()}>Upload source <span>＋</span></button></div><div className="source-grid">{documents.map((document, index) => <article className="source-card" key={document.id}><div className="source-index">{String(index + 1).padStart(2, '0')}</div><div><strong>{document.name}</strong><small>{document.mime_type || 'Document'} · {new Date(document.created_at).toLocaleDateString('en-IN')}</small></div><span className={`source-status ${document.status}`}>{document.status}</span></article>)}</div></div>}
        {panel === 'history' && <div className="panel-content"><div className="editorial-empty"><span>History / {String(conversations.length).padStart(2, '0')}</span><h2>Independent chats,<br />cleanly separated.</h2><p>Select a conversation from the sidebar to restore its messages and attached sources.</p></div></div>}
        {panel === 'settings' && <div className="panel-content"><div className="settings-grid"><article><span>Account</span><strong>{session ? 'Authenticated' : 'Guest'}</strong><small>{session?.user.email ?? 'No active session'}</small></article><article><span>Retrieval boundary</span><strong>Conversation only</strong><small>No cross-chat document search</small></article><article><span>Active chat</span><strong>{conversationId ? 'Isolated' : 'Not selected'}</strong><small>{documents.length} attached source{documents.length === 1 ? '' : 's'}</small></article><article><span>Storage</span><strong>Private bucket</strong><small>Chat-scoped folder ownership</small></article></div></div>}
      </section>

      {authOpen && <div className="modal-backdrop" onMouseDown={() => !busy && setAuthOpen(false)}><form className="auth-modal" onSubmit={submitAuth} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" type="button" onClick={() => setAuthOpen(false)}>×</button><div className="auth-brand"><span className="brand-glyph">R</span><div><strong>RAG</strong><small>Private intelligence</small></div></div><span className="section-kicker">Secure access</span><h2>{authMode === 'signin' ? 'Welcome back.' : 'Create your account.'}</h2>{authFeedback && <div className={`auth-feedback ${authFeedback.kind}`}><span>{authFeedback.kind === 'error' ? '!' : '✓'}</span><div><strong>{authFeedback.title}</strong><p>{authFeedback.message}</p></div></div>}<label>Email address<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{authMode === 'signup' && <label>Confirm password<input type="password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}<button className="primary-button full auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in securely' : 'Create account'}</button><div className="auth-switch"><span>{authMode === 'signin' ? 'New here?' : 'Already registered?'}</span><button className="text-button" type="button" onClick={() => setAuthMode((current) => current === 'signin' ? 'signup' : 'signin')}>{authMode === 'signin' ? 'Create an account' : 'Sign in instead'}</button></div></form></div>}
    </main>
  );
}
