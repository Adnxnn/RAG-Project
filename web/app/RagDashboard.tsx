'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import './rag-dashboard.css';

type Conversation = { id: string; title: string; created_at: string };
type Doc = { id: string; name: string; status: string; mime_type: string | null; created_at: string; conversation_id?: string | null; storage_path?: string | null };
type Citation = { source_id?: string; file_name?: string; locator?: string; score?: number | null; url?: string | null };
type Msg = { id: string; role: 'user' | 'assistant'; content: string; citations?: Citation[]; created_at?: string };
type Workspace = { id: string; name: string };

const accepted = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg';

function iconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (['xls', 'xlsx', 'csv'].includes(ext || '')) return 'XLS';
  if (['png', 'jpg', 'jpeg'].includes(ext || '')) return 'IMG';
  if (['doc', 'docx'].includes(ext || '')) return 'DOC';
  return 'TXT';
}

export default function RagDashboard() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<Doc[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!session) return;
    void bootstrap();
  }, [session]);

  async function bootstrap() {
    if (!session) return;
    setNotice('Loading your workspace…');
    const { data: member } = await supabase.from('workspace_members').select('workspace_id,workspaces(id,name)').eq('user_id', session.user.id).limit(1).maybeSingle();
    let ws = member?.workspaces as unknown as Workspace | null;
    if (!ws) {
      const { data: created, error } = await supabase.from('workspaces').insert({ name: 'Personal Intelligence', slug: `workspace-${session.user.id.slice(0, 8)}-${Date.now()}`, created_by: session.user.id }).select('id,name').single();
      if (error) return setNotice(error.message);
      ws = created;
    }
    setWorkspace(ws);
    await loadConversations(ws.id);
    setNotice('');
  }

  async function loadConversations(workspaceId: string) {
    const { data } = await supabase.from('conversations').select('id,title,created_at').eq('workspace_id', workspaceId).order('updated_at', { ascending: false });
    const rows = (data || []) as Conversation[];
    setConversations(rows);
    if (rows.length) await openConversation(rows[0].id, workspaceId);
    else await createConversation(workspaceId);
  }

  async function createConversation(workspaceId = workspace?.id) {
    if (!workspaceId || !session) return;
    const { data, error } = await supabase.from('conversations').insert({ workspace_id: workspaceId, title: 'New conversation', created_by: session.user.id }).select('id,title,created_at').single();
    if (error) return setNotice(error.message);
    setConversations((v) => [data as Conversation, ...v]);
    setActiveId(data.id);
    setMessages([]);
    setDocuments([]);
  }

  async function openConversation(id: string, workspaceId = workspace?.id) {
    if (!workspaceId) return;
    setActiveId(id);
    const [{ data: msg }, { data: docs }] = await Promise.all([
      supabase.from('messages').select('id,role,content,citations,created_at').eq('conversation_id', id).order('created_at'),
      supabase.from('documents').select('id,name,status,mime_type,created_at,conversation_id,storage_path').eq('workspace_id', workspaceId).eq('conversation_id', id).order('created_at', { ascending: false }),
    ]);
    setMessages((msg || []) as Msg[]);
    setDocuments((docs || []) as Doc[]);
  }

  async function deleteConversation(id: string) {
    if (!confirm('Delete this conversation and all its files?')) return;
    const paths = documents.filter((d) => d.conversation_id === id && d.storage_path).map((d) => d.storage_path!)
    if (paths.length) await supabase.storage.from('rag-documents').remove(paths);
    await fetch('/api/rag/conversations/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversation_id: id }) }).catch(() => null);
    await supabase.from('conversations').delete().eq('id', id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (remaining[0]) await openConversation(remaining[0].id);
    else await createConversation();
  }

  async function uploadFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !session || !workspace || !activeId) return setShowAuth(!session);
    setBusy(true); setNotice(`Uploading ${file.name}…`);
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `${workspace.id}/${activeId}/${crypto.randomUUID()}-${safe}`;
    const { error: uploadError } = await supabase.storage.from('rag-documents').upload(storagePath, file);
    if (uploadError) { setBusy(false); return setNotice(uploadError.message); }
    const { data: doc, error } = await supabase.from('documents').insert({ workspace_id: workspace.id, conversation_id: activeId, name: file.name, source_type: 'file', storage_path: storagePath, mime_type: file.type || null, size_bytes: file.size, status: 'processing', created_by: session.user.id }).select().single();
    if (error) { setBusy(false); return setNotice(error.message); }
    const form = new FormData(); form.append('files', file); form.append('workspace_id', workspace.id); form.append('conversation_id', activeId); form.append('document_id', doc.id);
    const response = await fetch('/api/rag/ingest', { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));
    await supabase.from('documents').update({ status: response.ok ? 'ready' : 'failed', error: response.ok ? null : payload.error || 'Ingestion failed' }).eq('id', doc.id);
    await openConversation(activeId);
    setNotice(response.ok ? `${file.name} is ready.` : payload.error || 'Ingestion failed.');
    setBusy(false);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || !session || !workspace || !activeId || busy) { if (!session) setShowAuth(true); return; }
    setPrompt(''); setBusy(true); setNotice('Searching your sources…');
    const user: Msg = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((v) => [...v, user]);
    await supabase.from('messages').insert({ conversation_id: activeId, workspace_id: workspace.id, role: 'user', content: text });
    if (messages.length === 0) {
      const title = text.slice(0, 60);
      await supabase.from('conversations').update({ title, updated_at: new Date().toISOString() }).eq('id', activeId);
      setConversations((v) => v.map((c) => c.id === activeId ? { ...c, title } : c));
    }
    const response = await fetch('/api/rag/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text, workspace_id: workspace.id, conversation_id: activeId }) });
    const payload = await response.json().catch(() => ({}));
    const assistant: Msg = { id: crypto.randomUUID(), role: 'assistant', content: response.ok ? payload.answer : payload.error || 'The RAG backend is unavailable.', citations: payload.citations || [] };
    setMessages((v) => [...v, assistant]);
    await supabase.from('messages').insert({ conversation_id: activeId, workspace_id: workspace.id, role: 'assistant', content: assistant.content, citations: assistant.citations || [] });
    setNotice(response.ok ? '' : assistant.content); setBusy(false);
  }

  async function signIn(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false); if (error) setNotice(error.message); else setShowAuth(false);
  }

  const active = conversations.find((c) => c.id === activeId);
  const shown = conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()));
  const citations = [...messages].reverse().find((m) => m.role === 'assistant' && m.citations?.length)?.citations || [];

  return <main className="rag-app">
    <aside className="rag-left">
      <div className="rag-brand"><span className="rag-logo">✣</span><b>RAG Assistant</b><button aria-label="menu">☰</button></div>
      <button className="new-chat" onClick={() => createConversation()}>＋ New Chat</button>
      <div className="searchbox">⌕<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations…" /></div>
      <div className="section-label">Conversations</div>
      <div className="conversation-list">{shown.map((c) => <button key={c.id} className={activeId === c.id ? 'conversation active' : 'conversation'} onClick={() => openConversation(c.id)}><span>▱</span><div><b>{c.title}</b><small>{documents.filter((d) => d.conversation_id === c.id).length} sources</small></div><i onClick={(e) => { e.stopPropagation(); void deleteConversation(c.id); }}>⋯</i></button>)}</div>
      <div className="left-bottom"><div className="storage-card"><div><span>Storage</span><b>Private workspace</b></div><div className="meter"><i /></div><button onClick={() => inputRef.current?.click()}>Manage Sources</button></div><div className="profile-card"><span className="avatar">{session?.user.email?.[0]?.toUpperCase() || 'A'}</span><div><b>{session?.user.email?.split('@')[0] || 'Guest'}</b><small>{session?.user.email || 'Sign in to continue'}</small></div><button onClick={() => session ? supabase.auth.signOut() : setShowAuth(true)}>{session ? '↗' : 'Sign in'}</button></div></div>
    </aside>

    <section className="rag-center">
      <header className="chat-head"><div><h1>{active?.title || 'New conversation'}</h1><p>{documents.length} sources · Private</p></div><div><button>Share</button><button>•••</button><span className="private-pill">🛡 Private</span></div></header>
      <div className="source-strip">{documents.slice(0, 3).map((d) => <button key={d.id}><span className={`file-icon ${iconFor(d.name).toLowerCase()}`}>{iconFor(d.name)}</span><div><b>{d.name}</b><small>{d.status}</small></div></button>)}<button className="add-source" onClick={() => inputRef.current?.click()}>＋ Add source</button></div>
      <div className="chat-scroll">
        {!messages.length && <div className="empty-state"><span className="empty-logo">✣</span><h2>Ask anything about your sources</h2><p>Upload documents, spreadsheets, images, or notes. Answers stay grounded in the current conversation.</p></div>}
        {messages.map((m) => <article key={m.id} className={`message ${m.role}`}><span className="message-avatar">{m.role === 'user' ? 'A' : '✣'}</span><div className="bubble"><div className="content">{m.content}</div>{m.role === 'assistant' && <div className="message-actions">⧉　♡　↻</div>}</div></article>)}
        {busy && <article className="message assistant"><span className="message-avatar">✣</span><div className="bubble typing">Thinking across your sources<span>•••</span></div></article>}
      </div>
      {citations.length > 0 && <div className="citation-row"><b>Sources ({citations.length})</b><div>{citations.slice(0, 4).map((c, i) => <span key={i}><small>{c.file_name || 'Source'}</small><em>{c.locator || 'Retrieved evidence'}</em></span>)}</div></div>}
      <form className="composer" onSubmit={send}><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Ask a follow-up question…" /><div><button type="button" onClick={() => inputRef.current?.click()}>⌕ Add source</button><button className="send" disabled={busy}>➤</button></div></form>
      <div className="mode-row"><button>◎ Hybrid Search</button><button>⌘ Conversation Memory</button><span>{notice}</span></div>
    </section>

    <aside className="rag-right"><div className="right-card"><div className="right-title"><b>Sources</b><button onClick={() => inputRef.current?.click()}>Add</button></div>{documents.length ? documents.map((d) => <div className="right-source" key={d.id}><span className={`file-icon ${iconFor(d.name).toLowerCase()}`}>{iconFor(d.name)}</span><div><b>{d.name}</b><small>{d.status}</small></div><em>{d.status === 'ready' ? 'Ready' : '…'}</em></div>) : <p className="muted">No sources in this conversation.</p>}</div><div className="right-card"><b>Retrieval Info</b><dl><dt>Query type</dt><dd>Hybrid search</dd><dt>Scope</dt><dd>Current conversation</dd><dt>Sources</dt><dd>{documents.length}</dd><dt>Citations</dt><dd>{citations.length}</dd></dl></div><div className="right-card graph-card"><b>Graph View</b><div className="graph"><i /><i /><i /><i /><i /><i /><i /></div></div></aside>

    <input ref={inputRef} hidden type="file" accept={accepted} onChange={uploadFile} />
    {showAuth && <div className="modal-backdrop"><form className="auth-modal" onSubmit={signIn}><button type="button" className="close" onClick={() => setShowAuth(false)}>×</button><span className="rag-logo">✣</span><h2>Sign in to RAG Assistant</h2><input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required /><input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button className="new-chat" disabled={busy}>Sign in</button></form></div>}
  </main>;
}
