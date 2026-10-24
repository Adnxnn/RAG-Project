# Deployment guide: Vercel frontend + persistent RAG backend

This repository has two different runtimes. **Vercel runs the Next.js frontend in `web/`**. The FastAPI ingestion and retrieval service requires a separate persistent Python host (or container service). Do not attempt to package the whole Python stack into a Vercel function.

## 1. Backend (Python service)

Use a container host with persistent storage and adequate memory; configure the backend from `.env.example`. Build and launch the FastAPI service using the root Dockerfile. Configure `OPENAI_API_KEY`, `API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and CORS_ORIGINS. Check `GET /health` and then test uploads and questions against `POST /ingest/files` and `POST /chat`.

**Important implementation caveat:** retrieval currently keeps search blocks in process memory. Restarts and multiple instances can lose or split indexing. Do not claim production persistence until blocks are rehydrated from Supabase or an external vector service on startup and on each request. The frontend's document and message writes also overlap the backend's writes; reconcile these flows before production use.

## 2. Supabase

Create a Supabase project and run the SQL migrations from `supabase/`. Set up a private `rag-documents` storage bucket, auth providers, and review all row-level security policies. Avoid sharing the service-role key with client-side JavaScript.

## 3. Vercel (Next.js)

Connect GitHub repository `Adnxnn/RAG-Project`, with root directory `web` (or use the existing monorepo root configuration if its build command is verified). Framework: Next.js. Add environment variables:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — public/publishable key
- `RAG_API_URL` — publicly reachable **HTTPS** base URL for FastAPI (no trailing slash)
- `RAG_API_KEY` — matching backend API key, **server-side only**

After deploying, log in and verify creating a conversation, uploading a document, asking a question, seeing citations, restarting the backend and asking again. Do not call the application fully operational unless each passes.

## 4. Local development

```bash
cp .env.example .env
# Fill local configuration and start Python services.
docker compose up --build
# In another terminal:
cd web
npm install
npm run dev
```

Keep the `API_KEY` and OpenAI/service-role keys outside Git and never put them in `NEXT_PUBLIC_*` variables.
