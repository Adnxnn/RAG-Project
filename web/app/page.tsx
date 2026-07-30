'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type Panel = 'chat' | 'sources' | 'graph' | 'history' | 'settings';
type Message = { id: string; role: 'user' | 'assistant'; content: string };
type DocumentRow = { id: string; name: string; status: string; mime_type: string | null; created_at: string };

type WorkspaceRow = { id: string; name: string };

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
    if (!supabase) return setNotice('Supabase environment variables are missing.');
    setBusy(true);
    const result = authMode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) return setNotice(result.error.message);
    setAuthOpen(false);
    setNotice(authMode === 'signup' && !result.data.session ? 'Check your email to confirm your account.' : 'Signed in successfully');
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
      setAuthOpen(true);
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
      setAuthOpen(true);
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
            {session ? <button className="quiet-button" type="button" onClick={signOut}>Sign out</button> : <button className="primary-button" type="button" onClick={() => setAuthOpen(true)}>Sign in</button>}
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
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setAuthOpen(false)}>
          <form className="auth-modal" onSubmit={submitAuth} onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setAuthOpen(false)}>×</button>
            <span className="section-kicker">Secure access</span>
            <h2>{authMode === 'signin' ? 'Welcome back' : 'Create your workspace'}</h2>
            <p>Use your email and password. Your session is managed securely by Supabase.</p>
            <label>Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" required minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button className="primary-button full" type="submit" disabled={busy}>{busy ? 'Please wait…' : authMode === 'signin' ? 'Sign in' : 'Create account'}</button>
            <button className="text-button" type="button" onClick={() => setAuthMode(authMode === 'signin' ? 'signup' : 'signin')}>{authMode === 'signin' ? 'Create a new account' : 'Already have an account'}</button>
          </form>
        </div>
      )}
    </main>
  );
}
