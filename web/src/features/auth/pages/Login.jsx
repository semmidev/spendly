import { motion } from 'motion/react';
import { Wallet } from 'lucide-react';
import { fadeUp, stagger } from '@/components/animate';

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

const floatA = { x: [0, 24, -12, 0], y: [0, -18, 12, 0] };
const floatB = { x: [0, -20, 14, 0], y: [0, 16, -10, 0] };
const floatT = (d) => ({ duration: d, repeat: Infinity, ease: 'easeInOut' });

export default function Login() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-parchment px-5 py-10">
      {/* Blob pastel melayang — hidup tapi kalem */}
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-mint blur-3xl"
        animate={floatA}
        transition={floatT(14)}
      />
      <motion.span
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full bg-lavender blur-3xl"
        animate={floatB}
        transition={floatT(17)}
      />

      <motion.main
        className="relative w-full max-w-md"
        variants={stagger(0.07)}
        initial="hidden"
        animate="show"
      >
        {/* Brand */}
        <motion.div variants={fadeUp} className="flex items-center gap-2.5">
          <motion.span
            className="flex h-9 w-9 items-center justify-center rounded-full bg-forest-ink text-white"
            initial={{ scale: 0.6, opacity: 0, rotate: -12 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          >
            <Wallet className="h-4 w-4" strokeWidth={2.2} />
          </motion.span>
          <span className="text-[15px] font-medium tracking-tight text-forest-ink">Spendly</span>
        </motion.div>

        {/* Hero */}
        <motion.h1
          variants={fadeUp}
          className="mt-7 font-heading text-[40px] leading-[1.05] font-medium tracking-[-1.1px] text-forest-ink text-balance"
        >
          Uangmu habis ke mana?
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-4 text-[17px] leading-snug text-lichen">
          Spendly membaca notifikasi transaksi di Gmail, merapikannya jadi catatan, dan menjawab satu pertanyaan itu.
        </motion.p>

        {/* Kartu spesimen pastel */}
        <div className="mt-8 space-y-2.5">
          {POINTS.map((p) => (
            <motion.div
              key={p.n}
              variants={fadeUp}
              whileHover={{ y: -2 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className={`flex gap-3.5 rounded-lg ${p.tint} px-4 py-3.5`}
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-forest-ink text-[11px] font-medium text-white">
                {p.n}
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-forest-ink">{p.title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-lichen">{p.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.a
          variants={fadeUp}
          href="/api/v1/auth/google/login"
          whileHover={{ scale: 1.015 }}
          whileTap={{ scale: 0.98 }}
          className="mt-8 inline-flex h-12 w-full items-center justify-center gap-3 rounded-full bg-forest-ink text-[15px] font-medium text-white transition-colors hover:bg-forest-ink/90"
        >
          <GoogleMark />
          Masuk dengan Google
        </motion.a>

        <motion.p variants={fadeUp} className="mt-4 text-center text-[13px] leading-relaxed text-stone">
          {`Made with `}
          <span className="text-red-500">❤️</span> by{" "}
          <a href="https://github.com/semmidev" className="underline hover:text-forest-ink">
            Sammi
          </a>
        </motion.p>
      </motion.main>
    </div>
  );
}
