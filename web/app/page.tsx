'use client';

import { useState } from 'react';
import HeroFuturistic from '@/components/ui/hero-futuristic';

const sourceOptions = [
  ['Upload files', 'PDF, DOCX, XLSX, CSV, images'],
  ['Add a website', 'Read one page or crawl approved links'],
  ['Connect cloud storage', 'SharePoint, OneDrive, Google Drive'],
  ['Connect database', 'PostgreSQL, MySQL, SQL Server and more'],
  ['Connect GitHub', 'Repositories, docs, issues and code'],
];

export default function HomePage() {
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);

  return (
    <main className="site-shell">
      <HeroFuturistic />

      <section id="workspace" className="workspace-section">
        <div className="workspace-wrap">
          <div className="workspace-heading">
            <div>
              <span className="section-kicker">Workspace</span>
              <h2>Your knowledge, ready when you are.</h2>
              <p>Start with a question. Add sources only when you need them.</p>
            </div>
            <div className="workspace-security"><span /> Secure session</div>
          </div>

          <div className="assistant-shell">
            <aside className="workspace-rail" aria-label="Workspace navigation">
              <div className="rail-brand"><span className="brand-orb" /> AI</div>
              <nav>
                <button className="rail-item active" type="button" aria-label="Chat">◌</button>
                <button className="rail-item" type="button" aria-label="Sources">◇</button>
                <button className="rail-item" type="button" aria-label="Knowledge graph">⌘</button>
                <button className="rail-item" type="button" aria-label="History">↺</button>
              </nav>
              <button className="rail-item" type="button" aria-label="Settings">⚙</button>
            </aside>

            <div className="assistant-main">
              <div className="assistant-topbar">
                <div>
                  <span className="assistant-label">New conversation</span>
                  <strong>Ask across all connected knowledge</strong>
                </div>
                <button type="button" className="compact-button">New chat</button>
              </div>

              <div className="conversation-stage">
                <div className="welcome-orb"><span className="brand-orb" /></div>
                <h3>What would you like to understand?</h3>
                <p>Ask about a document, compare files, analyse a dataset, or investigate a source.</p>

                <div className="prompt-composer">
                  <textarea aria-label="Ask a question" placeholder="Ask anything about your knowledge..." rows={3} />
                  <div className="composer-actions">
                    <div className="source-picker">
                      <button
                        type="button"
                        className="add-source-button"
                        onClick={() => setSourceMenuOpen((open) => !open)}
                        aria-expanded={sourceMenuOpen}
                      >
                        <span>＋</span> Add source <b>⌄</b>
                      </button>
                      {sourceMenuOpen && (
                        <div className="source-menu">
                          {sourceOptions.map(([title, description]) => (
                            <button type="button" key={title} onClick={() => setSourceMenuOpen(false)}>
                              <strong>{title}</strong>
                              <small>{description}</small>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <button type="button" className="send-button" aria-label="Send question">→</button>
                  </div>
                </div>

                <div className="suggestion-row">
                  <button type="button">Summarise a report</button>
                  <button type="button">Compare two sources</button>
                  <button type="button">Analyse spreadsheet data</button>
                </div>
              </div>

              <div className="workspace-footer">
                <div><span className="status-dot" /> Hybrid retrieval ready</div>
                <div>0 sources connected</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
