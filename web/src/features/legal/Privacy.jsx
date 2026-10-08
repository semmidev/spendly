import LegalLayout, { CONTACT_EMAIL } from './LegalLayout';

export default function Privacy() {
  return (
    <LegalLayout title="Kebijakan Privasi">
      <p>
        Kebijakan Privasi ini menjelaskan bagaimana <strong>Spendly</strong> ("kami")
        mengumpulkan, menggunakan, menyimpan, dan melindungi data kamu saat menggunakan
        aplikasi Spendly. Dengan menggunakan Spendly, kamu menyetujui praktik yang
        dijelaskan di sini.
      </p>

      <h2>1. Siapa kami</h2>
      <p>
        Spendly adalah aplikasi pelacak pengeluaran pribadi yang membaca notifikasi
        transaksi dari Gmail (dengan izinmu), mengekstraknya menjadi data terstruktur,
        lalu menyajikan laporan. Pengelola layanan ini adalah pengembang perorangan
        Spendly. Pertanyaan tentang privasi dapat dikirim ke{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>2. Data yang kami kumpulkan</h2>
      <ul>
        <li>
          <strong>Data akun Google</strong> — saat kamu masuk dengan Google, kami
          menerima nama, alamat email, dan foto profil dari scope <code>openid email profile</code>.
        </li>
        <li>
          <strong>Data Gmail</strong> — hanya jika kamu menghubungkan Gmail secara
          terpisah. Dengan scope <code>gmail.readonly</code>, kami membaca pesan email
          dari <em>pengirim yang kamu pilih sendiri</em> (bank, e-wallet, marketplace).
          Dari email tersebut kami mengekstrak informasi transaksi: nominal, merchant,
          waktu, nomor referensi, sumber dana, kategori, dan catatan.
        </li>
        <li>
          <strong>Data yang kamu masukkan manual</strong> — transaksi, kategori, dan
          daftar pengirim yang kamu atur sendiri.
        </li>
        <li>
          <strong>Data teknis</strong> — log akses, alamat IP, dan informasi
          perangkat/browser untuk keamanan dan operasional layanan.
        </li>
      </ul>

      <h2>3. Bagaimana kami menggunakan data</h2>
      <ul>
        <li>Menyediakan, menjalankan, dan memelihara fitur Spendly (ekstraksi transaksi, kategorisasi, dan laporan).</li>
        <li>Menjaga keamanan akun dan mencegah penyalahgunaan.</li>
        <li>Menghubungi kamu terkait perubahan penting pada layanan.</li>
      </ul>
      <p>
        Kami <strong>tidak</strong> menggunakan datamu untuk tujuan di luar penyediaan
        layanan, dan <strong>tidak pernah menjual</strong> datamu kepada pihak lain.
      </p>

      <h2>4. Kepatuhan Google API (Limited Use)</h2>
      <p>
        Penggunaan Spendly atas informasi yang diterima dari Google API mematuhi{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , termasuk persyaratan <em>Limited Use</em>. Secara khusus:
      </p>
      <ul>
        <li>
          Kami hanya menggunakan akses Gmail untuk menyediakan dan meningkatkan fitur
          yang terlihat oleh pengguna — membaca notifikasi transaksi dan mengubahnya
          menjadi catatan pengeluaran.
        </li>
        <li>Kami <strong>tidak menjual</strong> data pengguna Google.</li>
        <li>
          Kami <strong>tidak menggunakan</strong> data pengguna Google untuk iklan,
          termasuk iklan bertarget.
        </li>
        <li>
          Kami <strong>tidak menggunakan</strong> data pengguna Google untuk melatih
          atau meningkatkan model AI/ML umum.
        </li>
        <li>
          Akses manusia terhadap data pengguna Google hanya dilakukan dengan
          persetujuan eksplisitmu, bila diperlukan untuk keamanan, atau bila diwajibkan
          hukum.
        </li>
      </ul>

      <h2>5. Berbagi dengan pihak ketiga</h2>
      <p>
        Kami membagikan data secara terbatas hanya kepada penyedia yang diperlukan untuk
        menjalankan layanan:
      </p>
      <ul>
        <li><strong>Google (Gmail API)</strong> — sumber data email dan autentikasi.</li>
        <li>
          <strong>Penyedia AI (OpenAI-compatible)</strong> — untuk mengekstrak data dari
          email. Nomor kartu, nomor rekening, nomor telepon, dan kode OTP disunting
          (redaksi) sebelum teks dikirim.
        </li>
        <li><strong>Penyedia hosting dan database</strong> — untuk menjalankan aplikasi dan menyimpan data.</li>
      </ul>
      <p>Kami tidak menjual atau menyewakan datamu kepada siapa pun.</p>

      <h2>6. Keamanan dan penyimpanan</h2>
      <ul>
        <li>Refresh token Gmail disimpan <strong>terenkripsi AES-256-GCM</strong>; access token hanya ada di memori.</li>
        <li>Sesi memakai cookie <code>HttpOnly</code> dan <code>SameSite</code>, dilindungi token CSRF dan HTTPS di produksi.</li>
        <li><strong>Body email mentah tidak disimpan.</strong> Yang disimpan hanya header, hash, hasil ekstraksi, dan transaksi.</li>
        <li>Log aplikasi tidak memuat isi email maupun token.</li>
      </ul>

      <h2>7. Retensi dan penghapusan</h2>
      <ul>
        <li>Kami menyimpan datamu selama akunmu aktif.</li>
        <li>
          <strong>Memutus Gmail</strong> akan mencabut (revoke) token di Google dan
          menghapus kredensial Gmail yang tersimpan.
        </li>
        <li>
          <strong>Menghapus akun</strong> akan menghapus seluruh data terkait secara
          permanen (cascade). Sisa salinan pada cadangan sistem dihapus dalam waktu yang wajar.
        </li>
      </ul>

      <h2>8. Hak kamu</h2>
      <ul>
        <li>Mengakses, mengoreksi, atau menghapus datamu melalui halaman Akun di aplikasi.</li>
        <li>Mengekspor datamu (CSV).</li>
        <li>
          Mencabut izin akses Spendly ke akun Google kapan saja melalui{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
            myaccount.google.com/permissions
          </a>.
        </li>
      </ul>

      <h2>9. Anak-anak</h2>
      <p>
        Spendly tidak ditujukan untuk anak di bawah usia 17 tahun, dan kami tidak
        dengan sengaja mengumpulkan data dari anak di bawah usia tersebut.
      </p>

      <h2>10. Transfer data internasional</h2>
      <p>
        Data dapat diproses pada server yang berlokasi di luar Indonesia melalui penyedia
        hosting dan AI kami. Kami menerapkan perlindungan yang wajar untuk menjaga
        keamanan datamu.
      </p>

      <h2>11. Perubahan kebijakan</h2>
      <p>
        Kami dapat memperbarui kebijakan ini dari waktu ke waktu. Perubahan material akan
        diumumkan melalui aplikasi, dan tanggal "Berlaku sejak" di halaman ini akan
        diperbarui.
      </p>

      <h2>12. Kontak</h2>
      <p>
        Untuk pertanyaan tentang kebijakan ini, hubungi kami di{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalLayout>
  );
}
