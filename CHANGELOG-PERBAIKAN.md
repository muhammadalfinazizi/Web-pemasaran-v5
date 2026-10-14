# Catatan Perbaikan — Web-pemasaran-v5

Ini daftar semua yang diubah dari file yang kamu upload (`Web-pemasaran-v5-FIXED.zip`).
Tidak ada fitur yang dihapus — semua halaman, endpoint, dan alur yang sudah ada
(login pelanggan, keranjang, checkout, riwayat, dashboard admin, kelola produk,
pengaturan situs) tetap jalan sama seperti sebelumnya. Yang berubah murni soal
keamanan dan kebenaran data.

## 1. Backdoor dihapus (kritis)

`backend/app.py` — fungsi `login()` — sebelumnya ada kode:

```python
if not password_valid and username == 'admin' and password == 'AdminOnly#user01':
    password_valid = True
```

Ini membuat siapa pun yang tahu password itu bisa masuk sebagai admin,
**terlepas dari password asli yang sudah di-hash di database**. Backdoor ini
sudah dihapus total. Satu-satunya cara masuk sekarang adalah lewat
`password_hash` yang cocok di tabel `admin_users`.

Sudah diuji: `curl` dengan `AdminOnly#user01` sekarang mengembalikan
"Username atau password salah".

## 2. Harga & stok saat checkout tidak lagi dipercaya dari browser (kritis)

Sebelumnya, endpoint `POST /api/orders` memakai `item['price']` dan
`item['quantity']` persis seperti yang dikirim browser — padahal data itu
berasal dari keranjang di `localStorage` / query string URL, yang gampang
diubah manual lewat DevTools. Stok juga **tidak pernah dicek atau dikurangi**
sama sekali.

Sekarang: untuk setiap item, server mengambil ulang harga & nama dari tabel
`products` berdasarkan `product_id` (`SELECT ... FOR UPDATE`), mengecek stok
cukup, baru menghitung total dan mengurangi stok — semua dalam satu transaksi
database. Kalau ada produk yang stoknya kurang atau sudah tidak ada, seluruh
pesanan dibatalkan (rollback).

Sudah diuji:
- Checkout dengan harga dipalsukan jadi Rp1 → yang tersimpan tetap harga asli
  dari database.
- 8 checkout bersamaan untuk produk stok 1 → hanya 1 yang berhasil, sisanya
  ditolak "stok tidak cukup", stok akhir 0 (tidak minus).
- `product_id` yang tidak ada di database → ditolak.
- Kuantitas negatif / nol → ditolak.

## 3. Perlindungan brute-force ditambahkan

Sebelumnya tidak ada batas percobaan login sama sekali, baik untuk admin
maupun pelanggan. Sekarang:

- **Login admin**: terkunci otomatis setelah `MAX_LOGIN_ATTEMPTS` (default 5)
  kali gagal berturut-turut, selama `LOCKOUT_DURATION` detik (default 900 =
  15 menit). Ini memakai kolom `login_attempts` dan `locked_until` yang
  sebenarnya sudah ada di `schema.sql` sejak awal tapi belum pernah dipakai.
- **Login pelanggan & registrasi**: dibatasi per-alamat IP (in-memory, per
  proses — cukup untuk toko skala kecil; kalau nanti dijalankan dengan banyak
  worker/server sekaligus dan butuh batas gabungan, ganti dengan Redis).
- Baik untuk admin maupun pelanggan, waktu respons login dibuat konsisten
  (selalu menjalankan pengecekan hash password, walau usernya tidak ada) agar
  tidak bisa dipakai menebak username/email mana saja yang terdaftar.
- Akun admin yang statusnya `suspended`/`inactive` (kolom ini juga sudah ada
  di skema tapi belum dipakai) sekarang benar-benar ditolak login-nya.

## 4. CORS dibatasi

Sebelumnya `CORS(app, resources={r"/api/*": {"origins": "*"}})` — API bisa
dipanggil dari domain mana pun. Sekarang origin yang diizinkan harus
didaftarkan eksplisit lewat `CORS_ORIGINS` di `.env` (dipisah koma). Kalau
dikosongkan (default), tidak ada origin cross-domain yang diizinkan sama
sekali — ini sudah cukup untuk deployment normal karena frontend & API
disajikan dari domain yang sama lewat Nginx.

## 5. Mode debug Flask tidak lagi menyala tanpa sengaja

Sebelumnya `debug_mode` bernilai `True` kalau `FLASK_ENV` tidak diset sama
sekali (default Python `os.getenv`). Debugger Werkzeug yang aktif di mode ini
bisa dipakai menjalankan kode sembarang kalau server sampai terekspos ke
jaringan luar. Sekarang defaultnya **mati**, dan hanya menyala kalau
`FLASK_DEBUG=true` diset eksplisit di `.env` (untuk development lokal).

## 6. Celah XSS tersimpan yang bisa membajak sesi admin (penting)

Nama pelanggan saat registrasi dan nama kontak saat checkout **diisi sendiri
oleh pelanggan**, lalu ditampilkan di dashboard admin (tab Pengguna & Pesanan)
dan di header situs tanpa di-escape. Artinya pelanggan bisa mendaftar dengan
nama berisi kode HTML/JavaScript yang akan **otomatis dijalankan di browser
admin** saat admin membuka dashboard — termasuk berpotensi mencuri token admin
yang tersimpan di `sessionStorage`.

Sudah ditambahkan fungsi `escapeHtml()` dan diterapkan di semua titik yang
menampilkan data yang diisi pengguna (nama, email, nama kontak pesanan) lewat
`innerHTML`:
- `js/auth.js` (nama & email di header)
- `js/admin-stock.js` (tabel Pengguna & tabel Pesanan di dashboard admin —
  ini yang paling kritis)
- `cart.html`, `js/payment.js` (nama produk di keranjang/ringkasan bayar)
- `js/products-public.js`, `js/product-detail-public.js`, `js/recommended.js`
  (nama/deskripsi produk — risikonya lebih rendah karena datanya diisi admin,
  tapi tetap dirapikan untuk jaga-jaga)

Data yang tersimpan di database **tidak diubah** — escaping dilakukan saat
tampil di browser, bukan saat disimpan, supaya data aslinya tetap utuh.

## 7. Dokumentasi & skrip pendukung dirapikan

- `QUICKSTART.md`, `README_DB_SETUP.md`, `generate_admin_insert.py`: contoh
  password `AdminOnly#user01` (bekas password backdoor) diganti jadi
  placeholder netral, supaya tidak ada lagi kesan password itu "spesial".
- `deploy_debian.sh`: default `CORS_ORIGINS` diubah dari `*` jadi kosong
  (konsisten dengan poin 4).
- `nginx-musica-jaya.conf`: ditambah header keamanan dasar
  (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

## Yang TIDAK diubah

- Struktur database, nama tabel, dan nama kolom — sama persis, jadi kalau
  kamu sudah pernah import `schema.sql` versi lama, tidak perlu migrasi.
- Semua endpoint API: path, method, dan bentuk respons JSON-nya sama.
- Tampilan & alur semua halaman HTML — hanya bagian yang menampilkan data
  pengguna lewat `innerHTML` yang disentuh, dan hasilnya terlihat sama persis
  di browser (escaping tidak mengubah tampilan teks normal, hanya mencegah
  tag HTML/script dieksekusi).

## Yang disarankan kamu lakukan sendiri setelah ini

1. **Buat ulang akun admin** dengan password baru kamu sendiri — password
   lama manapun yang pernah dipakai saat masih ada backdoor sebaiknya
   dianggap bocor:
   ```bash
   cd backend
   python generate_admin_insert.py 'PasswordBaruKuatKamu'
   # salin SQL yang tampil, jalankan di database musica_jaya
   ```
2. Set `.env` dari `.env.example`, pastikan `SECRET_KEY` diisi acak (bukan
   nilai default), dan `DB_PASSWORD` memakai user database biasa (bukan
   root) — ini sudah otomatis kalau pakai `deploy_debian.sh`.
3. Kalau diakses lewat internet, pasang HTTPS (mis. `certbot` untuk Nginx) —
   saat ini kredensial login dikirim lewat permintaan POST biasa, aman kalau
   sudah HTTPS, tapi polos kalau masih HTTP murni.
