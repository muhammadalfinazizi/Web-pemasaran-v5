# 🚀 Backend API - Quick Start Guide

## MUSICA JAYA ELEKTRONIK - Admin Panel Backend

Backend API dengan Flask (Python) + MySQL untuk secure admin panel.

---

## 📋 Prerequisites

Pastikan sudah installed:
- **Python 3.8+** → https://www.python.org/downloads/
- **MySQL Server** → https://www.mysql.com/downloads/
- **pip** (biasanya sudah termasuk dengan Python)

---

## ⚙️ Setup & Installation

### 1️⃣ Buat Database MySQL/MariaDB

Skema lengkap (semua tabel: admin, sessions, customers, products, orders, dll) sudah
tersedia siap pakai di **`schema.sql`** — jangan buat tabel manual lagi supaya tidak beda
dengan yang dipakai `app.py`. Tinggal import:

```bash
mysql -u root -p --default-character-set=utf8mb4 < schema.sql
```

Atau, kalau Anda deploy di server Debian/Ubuntu, pakai script otomatis `deploy_debian.sh`
yang sekaligus membuat database, user, `.env`, dan akun admin — lihat `README_DB_SETUP.md`.

Setelah schema ter-import, buat akun admin dengan password Anda sendiri (hash dibuat otomatis,
tidak ada password polos yang tersimpan):

```bash
python generate_admin_insert.py 'PasswordAndaSendiri'
# salin SQL yang tampil, jalankan di database musica_jaya
```

### 2️⃣ Setup Python Environment

```bash
# Navigate ke folder backend
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 3️⃣ Configure Environment Variables

```bash
# Copy .env.example ke .env
cp .env.example .env

# Edit .env dengan text editor
# Update values:
FLASK_ENV=development
FLASK_DEBUG=True
SECRET_KEY=your-super-secret-key-12345
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your-mysql-password
DB_NAME=musica_jaya
```

### 4️⃣ Run Backend Server

```bash
# Make sure virtual environment is activated
python app.py

# Output:
# WARNING: This is a development server...
# Running on http://127.0.0.1:5000
```

---

## 🧪 Test API Endpoints

### Login

```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"PASSWORD_YANG_ANDA_BUAT_DENGAN_generate_admin_insert.py"}'

# Response:
# {
#   "success": true,
#   "token": "...",
#   "session_id": "...",
#   "expires_in": 3600
# }
```

### Verify Session

```bash
curl -X GET http://localhost:5000/api/auth/verify \
  -H "Authorization: Bearer TOKEN_HERE"

# Response:
# {
#   "success": true,
#   "message": "Session valid",
#   "admin_id": 1
# }
```

### Health Check

```bash
curl http://localhost:5000/api/health

# Response:
# {
#   "status": "healthy",
#   "database": "connected"
# }
```

---

## 📱 Update Frontend (admin.html)

Edit form login di `admin.html` untuk menggunakan API backend:

```javascript
// OLD: Local validation
// const ok = adminLogin(pw);

// NEW: API call
const loginBtn = document.querySelector('#adminLoginForm button[type="submit"]');
loginBtn.disabled = true;
loginBtn.textContent = 'Memverifikasi...';

fetch('http://localhost:5000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
        username: 'admin',
        password: pw
    })
})
.then(r => r.json())
.then(data => {
    if (data.success) {
        // Save token untuk request berikutnya
        sessionStorage.setItem('adminToken', data.token);
        sessionStorage.setItem('adminSessionId', data.session_id);
        
        // Hide login, show panel
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('adminPanel').hidden = false;
        document.getElementById('loginAlert').hidden = true;
        loadAllData();
        showToast('✓ Login berhasil!', 'success');
    } else {
        alertEl.textContent = '❌ ' + data.message;
        alertEl.hidden = false;
        loginBtn.disabled = false;
        loginBtn.textContent = 'Masuk ke Panel Admin';
    }
})
.catch(err => {
    console.error('Error:', err);
    alertEl.textContent = '❌ Error koneksi ke server';
    alertEl.hidden = false;
    loginBtn.disabled = false;
    loginBtn.textContent = 'Masuk ke Panel Admin';
});
```

---

## 🔒 Security Checklist

- ✅ Password hashed dengan Werkzeug (scrypt/bcrypt)
- ✅ Session token dengan expiration
- ✅ CORS restricted ke domain tertentu
- ✅ Environment variables untuk sensitive data
- ✅ Database connection error handling
- ✅ Token validation middleware

---

## 🐛 Troubleshooting

### ❌ Error: "ModuleNotFoundError: No module named 'pymysql'"

```bash
# Pastikan virtual environment aktif, lalu:
pip install -r requirements.txt
```

### ❌ Error: "Access denied for user 'root'@'localhost'"

```bash
# Check MySQL password di .env
# Pastikan credentials benar
mysql -u root -p  # Test manual
```

### ❌ Error: "Database does not exist"

```bash
# Create database terlebih dahulu
mysql -u root -p --default-character-set=utf8mb4 musica_jaya < schema.sql
```

### ❌ CORS error di browser

```bash
# Pastikan CORS_ORIGINS di .env sudah benar
CORS_ORIGINS=http://localhost:8000,http://127.0.0.1:8000
```

---

## 📊 API Response Format

### Success Response
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {...},
  "token": "..." // jika login
}
```

### Error Response
```json
{
  "success": false,
  "message": "Error description"
}
```

---

## 🚀 Production Deployment

### Recommended Stack

- **Web Server**: Gunicorn atau uWSGI
- **Reverse Proxy**: Nginx
- **Database**: MySQL 8.0+
- **SSL**: Let's Encrypt (HTTPS)
- **Hosting**: AWS, DigitalOcean, Heroku, atau VPS lokal

### Production Setup

```bash
# Install production server
pip install gunicorn

# Run with Gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app

# With systemd service
sudo systemctl restart musica-jaya-api
```

---

## 📞 Support & Next Steps

Untuk integrasi lengkap backend dengan frontend:

1. ✅ Setup database & API server
2. ✅ Update form login di admin.html
3. ✅ Integrate API calls untuk CRUD operations
4. ✅ Add rate limiting & security headers
5. ✅ Setup logging & monitoring
6. ✅ Deploy ke production

Hubungi developer untuk bantuan setup! 🎯

