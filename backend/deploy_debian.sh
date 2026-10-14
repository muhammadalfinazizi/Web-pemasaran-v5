#!/usr/bin/env bash
#
# deploy_debian.sh — MUSICA JAYA ELEKTRONIK
# Setup otomatis full-stack (Nginx + Flask backend + MariaDB) di server Debian/Ubuntu.
#
# Cara pakai (jalankan dari dalam folder backend/):
#   chmod +x deploy_debian.sh
#   sudo ./deploy_debian.sh
#
# Script ini akan:
#   1. Install MariaDB, Python3, Nginx (jika belum ada)
#   2. Membuat database + user MySQL khusus untuk aplikasi (bukan root)
#   3. Import schema.sql
#   4. Membuat file .env otomatis (SECRET_KEY random, kredensial DB)
#   5. Membuat virtualenv Python & install dependencies
#   6. Membuat admin default (username: admin) dengan password yang Anda tentukan
#   7. Membuat systemd service supaya backend (gunicorn) jalan otomatis saat boot
#   8. Menyalin folder frontend ke /var/www/musica-jaya & memasang konfigurasi Nginx
#      (Nginx akan serve halaman statis + meneruskan /api/ ke backend Flask)
#
# Aman dijalankan berulang kali (idempotent) selama variabel di bawah tidak diubah.

set -euo pipefail

# Pastikan PATH mencakup folder sistem standar (/usr/sbin, /sbin, dst).
# Beberapa environment (mis. sesi 'sudo -s' tertentu) punya PATH yang
# tidak lengkap, sehingga command seperti nginx/mariadbd tidak ketemu
# walau programnya sudah terpasang.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

# ─── KONFIGURASI (bisa diubah lewat environment variable saat menjalankan) ───
DB_NAME="${DB_NAME:-musica_jaya}"
DB_APP_USER="${DB_APP_USER:-musica_app}"
DB_APP_PASSWORD="${DB_APP_PASSWORD:-$(openssl rand -hex 12)}"
APP_PORT="${APP_PORT:-5000}"
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="musica-jaya-backend"
WEB_ROOT="${WEB_ROOT:-/var/www/musica-jaya}"
NGINX_SITE_NAME="musica-jaya"
# Folder frontend statis (default: folder "Web Pemasaran Update V2" persis di sebelah backend/)
FRONTEND_DIR="${FRONTEND_DIR:-$(cd "${INSTALL_DIR}/../Web Pemasaran Update V2" 2>/dev/null && pwd || true)}"

echo "════════════════════════════════════════════════════════"
echo " Setup Full-Stack MUSICA JAYA ELEKTRONIK"
echo " Nginx + Flask (gunicorn) + MariaDB — Debian/Ubuntu"
echo "════════════════════════════════════════════════════════"

if [[ $EUID -ne 0 ]]; then
  echo "❌ Jalankan script ini dengan sudo/root: sudo ./deploy_debian.sh"
  exit 1
fi

# ─── 1) INSTALL PAKET SISTEM ───────────────────────────────
echo "→ Memasang paket sistem (mariadb-server, python3, venv, nginx)..."
apt-get update -y
apt-get install -y mariadb-server python3 python3-venv python3-pip openssl nginx-light rsync

systemctl enable --now mariadb

# ─── 2) BUAT DATABASE & USER MYSQL ─────────────────────────
echo "→ Membuat database '${DB_NAME}' dan user '${DB_APP_USER}'..."
mysql -u root --default-character-set=utf8mb4 <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_APP_USER}'@'localhost' IDENTIFIED BY '${DB_APP_PASSWORD}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_APP_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

# ─── 3) IMPORT SCHEMA ───────────────────────────────────────
echo "→ Mengimpor schema.sql..."
mysql -u root --default-character-set=utf8mb4 "${DB_NAME}" < "${INSTALL_DIR}/schema.sql"

# ─── 4) BUAT FILE .env ──────────────────────────────────────
if [[ ! -f "${INSTALL_DIR}/.env" ]]; then
  echo "→ Membuat file .env..."
  SECRET_KEY="$(openssl rand -hex 32)"
  cat > "${INSTALL_DIR}/.env" <<ENV
FLASK_ENV=production
FLASK_DEBUG=False
SECRET_KEY=${SECRET_KEY}

DB_HOST=localhost
DB_USER=${DB_APP_USER}
DB_PASSWORD=${DB_APP_PASSWORD}
DB_NAME=${DB_NAME}
DB_PORT=3306

# Kosong = tidak ada origin cross-domain yang diizinkan. Ini sudah cukup karena
# Nginx menyajikan frontend & API dari domain yang sama (lihat lokasi /api/ di
# nginx-musica-jaya.conf). Isi dengan daftar origin dipisah koma HANYA kalau
# frontend memang dibuka dari domain/port lain, mis: CORS_ORIGINS=https://toko-anda.com
CORS_ORIGINS=

SESSION_TIMEOUT=3600
MAX_LOGIN_ATTEMPTS=5
LOCKOUT_DURATION=900

FLASK_RUN_HOST=0.0.0.0
FLASK_RUN_PORT=${APP_PORT}
ENV
  echo "  ✓ .env dibuat. Kredensial DB tersimpan di sini — jangan dibagikan."
else
  echo "→ File .env sudah ada, dilewati (tidak ditimpa)."
fi

# ─── 5) VIRTUALENV & DEPENDENCIES ──────────────────────────
echo "→ Menyiapkan virtualenv Python..."
cd "${INSTALL_DIR}"
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
deactivate

# ─── 6) BUAT AKUN ADMIN ────────────────────────────────────
echo ""
echo "→ Menyiapkan folder upload foto produk..."
mkdir -p "${INSTALL_DIR}/uploads/products"
chown -R www-data:www-data "${INSTALL_DIR}/uploads"

echo ""
echo "→ Membuat akun admin default."
read -rsp "  Masukkan password untuk akun admin (username: admin): " ADMIN_PASSWORD
echo ""
if [[ -z "${ADMIN_PASSWORD}" ]]; then
  echo "  Password kosong, akun admin tidak dibuat. Anda bisa buat manual nanti dengan generate_admin_insert.py"
else
  source .venv/bin/activate
  ADMIN_SQL=$(ADMIN_PASSWORD="${ADMIN_PASSWORD}" python3 generate_admin_insert.py | tail -n1)
  deactivate
  mysql -u root --default-character-set=utf8mb4 "${DB_NAME}" -e "${ADMIN_SQL}"
  echo "  ✓ Akun admin siap. Login dengan username 'admin' dan password yang baru saja Anda buat."
fi

# ─── 7) SYSTEMD SERVICE UNTUK BACKEND ──────────────────────
echo ""
echo "→ Membuat service systemd supaya backend (gunicorn) jalan otomatis..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<SERVICE
[Unit]
Description=Musica Jaya Elektronik - Backend API
After=network.target mariadb.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=${INSTALL_DIR}/.venv/bin/gunicorn -w 4 -b 127.0.0.1:${APP_PORT} app:app
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
sleep 2
echo "  ✓ Service '${SERVICE_NAME}' aktif. Cek status: systemctl status ${SERVICE_NAME}"

# ─── 8) SETUP NGINX (frontend + reverse proxy /api) ────────
echo ""
echo "→ Menyiapkan Nginx..."

if [[ -z "${FRONTEND_DIR}" || ! -d "${FRONTEND_DIR}" ]]; then
  echo "  ⚠ Folder frontend ('Web Pemasaran Update V2') tidak ditemukan otomatis di sebelah folder backend/."
  echo "    Lewati setup Nginx. Anda bisa set variabel FRONTEND_DIR lalu jalankan ulang, contoh:"
  echo "    sudo FRONTEND_DIR=/path/ke/frontend ./deploy_debian.sh"
else
  mkdir -p "${WEB_ROOT}"
  rsync -a --delete "${FRONTEND_DIR}/" "${WEB_ROOT}/" 2>/dev/null || cp -r "${FRONTEND_DIR}/." "${WEB_ROOT}/"
  chown -R www-data:www-data "${WEB_ROOT}"

  # Ganti path root & folder upload di config sesuai lokasi instalasi ini
  sed "s#/var/www/musica-jaya#${WEB_ROOT}#g; s#127.0.0.1:5000#127.0.0.1:${APP_PORT}#g; s#__UPLOADS_DIR__#${INSTALL_DIR}/uploads/products#g" \
    "${INSTALL_DIR}/nginx-musica-jaya.conf" > "/etc/nginx/sites-available/${NGINX_SITE_NAME}"

  ln -sf "/etc/nginx/sites-available/${NGINX_SITE_NAME}" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"

  # Nginx (biasanya berjalan sebagai user www-data) perlu bisa MASUK ke setiap
  # folder induk dari folder upload supaya bisa membaca isinya, meskipun
  # folder backend/ itu sendiri dimiliki root.
  chmod o+x "${INSTALL_DIR}" "$(dirname "${INSTALL_DIR}")" 2>/dev/null || true
  chmod -R o+rX "${INSTALL_DIR}/uploads" 2>/dev/null || true

  # Matikan default site kalau masih aktif, supaya tidak bentrok di port 80
  if [[ -e /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
  fi

  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
  echo "  ✓ Nginx aktif. Frontend disalin ke ${WEB_ROOT}"
fi

SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "════════════════════════════════════════════════════════"
echo " Selesai! Buka di browser (dari komputer lain di jaringan lokal yang sama):"
echo "   http://${SERVER_IP:-<ip-server-ini>}/"
echo " Halaman admin: http://${SERVER_IP:-<ip-server-ini>}/admin.html"
echo " Cek API health: http://${SERVER_IP:-<ip-server-ini>}/api/health"
echo ""
echo " Kalau nanti ada perubahan file frontend, salin ulang ke ${WEB_ROOT}"
echo " lalu jalankan: sudo systemctl reload nginx"
echo "════════════════════════════════════════════════════════"
