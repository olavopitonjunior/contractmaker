import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Contractmaker MVP',
  description: 'MVP de contratos com IA'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="shell">
          <header className="topbar">
            <div>
              <strong>Contractmaker MVP</strong>
            </div>
            <nav>
              <a href="/">Home</a>
              <a href="/upload">Upload</a>
              <a href="/mapping.html">Mapping</a>
              <a href="/chat">Chat</a>
              <a href="/export">Export</a>
            </nav>
          </header>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
