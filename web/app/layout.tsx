import type { Metadata } from 'next';
import './globals.css';
import './workspace.css';
import './auth.css';

export const metadata: Metadata = {
  title: 'RAG Assistant',
  description: 'Multimodal enterprise knowledge assistant',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
