import { motion } from 'motion/react';
import { Wallet, Mail, ShieldCheck, PencilLine } from 'lucide-react';
import { fadeUp, stagger } from '@/components/animate';

const POINTS = [
  { title: 'Otomatis dari Gmail', desc: 'Struk bank, e-wallet, dan marketplace tercatat sendiri.', Icon: Mail, tint: 'bg-blue-500/10 text-blue-500' },
  { title: 'Kamu pegang kendali', desc: 'Hanya pengirim yang kamu izinkan yang dibaca.', Icon: ShieldCheck, tint: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  { title: 'Manual tetap bisa', desc: 'Catat pengeluaran kapan saja lewat tombol +.', Icon: PencilLine, tint: 'bg-orange-500/10 text-orange-500' },
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
    <div
      className="flex min-h-dvh justify-center bg-background"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <motion.main
        className="flex w-full max-w-md flex-1 flex-col px-5 pb-6 pt-14"
        variants={stagger(0.07)}
        initial="hidden"
        animate="show"
      >
        {/* Ikon app ala iOS */}
        <motion.div variants={fadeUp} className="flex flex-col items-center text-center">
          <span
            className="flex h-[76px] w-[76px] items-center justify-center rounded-[18px] text-white shadow-lg"
            style={{ background: 'linear-gradient(180deg, #5ac8fa 0%, #007aff 100%)' }}
          >
            <Wallet className="h-9 w-9" strokeWidth={1.8} />
          </span>
          <p className="mt-3 text-[22px] font-bold tracking-tight text-foreground">Spendly</p>
        </motion.div>

        <motion.h1
          variants={fadeUp}
          className="mt-7 text-center text-[28px] leading-[1.15] font-bold tracking-tight text-foreground text-balance"
        >
          Uangmu habis ke mana?
        </motion.h1>
        <motion.p variants={fadeUp} className="mt-2 text-center text-[17px] leading-snug text-muted-foreground">
          Notifikasi transaksi di Gmail dibaca otomatis dan dirapikan jadi catatan pengeluaran.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-7 overflow-hidden rounded-xl bg-card">
          <div className="divide-y divide-border/60">
            {POINTS.map((p) => (
              <div key={p.title} className="flex items-center gap-3 px-4 py-3">
                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] ${p.tint}`}>
                  <p.Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] leading-snug text-foreground">{p.title}</p>
                  <p className="text-[13px] leading-snug text-muted-foreground">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div variants={fadeUp} className="mt-7">
          <motion.a
            href="/api/v1/auth/google/login"
            whileTap={{ scale: 0.98 }}
            className="inline-flex h-[50px] w-full items-center justify-center gap-3 rounded-[14px] bg-primary text-[17px] font-semibold text-white"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
              <GoogleMark />
            </span>
            Masuk dengan Google
          </motion.a>
          <p className="mt-4 px-4 text-center text-[13px] leading-relaxed text-muted-foreground">
            Dengan masuk, kamu menyetujui <span className="text-primary">Syarat Penggunaan</span> dan{' '}
            <span className="text-primary">Kebijakan Privasi</span> Spendly.
          </p>
        </motion.div>

        <motion.p variants={fadeUp} className="mt-auto pt-8 text-center text-[13px] text-muted-foreground">
          Spendly 0.1.0 · Made with <span className="text-red-500">❤️</span> by{' '}
          <a href="https://github.com/semmidev" className="text-primary">
            Sammi
          </a>
        </motion.p>
      </motion.main>
    </div>
  );
}
