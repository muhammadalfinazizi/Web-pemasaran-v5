# Setup Database & Backend

Backend memakai **Flask (Python)** + **MariaDB/MySQL**, lewat driver **PyMySQL** (murni Python,
tidak perlu compile ulang di server — ini sengaja dipilih supaya gampang di-deploy di Debian).

---

## 🐧 Deploy ke server Debian/Ubuntu (MariaDB) — cara tercepat

Sudah disediakan script otomatis `deploy_debian.sh` yang akan memasang **Nginx, MariaDB, dan
backend Flask** sekaligus: install semua paket, buat database & user, import schema, salin
folder frontend ke `/var/www/musica-jaya`, pasang konfigurasi Nginx (serve frontend + reverse
proxy `/api/` ke backend), membuat `.env`, menyiapkan virtualenv, membuat akun admin, dan
membuat service systemd supaya backend jalan otomatis saat server nyala/restart.

```bash
cd backend
chmod +x deploy_debian.sh
sudo ./deploy_debian.sh
```

Ikuti instruksi yang muncul (script akan minta Anda mengetik password untuk akun admin).
Setelah selesai, dari **komputer lain di jaringan lokal yang sama**, buka:

```
http://<ip-server-debian-anda>/
http://<ip-server-debian-anda>/admin.html
```

Script akan menampilkan alamat IP server di akhir proses supaya tinggal disalin.

Cek juga API-nya lewat Nginx (bukan lewat port 5000 langsung, karena backend sekarang hanya
mendengarkan di `127.0.0.1` — diakses publik lewat Nginx di port 80):

```bash
curl http://localhost/api/health
# {"status": "healthy", "database": "connected"}
```

Backend akan otomatis berjalan lagi setiap kali server restart. Cek statusnya dengan:

```bash
systemctl status musica-jaya-backend
systemctl status nginx
```

Kredensial database yang dibuat otomatis tersimpan di `backend/.env` — **jangan** commit file
ini ke Git (sudah ada di `.gitignore`).

### Jika ingin pasang di belakang Nginx (opsional, direkomendasikan untuk produksi)

Sudah otomatis dilakukan oleh `deploy_debian.sh` — Anda tidak perlu setup manual. Nginx akan
serve halaman statis (frontend) dan meneruskan semua request `/api/` ke backend Flask
(gunicorn, berjalan di `127.0.0.1:5000`, tidak diekspos langsung ke luar).

Kalau ingin pasang sertifikat SSL (HTTPS) untuk domain publik, tambahkan lewat Certbot setelah
setup ini selesai — itu di luar cakupan script karena tergantung domain masing-masing.

Kalau perlu ubah konfigurasi Nginx secara manual, file ada di:
- Template: `backend/nginx-musica-jaya.conf`
- Terpasang di server: `/etc/nginx/sites-available/musica-jaya`

---

## 💻 Setup manual / development lokal (Windows/Mac/Linux)

1) **Install MySQL/MariaDB** (atau XAMPP/WampServer yang sudah termasuk MySQL)

2) **Import schema** (dari folder root project):
   ```bash
   mysql -u root -p --default-character-set=utf8mb4 < backend/schema.sql
   ```

3) **Siapkan file `.env`**
   ```bash
   cp backend/.env.example backend/.env
   # lalu edit backend/.env sesuai kredensial database Anda
   ```

4) **Install dependency & jalankan server**
   ```bash
   cd backend
   python -m venv .venv
   # Windows PowerShell:
   .\.venv\Scripts\Activate.ps1
   # Linux/Mac:
   source .venv/bin/activate

   pip install -r requirements.txt
   python app.py
   ```

5) **Cek health endpoint**: http://localhost:5000/api/health

6) **Buat akun admin** dengan password yang aman (hash otomatis dibuat, tidak plaintext):
   ```bash
   python generate_admin_insert.py 'PasswordAndaSendiri'
   # Salin hasil SQL yang muncul, lalu jalankan di database musica_jaya
   ```

---

## Catatan penting

- Port default MySQL/MariaDB adalah `3306` — kalau server Anda pakai port lain, ubah `DB_PORT` di `.env`.
- Tidak ada password admin bawaan/default sama sekali — satu-satunya cara masuk adalah password yang Anda buat sendiri lewat `generate_admin_insert.py` saat setup. Kalau lupa, buat ulang hash-nya dengan skrip yang sama (lihat di atas) atau ganti lewat endpoint `PUT /api/admin/password` setelah login.
- Tabel `customers` dan `orders` di database saat ini **belum otomatis terisi** dari alur belanja di frontend, karena riwayat belanja pelanggan masih disimpan di IndexedDB browser (lihat `js/database.js`), bukan dikirim ke API. Jadi dashboard admin untuk data pelanggan/pesanan akan tampak kosong sampai alur checkout dihubungkan ke endpoint backend. Ini adalah keputusan arsitektur, bukan bug — beri tahu saya kalau Anda ingin data pesanan disimpan terpusat di MySQL.
