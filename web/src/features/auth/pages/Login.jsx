import { Wallet } from 'lucide-react';

// Kartu spesimen pastel ala Lattice — tiap modul punya warna sendiri.
const POINTS = [
  { n: '01', title: 'Otomatis dari Gmail', desc: 'Transaksi dari email bank, e-wallet, dan marketplace tercatat sendiri.', tint: 'bg-mint' },
  { n: '02', title: 'Kamu pegang kendali', desc: 'Hanya pengirim yang kamu izinkan yang dibaca. Email tidak pernah diubah.', tint: 'bg-lime' },
  { n: '03', title: 'Manual tetap bisa', desc: 'Belum siap Gmail? Catat pengeluaran kapan saja.', tint: 'bg-lavender' },
];

function GoogleMark() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}

export default function Login() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-parchment px-5 py-10">
      <main className="w-full max-w-md">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest-ink text-white">
            <Wallet className="h-4 w-4" strokeWidth={2.2} />
          </span>
          <span className="text-[15px] font-medium tracking-tight text-forest-ink">Spendly</span>
        </div>

        {/* Hero */}
        <h1 className="mt-7 font-heading text-[40px] leading-[1.05] font-medium tracking-[-1.1px] text-forest-ink text-balance">
          Uangmu habis ke mana?
        </h1>
        <p className="mt-4 text-[17px] leading-snug text-lichen">
          Spendly membaca notifikasi transaksi di Gmail, merapikannya jadi catatan, dan menjawab satu pertanyaan itu.
        </p>

        {/* Kartu spesimen pastel */}
        <div className="mt-8 space-y-2.5">
          {POINTS.map((p) => (
            <div key={p.n} className={`flex gap-3.5 rounded-lg ${p.tint} px-4 py-3.5`}>
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-forest-ink text-[11px] font-medium text-white">
                {p.n}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-forest-ink">{p.title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-lichen">{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <a
          href="/api/v1/auth/google/login"
          className="mt-8 inline-flex h-12 w-full items-center justify-center gap-3 rounded-full bg-forest-ink text-[15px] font-medium text-white transition-colors hover:bg-forest-ink/90"
        >
          <GoogleMark />
          Masuk dengan Google
        </a>

        <p className="mt-4 text-center text-[13px] leading-relaxed text-stone">
          {`Made with `}
          <span className="text-red-500">❤️</span> by{" "}
          <a href="https://github.com/semmidev" className="underline hover:text-forest-ink">
            Sammi
          </a>
        </p>
      </main>
    </div>
  );
}
