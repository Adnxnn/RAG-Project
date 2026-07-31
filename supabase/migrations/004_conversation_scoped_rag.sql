alter table public.documents
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

alter table public.document_chunks
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

alter table public.ingestion_jobs
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;

create index if not exists documents_conversation_idx
  on public.documents(conversation_id, created_at desc);

create index if not exists document_chunks_conversation_idx
  on public.document_chunks(conversation_id);

create index if not exists ingestion_jobs_conversation_idx
  on public.ingestion_jobs(conversation_id, created_at desc);

create or replace function public.owns_conversation(target_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = target_conversation
      and c.created_by = auth.uid()
  );
$$;

create or replace function public.match_conversation_chunks(
  query_embedding vector(1536),
  match_conversation_id uuid,
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
language sql
stable
security invoker
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.locator,
    dc.metadata,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.conversation_id = match_conversation_id
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) >= similarity_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

drop policy if exists "members access documents" on public.documents;
create policy "conversation owners access documents"
on public.documents
for all
using (
  conversation_id is not null
  and public.owns_conversation(conversation_id)
)
with check (
  conversation_id is not null
  and public.owns_conversation(conversation_id)
  and created_by = auth.uid()
);

drop policy if exists "members access chunks" on public.document_chunks;
create policy "conversation owners access chunks"
on public.document_chunks
for all
using (
  conversation_id is not null
  and public.owns_conversation(conversation_id)
)
with check (
  conversation_id is not null
  and public.owns_conversation(conversation_id)
);

drop policy if exists "members access conversations" on public.conversations;
create policy "users own conversations"
on public.conversations
for all
using (created_by = auth.uid())
with check (created_by = auth.uid());

drop policy if exists "members access messages" on public.messages;
create policy "conversation owners access messages"
on public.messages
for all
using (public.owns_conversation(conversation_id))
with check (public.owns_conversation(conversation_id));

drop policy if exists "members access ingestion jobs" on public.ingestion_jobs;
create policy "conversation owners access ingestion jobs"
on public.ingestion_jobs
for all
using (
  conversation_id is not null
  and public.owns_conversation(conversation_id)
)
with check (
  conversation_id is not null
  and public.owns_conversation(conversation_id)
);

-- New files are stored as workspace_id/conversation_id/file_name. Existing
-- workspace membership remains the first storage boundary, while the second
-- folder enforces chat ownership.
drop policy if exists "workspace document uploads" on storage.objects;
create policy "conversation document uploads"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'rag-documents'
  and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  and public.owns_conversation((storage.foldername(name))[2]::uuid)
);

drop policy if exists "workspace document reads" on storage.objects;
create policy "conversation document reads"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rag-documents'
  and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  and public.owns_conversation((storage.foldername(name))[2]::uuid)
);

drop policy if exists "workspace document deletes" on storage.objects;
create policy "conversation document deletes"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'rag-documents'
  and public.is_workspace_member((storage.foldername(name))[1]::uuid)
  and public.owns_conversation((storage.foldername(name))[2]::uuid)
);
