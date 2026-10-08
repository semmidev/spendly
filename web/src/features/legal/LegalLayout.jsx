import { Link } from 'react-router-dom';
import { Wallet, ArrowLeft } from 'lucide-react';

export const CONTACT_EMAIL = 'sammidev4@gmail.com';
export const EFFECTIVE_DATE = '8 Oktober 2026';

export default function LegalLayout({ title, children }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header
        className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white">
              <Wallet className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Spendly</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Kembali
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">Berlaku sejak {EFFECTIVE_DATE}</p>
        <div className="prose prose-sm sm:prose-base mt-8 max-w-none dark:prose-invert prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
          {children}
        </div>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 px-5 py-8 text-center text-[13px] text-muted-foreground sm:flex-row sm:text-left">
          <span>© 2026 Spendly</span>
          <span className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link to="/privacy" className="transition-colors hover:text-foreground">
              Kebijakan Privasi
            </Link>
            <Link to="/terms" className="transition-colors hover:text-foreground">
              Syarat Penggunaan
            </Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="transition-colors hover:text-foreground">
              {CONTACT_EMAIL}
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
