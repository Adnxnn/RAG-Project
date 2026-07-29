create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection_id uuid references public.collections(id) on delete set null,
  name text not null,
  source_type text not null default 'file',
  source_url text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  status text not null default 'pending' check (status in ('pending','processing','ready','failed','archived')),
  metadata jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection_id uuid references public.collections(id) on delete set null,
  chunk_index integer not null,
  kind text not null default 'text',
  content text not null,
  token_count integer,
  locator text,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique(document_id, chunk_index)
);

create index if not exists document_chunks_document_idx on public.document_chunks(document_id);
create index if not exists document_chunks_workspace_idx on public.document_chunks(workspace_id);
create index if not exists document_chunks_collection_idx on public.document_chunks(collection_id);
create index if not exists document_chunks_fts_idx on public.document_chunks using gin (to_tsvector('english', content));
create index if not exists document_chunks_embedding_idx on public.document_chunks using hnsw (embedding vector_cosine_ops);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'New conversation',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role text not null check (role in ('system','user','assistant','tool')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_idx on public.messages(conversation_id, created_at);

create table if not exists public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  details jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.match_document_chunks(
  query_embedding vector(1536),
  match_workspace_id uuid,
  match_collection_id uuid default null,
  match_count integer default 8,
  similarity_threshold double precision default 0.2
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  locator text,
  metadata jsonb,
  similarity double precision
)
language sql stable security invoker as $$
  select dc.id, dc.document_id, dc.content, dc.locator, dc.metadata,
         1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.workspace_id = match_workspace_id
    and (match_collection_id is null or dc.collection_id = match_collection_id)
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.collections enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.ingestion_jobs enable row level security;

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace and wm.user_id = auth.uid()
  );
$$;

create policy "workspace members read workspaces" on public.workspaces
for select using (public.is_workspace_member(id));
create policy "users create workspaces" on public.workspaces
for insert with check (created_by = auth.uid());
create policy "owners update workspaces" on public.workspaces
for update using (exists(select 1 from public.workspace_members wm where wm.workspace_id=id and wm.user_id=auth.uid() and wm.role in ('owner','admin')));

create policy "members read workspace members" on public.workspace_members
for select using (public.is_workspace_member(workspace_id));
create policy "owners manage workspace members" on public.workspace_members
for all using (exists(select 1 from public.workspace_members wm where wm.workspace_id=workspace_members.workspace_id and wm.user_id=auth.uid() and wm.role in ('owner','admin')))
with check (exists(select 1 from public.workspace_members wm where wm.workspace_id=workspace_members.workspace_id and wm.user_id=auth.uid() and wm.role in ('owner','admin')));

create policy "members access collections" on public.collections
for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members access documents" on public.documents
for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members access chunks" on public.document_chunks
for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members access conversations" on public.conversations
for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members access messages" on public.messages
for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members access ingestion jobs" on public.ingestion_jobs
for all using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

insert into storage.buckets (id, name, public)
values ('rag-documents', 'rag-documents', false)
on conflict (id) do nothing;

create policy "workspace document uploads" on storage.objects
for insert to authenticated with check (
  bucket_id = 'rag-documents' and public.is_workspace_member((storage.foldername(name))[1]::uuid)
);
create policy "workspace document reads" on storage.objects
for select to authenticated using (
  bucket_id = 'rag-documents' and public.is_workspace_member((storage.foldername(name))[1]::uuid)
);
create policy "workspace document deletes" on storage.objects
for delete to authenticated using (
  bucket_id = 'rag-documents' and public.is_workspace_member((storage.foldername(name))[1]::uuid)
);
