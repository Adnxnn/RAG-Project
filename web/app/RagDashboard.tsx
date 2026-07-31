'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import './rag-dashboard.css';

type Conversation = { id: string; title: string; created_at: string };
type Doc = {
  id: string;
  name: string;
  status: string;
  mime_type: string | null;
  created_at: string;
  conversation_id?: string | null;
  storage_path?: string | null;
  error?: string | null;
};
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

function statusLabel(doc: Doc) {
  if (doc.status === 'ready') return 'Ready';
  if (doc.status === 'processing') return 'Processing';
  if (doc.status === 'pending') return 'Waiting for backend';
  if (doc.status === 'failed') return 'Retry required';
  return doc.status;
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
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (session) void bootstrap();
    else {
      setWorkspace(null);
      setConversations([]);
      setDocuments([]);
      setMessages([]);
      setActiveId(null);
    }
  }, [session]);

  async function bootstrap() {
    if (!session) return;
    setNotice('Loading your workspace…');
    const { data: member, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id,workspaces(id,name)')
      .eq('user_id', session.user.id)
      .limit(1)
      .maybeSingle();

    if (memberError) {
      setNotice(memberError.message);
      return;
    }

    let ws = member?.workspaces as unknown as Workspace | null;
    if (!ws) {
      const { data: created, error } = await supabase
        .from('workspaces')
        .insert({
          name: 'Personal Intelligence',
          slug: `workspace-${session.user.id.slice(0, 8)}-${Date.now()}`,
          created_by: session.user.id,
        })
        .select('id,name')
        .single();

      if (error) {
        setNotice(error.message);
        return;
      }
      ws = created;
    }

    setWorkspace(ws);
    await loadConversations(ws.id);
    setNotice('');
  }

  async function loadConversations(workspaceId: string) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,created_at')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });

    if (error) {
      setNotice(error.message);
      return;
    }

    const rows = (data || []) as Conversation[];
    setConversations(rows);
    if (rows.length) await openConversation(rows[0].id, workspaceId);
    else await createConversation(workspaceId);
  }

  async function createConversation(workspaceId = workspace?.id) {
    if (!workspaceId || !session) {
      if (!session) setShowAuth(true);
      return;
    }

    const { data, error } = await supabase
      .from('conversations')
      .insert({ workspace_id: workspaceId, title: 'New conversation', created_by: session.user.id })
      .select('id,title,created_at')
      .single();

    if (error) {
      setNotice(error.message);
      return;
    }

    setConversations((current) => [data as Conversation, ...current]);
    setActiveId(data.id);
    setMessages([]);
    setDocuments([]);
    setNotice('');
  }

  async function openConversation(id: string, workspaceId = workspace?.id) {
    if (!workspaceId) return;
    setActiveId(id);

    const [{ data: msg, error: msgError }, { data: docs, error: docsError }] = await Promise.all([
      supabase.from('messages').select('id,role,content,citations,created_at').eq('conversation_id', id).order('created_at'),
      supabase
        .from('documents')
        .select('id,name,status,mime_type,created_at,conversation_id,storage_path,error')
        .eq('workspace_id', workspaceId)
        .eq('conversation_id', id)
        .order('created_at', { ascending: false }),
    ]);

    if (msgError || docsError) setNotice(msgError?.message || docsError?.message || 'Could not load conversation.');
    setMessages((msg || []) as Msg[]);
    setDocuments((docs || []) as Doc[]);
  }

  async function deleteConversation(id: string) {
    if (!confirm('Delete this conversation and all its files?')) return;
    const paths = documents.filter((doc) => doc.conversation_id === id && doc.storage_path).map((doc) => doc.storage_path!);
    if (paths.length) await supabase.storage.from('rag-documents').remove(paths);
    await fetch('/api/rag/conversations/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: id }),
    }).catch(() => null);
    await supabase.from('conversations').delete().eq('id', id);

    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (remaining[0]) await openConversation(remaining[0].id);
    else await createConversation();
  }

  async function ingestDocument(file: File, doc: Doc) {
    if (!workspace || !activeId) return false;

    const form = new FormData();
    form.append('files', file);
    form.append('workspace_id', workspace.id);
    form.append('conversation_id', activeId);
    form.append('document_id', doc.id);

    const response = await fetch('/api/rag/ingest', { method: 'POST', body: form });
    const payload = await response.json().catch(() => ({}));

    if (response.ok) {
      await supabase.from('documents').update({ status: 'ready', error: null }).eq('id', doc.id);
      setNotice(`${doc.name} is ready.`);
      return true;
    }

    const backendMissing = response.status === 503 || String(payload.error || '').includes('RAG_API_URL');
    await supabase
      .from('documents')
      .update({
        status: backendMissing ? 'pending' : 'failed',
        error: payload.error || 'Ingestion failed',
      })
      .eq('id', doc.id);

    setNotice(
      backendMissing
        ? `${doc.name} was uploaded and saved. Connect RAG_API_URL to process it.`
        : payload.error || 'Ingestion failed. Use Retry after checking the backend.',
    );
    return false;
  }

  async function uploadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;
    if (!session) {
      setShowAuth(true);
      return;
    }
    if (!workspace || !activeId) {
      setNotice('Create or open a conversation before adding a source.');
      return;
    }

    setBusy(true);
    setNotice(`Uploading ${file.name}…`);

    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
    const storagePath = `${workspace.id}/${activeId}/${crypto.randomUUID()}-${safe}`;
    const { error: uploadError } = await supabase.storage.from('rag-documents').upload(storagePath, file);

    if (uploadError) {
      setBusy(false);
      setNotice(`Storage upload failed: ${uploadError.message}`);
      return;
    }

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        workspace_id: workspace.id,
        conversation_id: activeId,
        name: file.name,
        source_type: 'file',
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size,
        status: 'processing',
        created_by: session.user.id,
      })
      .select('id,name,status,mime_type,created_at,conversation_id,storage_path,error')
      .single();

    if (error) {
      await supabase.storage.from('rag-documents').remove([storagePath]);
      setBusy(false);
      setNotice(`Document record failed: ${error.message}`);
      return;
    }

    await ingestDocument(file, doc as Doc);
    await openConversation(activeId);
    setBusy(false);
  }

  async function retryDocument(doc: Doc) {
    if (!doc.storage_path || !workspace || !activeId) return;
    setBusy(true);
    setNotice(`Preparing ${doc.name} for retry…`);

    const { data, error } = await supabase.storage.from('rag-documents').download(doc.storage_path);
    if (error || !data) {
      setBusy(false);
      setNotice(error?.message || 'Could not download the stored source for retry.');
      return;
    }

    const file = new File([data], doc.name, { type: doc.mime_type || data.type || 'application/octet-stream' });
    await supabase.from('documents').update({ status: 'processing', error: null }).eq('id', doc.id);
    await ingestDocument(file, doc);
    await openConversation(activeId);
    setBusy(false);
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();

    if (!session) {
      setShowAuth(true);
      return;
    }
    if (!text || !workspace || !activeId || busy) return;

    setPrompt('');
    setBusy(true);
    setNotice('Searching your sources…');

    const user: Msg = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages((current) => [...current, user]);
    await supabase.from('messages').insert({ conversation_id: activeId, workspace_id: workspace.id, role: 'user', content: text });

    if (messages.length === 0) {
      const title = text.slice(0, 60);
      await supabase.from('conversations').update({ title, updated_at: new Date().toISOString() }).eq('id', activeId);
      setConversations((current) => current.map((conversation) => (conversation.id === activeId ? { ...conversation, title } : conversation)));
    }

    const response = await fetch('/api/rag/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: text, workspace_id: workspace.id, conversation_id: activeId }),
    });
    const payload = await response.json().catch(() => ({}));

    const assistant: Msg = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: response.ok ? payload.answer : payload.error || 'The RAG backend is unavailable.',
      citations: payload.citations || [],
    };

    setMessages((current) => [...current, assistant]);
    await supabase.from('messages').insert({
      conversation_id: activeId,
      workspace_id: workspace.id,
      role: 'assistant',
      content: assistant.content,
      citations: assistant.citations || [],
    });

    setNotice(response.ok ? '' : assistant.content);
    setBusy(false);
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setNotice(error.message);
    else setShowAuth(false);
  }

  const active = conversations.find((conversation) => conversation.id === activeId);
  const shown = conversations.filter((conversation) => conversation.title.toLowerCase().includes(search.toLowerCase()));
  const citations = [...messages].reverse().find((message) => message.role === 'assistant' && message.citations?.length)?.citations || [];

  return (
    <main className="rag-app">
      <aside className="rag-left">
        <div className="rag-brand"><span className="rag-logo">✣</span><b>RAG Assistant</b><button aria-label="menu">☰</button></div>
        <button className="new-chat" onClick={() => createConversation()}>＋ New Chat</button>
        <div className="searchbox">⌕<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations…" /></div>
        <div className="section-label">Conversations</div>
        <div className="conversation-list">
          {shown.map((conversation) => (
            <button key={conversation.id} className={activeId === conversation.id ? 'conversation active' : 'conversation'} onClick={() => openConversation(conversation.id)}>
              <span>▱</span>
              <div><b>{conversation.title}</b><small>{activeId === conversation.id ? documents.length : 0} sources</small></div>
              <i onClick={(event) => { event.stopPropagation(); void deleteConversation(conversation.id); }}>⋯</i>
            </button>
          ))}
        </div>
        <div className="left-bottom">
          <div className="storage-card"><div><span>Storage</span><b>Private workspace</b></div><div className="meter"><i /></div><button onClick={() => inputRef.current?.click()}>Manage Sources</button></div>
          <div className="profile-card"><span className="avatar">{session?.user.email?.[0]?.toUpperCase() || 'A'}</span><div><b>{session?.user.email?.split('@')[0] || 'Guest'}</b><small>{session?.user.email || 'Sign in to continue'}</small></div><button onClick={() => session ? supabase.auth.signOut() : setShowAuth(true)}>{session ? '↗' : 'Sign in'}</button></div>
        </div>
      </aside>

      <section className="rag-center">
        <header className="chat-head"><div><h1>{active?.title || 'New conversation'}</h1><p>{documents.length} sources · Private</p></div><div><button>Share</button><button>•••</button><span className="private-pill">🛡 Private</span></div></header>
        <div className="source-strip">
          {documents.slice(0, 3).map((doc) => (
            <button key={doc.id} onClick={() => doc.status !== 'ready' && retryDocument(doc)} title={doc.error || statusLabel(doc)}>
              <span className={`file-icon ${iconFor(doc.name).toLowerCase()}`}>{iconFor(doc.name)}</span>
              <div><b>{doc.name}</b><small>{statusLabel(doc)}</small></div>
            </button>
          ))}
          <button className="add-source" onClick={() => inputRef.current?.click()}>＋ Add source</button>
        </div>

        <div className="chat-scroll">
          {!messages.length && <div className="empty-state"><span className="empty-logo">✣</span><h2>Ask anything about your sources</h2><p>Upload documents, spreadsheets, images, or notes. Answers stay grounded in the current conversation.</p></div>}
          {messages.map((message) => <article key={message.id} className={`message ${message.role}`}><span className="message-avatar">{message.role === 'user' ? 'A' : '✣'}</span><div className="bubble"><div className="content">{message.content}</div>{message.role === 'assistant' && <div className="message-actions">⧉　♡　↻</div>}</div></article>)}
          {busy && <article className="message assistant"><span className="message-avatar">✣</span><div className="bubble typing">Working<span>•••</span></div></article>}
        </div>

        {citations.length > 0 && <div className="citation-row"><b>Sources ({citations.length})</b><div>{citations.slice(0, 4).map((citation, index) => <span key={index}><small>{citation.file_name || 'Source'}</small><em>{citation.locator || 'Retrieved evidence'}</em></span>)}</div></div>}
        <form className="composer" onSubmit={send}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder="Ask a follow-up question…" /><div><button type="button" onClick={() => inputRef.current?.click()}>⌕ Add source</button><button className="send" disabled={busy}>➤</button></div></form>
        <div className="mode-row"><button>◎ Hybrid Search</button><button>⌘ Conversation Memory</button><span>{notice}</span></div>
      </section>

      <aside className="rag-right">
        <div className="right-card">
          <div className="right-title"><b>Sources</b><button onClick={() => inputRef.current?.click()}>Add</button></div>
          {documents.length ? documents.map((doc) => (
            <div className="right-source" key={doc.id}>
              <span className={`file-icon ${iconFor(doc.name).toLowerCase()}`}>{iconFor(doc.name)}</span>
              <div><b>{doc.name}</b><small>{statusLabel(doc)}</small></div>
              {doc.status === 'ready' ? <em>Ready</em> : <button onClick={() => retryDocument(doc)} disabled={busy}>Retry</button>}
            </div>
          )) : <p className="muted">No sources in this conversation.</p>}
        </div>
        <div className="right-card"><b>Retrieval Info</b><dl><dt>Query type</dt><dd>Hybrid search</dd><dt>Scope</dt><dd>Current conversation</dd><dt>Sources</dt><dd>{documents.length}</dd><dt>Ready</dt><dd>{documents.filter((doc) => doc.status === 'ready').length}</dd><dt>Citations</dt><dd>{citations.length}</dd></dl></div>
        <div className="right-card graph-card"><b>Graph View</b><div className="graph"><i /><i /><i /><i /><i /><i /><i /></div></div>
      </aside>

      <input ref={inputRef} hidden type="file" accept={accepted} onChange={uploadFile} />
      {showAuth && <div className="modal-backdrop"><form className="auth-modal" onSubmit={signIn}><button type="button" className="close" onClick={() => setShowAuth(false)}>×</button><span className="rag-logo">✣</span><h2>Sign in to RAG Assistant</h2><input type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required /><input type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="new-chat" disabled={busy}>Sign in</button></form></div>}
    </main>
  );
}
