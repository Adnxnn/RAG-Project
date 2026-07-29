import HeroFuturistic from '@/components/ui/hero-futuristic';

export default function HomePage() {
  return (
    <main className="bg-slate-950 text-white">
      <HeroFuturistic />

      <section id="workspace" className="mx-auto min-h-svh max-w-7xl px-6 py-24">
        <div className="mb-10 max-w-3xl">
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-red-400">RAG Workspace</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-6xl">Your knowledge, connected.</h1>
          <p className="mt-5 text-lg text-white/60">
            Upload PDFs, spreadsheets, documents, images, or paste a reference URL. The FastAPI backend can then index, retrieve, rerank, and answer with source citations.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {[
            ['Upload', 'PDF, Excel, CSV, Word, images and code files'],
            ['Connect', 'Reference URLs and approved website content'],
            ['Ask', 'Hybrid retrieval, reranking and corrective answers'],
          ].map(([title, description]) => (
            <article key={title} className="rounded-3xl border border-white/10 bg-white/[0.04] p-7">
              <h2 className="text-xl font-semibold">{title}</h2>
              <p className="mt-3 text-white/55">{description}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
