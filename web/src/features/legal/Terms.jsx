import { Link } from 'react-router-dom';
import LegalLayout, { CONTACT_EMAIL } from './LegalLayout';

export default function Terms() {
  return (
    <LegalLayout title="Syarat Penggunaan">
      <p>
        Selamat datang di <strong>Spendly</strong>. Syarat Penggunaan ini ("Syarat")
        mengatur penggunaanmu atas aplikasi dan layanan Spendly. Dengan mengakses atau
        menggunakan Spendly, kamu menyetujui Syarat ini. Jika kamu tidak setuju, mohon
        jangan gunakan layanan.
      </p>

      <h2>1. Penerimaan syarat</h2>
      <p>
        Dengan membuat akun atau menggunakan Spendly, kamu menyatakan telah membaca,
        memahami, dan menyetujui Syarat ini serta{' '}
        <Link to="/privacy">Kebijakan Privasi</Link> kami.
      </p>

      <h2>2. Kelayakan</h2>
      <p>
        Kamu harus berusia minimal 17 tahun untuk menggunakan Spendly. Dengan
        menggunakan layanan, kamu menyatakan memenuhi syarat usia tersebut.
      </p>

      <h2>3. Deskripsi layanan</h2>
      <p>
        Spendly membantu kamu mencatat dan memahami pengeluaran dengan membaca
        notifikasi transaksi dari Gmail (atas izinmu), mengekstraknya menjadi data
        terstruktur, dan menyajikan laporan. Spendly hanya untuk pengeluaran dan{' '}
        <strong>bukan nasihat keuangan, akuntansi, atau pajak</strong>. Keputusan
        keuangan sepenuhnya tanggung jawabmu.
      </p>

      <h2>4. Akun dan login Google</h2>
      <p>
        Akun dibuat melalui login Google. Kamu bertanggung jawab menjaga keamanan akun
        Google-mu dan seluruh aktivitas yang terjadi melalui akunmu.
      </p>

      <h2>5. Koneksi Gmail dan tanggung jawab pengguna</h2>
      <ul>
        <li>Kamu hanya boleh menghubungkan akun Gmail yang benar-benar milikmu atau yang kamu berwenang mengaksesnya.</li>
        <li>Kamu bertanggung jawab atas pemilihan pengirim email yang diizinkan untuk dibaca.</li>
        <li>Kamu dapat memutus koneksi Gmail kapan saja dari halaman Akun.</li>
      </ul>

      <h2>6. Penggunaan yang dilarang</h2>
      <ul>
        <li>Menggunakan Spendly untuk melanggar hukum yang berlaku.</li>
        <li>Mengakses akun atau data milik orang lain tanpa izin.</li>
        <li>Mengganggu, merusak, atau mencoba menembus keamanan layanan.</li>
        <li>Menggunakan layanan untuk menyebarkan malware atau aktivitas penipuan.</li>
      </ul>

      <h2>7. Kekayaan intelektual</h2>
      <p>
        Spendly, termasuk logo, desain, dan perangkat lunaknya, dilindungi oleh hak
        kekayaan intelektual. Kami memberimu lisensi terbatas, non-eksklusif, dan tidak
        dapat dipindahtangankan untuk menggunakan layanan sesuai Syarat ini. Data yang
        kamu buat tetap milikmu.
      </p>

      <h2>8. Penafian jaminan</h2>
      <p>
        Spendly disediakan "sebagaimana adanya" dan "sebagaimana tersedia". Hasil
        ekstraksi otomatis dapat mengandung kesalahan dan wajib kamu tinjau. Kami tidak
        menjamin layanan bebas gangguan, bebas kesalahan, atau selalu tersedia.
      </p>

      <h2>9. Batas tanggung jawab</h2>
      <p>
        Sejauh diizinkan hukum, Spendly tidak bertanggung jawab atas kerugian tidak
        langsung, insidental, atau konsekuensial yang timbul dari penggunaan atau
        ketidakmampuan menggunakan layanan, termasuk keputusan keuangan yang kamu ambil.
      </p>

      <h2>10. Penghentian</h2>
      <p>
        Kamu dapat berhenti menggunakan Spendly dan menghapus akunmu kapan saja. Kami
        dapat menangguhkan atau menghentikan akses jika kamu melanggar Syarat ini atau
        membahayakan layanan atau pengguna lain.
      </p>

      <h2>11. Perubahan syarat</h2>
      <p>
        Kami dapat mengubah Syarat ini dari waktu ke waktu. Perubahan material akan
        diumumkan melalui aplikasi, dan tanggal "Berlaku sejak" akan diperbarui.
        Penggunaan berkelanjutan setelah perubahan berarti kamu menyetujui Syarat yang
        baru.
      </p>

      <h2>12. Hukum yang berlaku</h2>
      <p>
        Syarat ini diatur oleh dan ditafsirkan sesuai hukum Republik Indonesia, tanpa
        memperhatikan konflik ketentuan hukum.
      </p>

      <h2>13. Kontak</h2>
      <p>
        Untuk pertanyaan tentang Syarat ini, hubungi kami di{' '}
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    </LegalLayout>
  );
}
