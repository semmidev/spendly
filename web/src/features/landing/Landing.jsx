import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Wallet, Mail, ShieldCheck, PencilLine, Lock, Check,
  ChevronDown, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Screenshot mockup iPhone (sudah berbingkai + Dynamic Island dari generator
// preview) — tampilkan langsung dengan drop shadow.
function Shot({ src, alt, className }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cn('block h-auto w-full drop-shadow-[0_40px_60px_rgb(0_0_0/0.3)]', className)}
    />
  );
}

function Reveal({ children, className, delay = 0 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

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

const FEATURES = [
  { title: 'Otomatis dari Gmail', desc: 'Struk bank, e-wallet, dan marketplace tercatat sendiri tanpa ketik manual.', Icon: Mail, tint: 'bg-blue-500/10 text-blue-500' },
  { title: 'Kamu pegang kendali', desc: 'Hanya pengirim yang kamu izinkan yang dibaca. Email tidak pernah diubah.', Icon: ShieldCheck, tint: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  { title: 'Manual tetap bisa', desc: 'Belum siap hubungkan Gmail? Catat pengeluaran kapan saja lewat tombol +.', Icon: PencilLine, tint: 'bg-orange-500/10 text-orange-500' },
];

const SHOWCASE = [
  {
    src: '/screenshots/transaksi-tinjau.png', alt: 'Antrean tinjau transaksi Spendly',
    title: 'Yang meragukan, minta persetujuanmu.',
    desc: 'Hasil ekstraksi ber-confidence rendah masuk antrean Tinjau. Ketuk Benar atau Bukan pengeluaran — koreksimu jadi aturan otomatis berikutnya.',
  },
  {
    src: '/screenshots/laporan-harian.png', alt: 'Laporan harian Spendly',
    title: 'Tren dan kategori, sekilas jelas.',
    desc: 'Total bulan ini, perbandingan bulan lalu, tren harian, dan merchant teratas — semua dihitung di SQL, bukan karangan AI.',
  },
  {
    src: '/screenshots/akun-sinkron.png', alt: 'Pengaturan sinkronisasi Gmail Spendly',
    title: 'Hanya pengirim pilihanmu yang dibaca.',
    desc: 'Nyalakan switch untuk bank dan e-wallet yang kamu pakai. Sinkronisasi manual kapan saja — tidak ada yang berjalan diam-diam.',
  },
];

const PRIVACY = [
  'Gmail read-only — tidak pernah menulis, mengubah, atau menghapus email',
  'Token terenkripsi AES-256-GCM; isi email mentah tidak disimpan',
  'Nomor kartu, OTP, dan data sensitif disunting sebelum ke AI',
  'Putus Gmail atau hapus akun kapan saja — seluruh data ikut terhapus',
];

function GoogleCTA({ className }) {
  return (
    <a
      href="/api/v1/auth/google/login"
      className={cn(
        'inline-flex h-[52px] items-center justify-center gap-3 rounded-full bg-primary px-8 text-[17px] font-semibold text-white transition-transform active:scale-[0.98]',
        className,
      )}
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
        <GoogleMark />
      </span>
      Masuk dengan Google
    </a>
  );
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* Nav */}
      <header
        className={cn(
          'fixed inset-x-0 top-0 z-50 transition-colors',
          scrolled && 'border-b border-border/60 bg-white/70 backdrop-blur-xl dark:bg-black/60',
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-white">
              <Wallet className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="text-[17px] font-semibold tracking-tight">Spendly</span>
          </span>
          <Link
            to="/login"
            className="inline-flex h-8 items-center rounded-full bg-primary px-4 text-[15px] font-medium text-white transition-transform active:scale-95"
          >
            Masuk
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pt-28 pb-16 text-center sm:px-6 sm:pt-36">
        <Reveal>
          <p className="text-[17px] font-semibold text-primary">Spendly untuk iPhone</p>
          <h1 className="mx-auto mt-3 max-w-3xl text-balance text-5xl leading-[1.05] font-bold tracking-tight sm:text-6xl lg:text-7xl">
            Uangmu habis ke mana?
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-xl leading-snug text-muted-foreground">
            Spendly membaca notifikasi transaksi di Gmail, merapikannya jadi catatan,
            dan menjawab satu pertanyaan itu. Hanya pengeluaran.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <GoogleCTA />
            <a href="#fitur" className="inline-flex items-center gap-1 text-[17px] text-primary">
              Lihat cara kerja <ChevronDown className="h-4 w-4" />
            </a>
          </div>
        </Reveal>
        <Reveal delay={0.15} className="relative mx-auto mt-14 w-fit">
          <div
            className="absolute -inset-10 -z-10 rounded-full bg-primary/20 blur-3xl"
            aria-hidden="true"
          />
          <Shot src="/screenshots/beranda.png" alt="Beranda Spendly" className="w-[260px] sm:w-[300px]" />
        </Reveal>
      </section>

      {/* Fitur */}
      <section id="fitur" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6">
        <Reveal className="text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Kenapa Spendly?</h2>
          <p className="mx-auto mt-3 max-w-xl text-[17px] text-muted-foreground">
            Tiga hal yang bikin pencatatan pengeluaran tidak lagi terasa seperti kerjaan.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}>
              <div className="h-full rounded-2xl bg-card p-6">
                <span className={cn('flex h-11 w-11 items-center justify-center rounded-[12px]', f.tint)}>
                  <f.Icon className="h-5 w-5" strokeWidth={2} />
                </span>
                <p className="mt-4 text-[17px] font-semibold">{f.title}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Showcase */}
      <section className="mx-auto max-w-6xl space-y-20 px-4 py-16 sm:px-6">
        {SHOWCASE.map((s, i) => (
          <div key={s.title} className="grid items-center gap-10 md:grid-cols-2">
            <Reveal className={cn('flex justify-center', i % 2 === 1 && 'md:order-2')}>
              <Shot src={s.src} alt={s.alt} className="w-[220px] sm:w-[250px]" />
            </Reveal>
            <Reveal delay={0.1}>
              <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{s.title}</h2>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-muted-foreground">{s.desc}</p>
            </Reveal>
          </div>
        ))}
      </section>

      {/* Privasi */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <Reveal>
          <div className="rounded-[28px] bg-black p-8 text-white sm:p-12 dark:bg-[#1c1c1e]">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
              <Lock className="h-6 w-6" strokeWidth={2} />
            </span>
            <h2 className="mt-5 max-w-lg text-3xl font-bold tracking-tight text-balance sm:text-4xl">
              Datamu bukan produknya. Privasimu desainnya.
            </h2>
            <ul className="mt-8 space-y-4">
              {PRIVACY.map((p) => (
                <li key={p} className="flex items-start gap-3 text-[17px] leading-snug text-white/85">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-green-400" strokeWidth={2.5} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </section>

      {/* CTA final */}
      <section className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6">
        <Reveal>
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Mulai tahu uangmu habis ke mana. Gratis.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[17px] text-muted-foreground">
            Masuk dengan Google, hubungkan Gmail kalau siap — atau catat manual dulu.
          </p>
          <GoogleCTA className="mt-8" />
          <p className="mt-4 text-[13px] text-muted-foreground">
            Dengan masuk, kamu menyetujui Syarat Penggunaan dan Kebijakan Privasi Spendly.
          </p>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-center text-[13px] text-muted-foreground sm:flex-row sm:px-6 sm:text-left">
          <span className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-white">
              <Wallet className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            © 2026 Spendly · v0.1.0
          </span>
          <span className="flex items-center gap-1">
            Made with <span className="text-red-500">❤️</span> by
            <a href="https://github.com/semmidev" className="inline-flex items-center gap-0.5 text-primary">
              Sammi <ArrowRight className="h-3 w-3" />
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
