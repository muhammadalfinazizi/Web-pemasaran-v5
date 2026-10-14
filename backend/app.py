"""
Flask Backend API - MUSICA JAYA ELEKTRONIK
Admin Panel Authentication & Management
"""

import os
from datetime import datetime, timedelta
from functools import wraps
import secrets
import uuid
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import pymysql
import pymysql.cursors

# Load environment variables
load_dotenv()

app = Flask(__name__)
_secret_key = os.getenv('SECRET_KEY', 'change-this-to-something-secure')
if _secret_key == 'change-this-to-something-secure':
    print('PERINGATAN: SECRET_KEY masih nilai default. Set SECRET_KEY di .env untuk produksi.')
app.config['SECRET_KEY'] = _secret_key

# CORS: hanya izinkan origin yang eksplisit didaftarkan lewat CORS_ORIGINS (dipisah koma).
# Kalau tidak diset sama sekali, tidak ada origin cross-domain yang diizinkan (aman secara
# default) — ini cukup untuk deployment di mana frontend & API disajikan dari domain yang
# sama lewat Nginx (lihat nginx-musica-jaya.conf). Isi CORS_ORIGINS hanya kalau frontend
# memang dibuka dari origin/port lain (mis. saat development lokal).
_cors_origins = [o.strip() for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]
if _cors_origins:
    CORS(app, resources={r"/api/*": {"origins": _cors_origins}})

# ─── UPLOAD FOTO PRODUK ───────────────────────────────
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'products')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5MB
app.config['MAX_CONTENT_LENGTH'] = MAX_IMAGE_SIZE

# Database Configuration
DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'user': os.getenv('DB_USER', 'root'),
    'passwd': os.getenv('DB_PASSWORD', ''),
    'db': os.getenv('DB_NAME', 'musica_jaya'),
    'port': int(os.getenv('DB_PORT', 3306)),
    'charset': 'utf8mb4',
    'cursorclass': pymysql.cursors.DictCursor
}

SESSION_TIMEOUT = int(os.getenv('SESSION_TIMEOUT', 3600))  # 1 hour default

# ─── HELPERS ──────────────────────────────────────────

def get_db():
    """Get database connection"""
    return pymysql.connect(**DB_CONFIG)

def ensure_products_schema():
    """Ensure products table has fields used by the storefront/admin UI."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SHOW COLUMNS FROM products')
        columns = [row['Field'] if isinstance(row, dict) else row[0] for row in cursor.fetchall()]
        if 'description' not in columns:
            cursor.execute('ALTER TABLE products ADD COLUMN description TEXT')
        if 'image_url' not in columns:
            cursor.execute('ALTER TABLE products ADD COLUMN image_url VARCHAR(500)')
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f'Ensure products schema error: {e}')

def ensure_customer_order_schema():
    """
    Migrasi ringan untuk instalasi lama: tambahkan kolom & tabel yang dibutuhkan
    fitur akun pelanggan + pesanan (phone, customer_sessions, contact info per order)
    tanpa perlu import ulang schema.sql secara manual.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute('SHOW COLUMNS FROM customers')
        customer_columns = [row['Field'] if isinstance(row, dict) else row[0] for row in cursor.fetchall()]
        if 'phone' not in customer_columns:
            cursor.execute('ALTER TABLE customers ADD COLUMN phone VARCHAR(30)')

        cursor.execute('SHOW COLUMNS FROM orders')
        order_columns = [row['Field'] if isinstance(row, dict) else row[0] for row in cursor.fetchall()]
        if 'payment_method' not in order_columns:
            cursor.execute('ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50)')
        if 'contact_name' not in order_columns:
            cursor.execute('ALTER TABLE orders ADD COLUMN contact_name VARCHAR(150)')
        if 'contact_phone' not in order_columns:
            cursor.execute('ALTER TABLE orders ADD COLUMN contact_phone VARCHAR(30)')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS customer_sessions (
                session_id VARCHAR(255) PRIMARY KEY,
                customer_id INT NOT NULL,
                token VARCHAR(255) NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
                INDEX idx_customer_id (customer_id),
                INDEX idx_cs_token (token),
                INDEX idx_cs_expires_at (expires_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        ''')

        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print(f'Ensure customer/order schema error: {e}')

ensure_products_schema()
ensure_customer_order_schema()

def generate_token():
    """Generate secure session token"""
    return secrets.token_urlsafe(32)


# Hash "dummy" dipakai supaya waktu respons login tetap sama baik username-nya
# ada maupun tidak (mencegah user enumeration lewat timing side-channel).
_DUMMY_PASSWORD_HASH = generate_password_hash('dummy-password-untuk-menyamakan-waktu-respons')

MAX_LOGIN_ATTEMPTS = int(os.getenv('MAX_LOGIN_ATTEMPTS', 5))
LOCKOUT_DURATION = int(os.getenv('LOCKOUT_DURATION', 900))  # detik

# ─── PEMBATAS LAJU SEDERHANA (in-memory, per proses) ──
# Menahan brute force / spam pada endpoint publik (login pelanggan, registrasi,
# dan percobaan login admin per-IP di atas lockout per-akun di atas). Ini
# penyimpanan in-memory: kalau backend dijalankan dengan banyak worker/proses
# (mis. gunicorn -w 4), batasnya berlaku per proses, bukan gabungan semuanya.
# Untuk beban tinggi/multi-server, ganti dengan Redis; untuk toko skala kecil
# ini sudah cukup menghambat percobaan otomatis.
from collections import defaultdict
import threading

_rate_lock = threading.Lock()
_rate_buckets = defaultdict(list)  # key -> list[timestamp epoch]

def is_rate_limited(key, max_attempts, window_seconds):
    now = datetime.now().timestamp()
    with _rate_lock:
        bucket = _rate_buckets[key]
        bucket[:] = [t for t in bucket if now - t < window_seconds]
        if len(bucket) >= max_attempts:
            return True
        bucket.append(now)
        return False

def client_ip():
    return request.headers.get('X-Forwarded-For', request.remote_addr or 'unknown').split(',')[0].strip()

def token_required(f):
    """Decorator: Validate admin token"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')
        
        if not token:
            return jsonify({'success': False, 'message': 'Token tidak ditemukan'}), 401
        
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT admin_id FROM admin_sessions 
                WHERE token = %s AND expires_at > NOW()
            ''', (token,))
            session = cursor.fetchone()
            cursor.close()
            conn.close()
            
            if not session:
                return jsonify({'success': False, 'message': 'Token tidak valid atau sudah expired'}), 401
            
            request.admin_id = session['admin_id']
            return f(*args, **kwargs)
        except Exception as e:
            print(f'Token validation error: {e}')
            return jsonify({'success': False, 'message': 'Error validasi token'}), 500
    
    return decorated

# ─── AUTH ROUTES ──────────────────────────────────────

@app.route('/api/auth/login', methods=['POST'])
def login():
    """Admin login. Tidak ada password bypass/backdoor apa pun — satu-satunya
    cara masuk adalah password_hash yang cocok di tabel admin_users, dan akun
    yang sedang terkunci (locked_until) atau berstatus non-'active' selalu ditolak."""
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()[:100]
    password = (data.get('password') or '').strip()[:200]

    if not username or not password:
        return jsonify({'success': False, 'message': 'Username dan password harus diisi'}), 400

    # Batas per-IP (di luar lockout per-akun di atas) supaya satu IP tidak bisa
    # menebak banyak username sekaligus.
    if is_rate_limited(f'admin-login:{client_ip()}', MAX_LOGIN_ATTEMPTS * 3, LOCKOUT_DURATION):
        return jsonify({'success': False, 'message': 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.'}), 429

    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute(
            'SELECT id, password_hash, status, login_attempts, locked_until FROM admin_users WHERE username = %s',
            (username,)
        )
        admin = cursor.fetchone()

        # Kalau sedang dikunci karena terlalu banyak percobaan gagal, tolak
        # duluan tanpa membandingkan password (dan tanpa membocorkan detail lockout).
        if admin and admin.get('locked_until') and admin['locked_until'] > datetime.now():
            cursor.close()
            conn.close()
            return jsonify({
                'success': False,
                'message': 'Akun terkunci sementara karena terlalu banyak percobaan gagal. Coba lagi beberapa saat lagi.'
            }), 423

        # Selalu jalankan check_password_hash (pakai dummy hash kalau username
        # tidak ada / akun tidak aktif) supaya waktu respons tidak membocorkan
        # apakah username tersebut terdaftar.
        stored_hash = admin['password_hash'] if admin else _DUMMY_PASSWORD_HASH
        try:
            password_valid = check_password_hash(stored_hash, password)
        except Exception:
            password_valid = False

        account_usable = bool(admin) and admin.get('status', 'active') == 'active'

        if not admin or not account_usable or not password_valid:
            if admin:
                attempts = (admin.get('login_attempts') or 0) + 1
                if attempts >= MAX_LOGIN_ATTEMPTS:
                    locked_until = datetime.now() + timedelta(seconds=LOCKOUT_DURATION)
                    cursor.execute(
                        'UPDATE admin_users SET login_attempts = %s, locked_until = %s WHERE id = %s',
                        (attempts, locked_until, admin['id'])
                    )
                else:
                    cursor.execute(
                        'UPDATE admin_users SET login_attempts = %s WHERE id = %s',
                        (attempts, admin['id'])
                    )
                conn.commit()
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Username atau password salah'}), 401

        # Login sukses: reset penghitung percobaan gagal & catat waktu login.
        admin_id = admin['id']
        cursor.execute(
            'UPDATE admin_users SET login_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = %s',
            (admin_id,)
        )

        token = generate_token()
        session_id = secrets.token_urlsafe(16)
        expires_at = datetime.now() + timedelta(seconds=SESSION_TIMEOUT)

        cursor.execute('''
            INSERT INTO admin_sessions (session_id, admin_id, token, ip_address, user_agent, expires_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        ''', (session_id, admin_id, token, request.remote_addr, request.headers.get('User-Agent', '')[:500], expires_at))

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Login berhasil',
            'token': token,
            'session_id': session_id,
            'expires_in': SESSION_TIMEOUT
        }), 200

    except Exception as e:
        print(f'Login error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500

@app.route('/api/auth/logout', methods=['POST'])
@token_required
def logout():
    """Admin logout"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM admin_sessions WHERE token = %s', (token,))
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Logout berhasil'}), 200
    except Exception as e:
        print(f'Logout error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500

@app.route('/api/auth/verify', methods=['GET'])
@token_required
def verify():
    """Verify admin session"""
    return jsonify({
        'success': True,
        'message': 'Session valid',
        'admin_id': request.admin_id
    }), 200

# ─── CUSTOMER AUTH & ORDERS ────────────────────────────

CUSTOMER_SESSION_TIMEOUT = int(os.getenv('CUSTOMER_SESSION_TIMEOUT', 60 * 60 * 24 * 7))  # 7 hari

def customer_token_required(f):
    """Decorator: Validate customer (pelanggan) token"""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = request.headers.get('Authorization', '').replace('Bearer ', '')

        if not token:
            return jsonify({'success': False, 'message': 'Silakan login terlebih dahulu'}), 401

        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute('''
                SELECT customer_id FROM customer_sessions
                WHERE token = %s AND expires_at > NOW()
            ''', (token,))
            session = cursor.fetchone()
            cursor.close()
            conn.close()

            if not session:
                return jsonify({'success': False, 'message': 'Sesi tidak valid atau sudah habis, silakan login lagi'}), 401

            request.customer_id = session['customer_id']
            return f(*args, **kwargs)
        except Exception as e:
            print(f'Customer token validation error: {e}')
            return jsonify({'success': False, 'message': 'Error validasi sesi'}), 500

    return decorated

def create_customer_session(conn, customer_id):
    """Buat token sesi baru untuk pelanggan yang login/daftar"""
    token = generate_token()
    session_id = secrets.token_urlsafe(16)
    expires_at = datetime.now() + timedelta(seconds=CUSTOMER_SESSION_TIMEOUT)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO customer_sessions (session_id, customer_id, token, expires_at)
        VALUES (%s, %s, %s, %s)
    ''', (session_id, customer_id, token, expires_at))
    conn.commit()
    cursor.close()
    return token

@app.route('/api/customer/register', methods=['POST'])
def customer_register():
    """Registrasi akun pelanggan baru"""
    data = request.get_json() or {}
    full_name = (data.get('full_name') or '').strip()
    email = (data.get('email') or '').strip().lower()
    phone = (data.get('phone') or '').strip()
    password = data.get('password') or ''

    if not full_name or not email or not phone or not password:
        return jsonify({'success': False, 'message': 'Semua kolom wajib diisi'}), 400

    if len(full_name) > 150 or len(email) > 150 or len(phone) > 30:
        return jsonify({'success': False, 'message': 'Data terlalu panjang'}), 400

    if len(password) < 6:
        return jsonify({'success': False, 'message': 'Password minimal 6 karakter'}), 400

    if is_rate_limited(f'register:{client_ip()}', 10, 3600):
        return jsonify({'success': False, 'message': 'Terlalu banyak percobaan registrasi. Coba lagi nanti.'}), 429

    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute('SELECT id FROM customers WHERE email = %s', (email,))
        if cursor.fetchone():
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Email sudah terdaftar'}), 409

        password_hash = generate_password_hash(password)
        cursor.execute('''
            INSERT INTO customers (email, phone, password_hash, full_name)
            VALUES (%s, %s, %s, %s)
        ''', (email, phone, password_hash, full_name))
        conn.commit()
        customer_id = cursor.lastrowid

        token = create_customer_session(conn, customer_id)
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Registrasi berhasil',
            'token': token,
            'customer': {'id': customer_id, 'email': email, 'phone': phone, 'full_name': full_name}
        }), 201
    except Exception as e:
        print(f'Customer register error: {e}')
        return jsonify({'success': False, 'message': 'Error registrasi'}), 500

@app.route('/api/customer/login', methods=['POST'])
def customer_login():
    """Login akun pelanggan"""
    data = request.get_json() or {}
    email = (data.get('email') or '').strip().lower()
    password = data.get('password') or ''

    if not email or not password:
        return jsonify({'success': False, 'message': 'Email dan password wajib diisi'}), 400

    if is_rate_limited(f'customer-login:{client_ip()}', MAX_LOGIN_ATTEMPTS * 3, LOCKOUT_DURATION):
        return jsonify({'success': False, 'message': 'Terlalu banyak percobaan login. Coba lagi beberapa saat lagi.'}), 429

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, phone, full_name, password_hash FROM customers WHERE email = %s', (email,))
        customer = cursor.fetchone()

        # Selalu jalankan check_password_hash walau email tidak ditemukan (dummy hash)
        # supaya waktu respons tidak membocorkan apakah email tersebut terdaftar.
        stored_hash = customer['password_hash'] if customer else _DUMMY_PASSWORD_HASH
        try:
            password_ok = check_password_hash(stored_hash, password)
        except Exception:
            password_ok = False

        if not customer or not password_ok:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Email atau password salah'}), 401

        token = create_customer_session(conn, customer['id'])
        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'message': 'Login berhasil',
            'token': token,
            'customer': {
                'id': customer['id'], 'email': customer['email'],
                'phone': customer['phone'], 'full_name': customer['full_name']
            }
        }), 200
    except Exception as e:
        print(f'Customer login error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500

@app.route('/api/customer/logout', methods=['POST'])
@customer_token_required
def customer_logout():
    """Logout akun pelanggan"""
    token = request.headers.get('Authorization', '').replace('Bearer ', '')
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('DELETE FROM customer_sessions WHERE token = %s', (token,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Logout berhasil'}), 200
    except Exception as e:
        print(f'Customer logout error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500

@app.route('/api/customer/session', methods=['GET'])
@customer_token_required
def customer_session():
    """Ambil data akun pelanggan yang sedang login (untuk render header dsb)"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, email, phone, full_name FROM customers WHERE id = %s', (request.customer_id,))
        customer = cursor.fetchone()
        cursor.close()
        conn.close()

        if not customer:
            return jsonify({'success': False, 'message': 'Akun tidak ditemukan'}), 404

        return jsonify({'success': True, 'customer': customer}), 200
    except Exception as e:
        print(f'Customer session error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500

@app.route('/api/orders', methods=['POST'])
@customer_token_required
def create_order():
    """Buat pesanan baru dari halaman pembayaran (checkout).

    PENTING (perbaikan keamanan): harga dan ketersediaan stok TIDAK PERNAH
    dipercaya dari data yang dikirim browser. Sebelumnya endpoint ini memakai
    `item['price']` apa adanya dari klien, padahal itu berasal dari keranjang
    di localStorage / query string — mudah diubah manual (mis. lewat DevTools)
    untuk membeli barang dengan harga berapa pun, dan stok tidak pernah dicek
    atau dikurangi sama sekali. Sekarang: harga & nama produk diambil ulang
    dari tabel `products` berdasarkan product_id, stok dikunci (FOR UPDATE)
    dan dicek dalam satu transaksi, baru dikurangi — supaya dua pembeli yang
    checkout bersamaan untuk stok terakhir tidak bisa berdua-duanya berhasil.
    """
    data = request.get_json() or {}
    raw_items = data.get('items') or []
    payment_method = (data.get('payment_method') or '').strip()[:50]
    contact_name = (data.get('contact_name') or '').strip()[:150]
    contact_phone = (data.get('contact_phone') or '').strip()[:30]

    if not isinstance(raw_items, list) or not raw_items or len(raw_items) > 100:
        return jsonify({'success': False, 'message': 'Keranjang belanja kosong atau tidak valid'}), 400
    if not contact_name or not contact_phone:
        return jsonify({'success': False, 'message': 'Nama dan nomor telepon penerima wajib diisi'}), 400

    # Gabungkan qty untuk product_id yang sama & validasi bentuknya ketat.
    merged_qty = {}
    for item in raw_items:
        if not isinstance(item, dict):
            return jsonify({'success': False, 'message': 'Data item pesanan tidak valid'}), 400
        try:
            product_id = int(item.get('id'))
            qty = int(item.get('quantity'))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'message': 'Data item pesanan tidak valid'}), 400
        if product_id <= 0 or qty <= 0 or qty > 10000:
            return jsonify({'success': False, 'message': 'Jumlah barang tidak valid'}), 400
        merged_qty[product_id] = merged_qty.get(product_id, 0) + qty

    conn = get_db()
    try:
        cursor = conn.cursor()
        conn.begin()

        product_ids = list(merged_qty.keys())
        placeholders = ','.join(['%s'] * len(product_ids))
        # FOR UPDATE mengunci baris produk ini sampai transaksi selesai, supaya
        # dua checkout bersamaan atas stok terakhir tidak bisa dua-duanya lolos.
        cursor.execute(
            f'SELECT id, name, price, stock FROM products WHERE id IN ({placeholders}) FOR UPDATE',
            tuple(product_ids)
        )
        products_by_id = {row['id']: row for row in cursor.fetchall()}

        if len(products_by_id) != len(product_ids):
            conn.rollback()
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Ada produk di keranjang yang sudah tidak tersedia'}), 400

        total = 0
        order_lines = []
        for product_id, qty in merged_qty.items():
            product = products_by_id[product_id]
            if product['stock'] < qty:
                conn.rollback()
                cursor.close()
                conn.close()
                return jsonify({
                    'success': False,
                    'message': f"Stok \"{product['name']}\" tidak cukup (sisa {product['stock']})"
                }), 400
            price = float(product['price'])
            total += price * qty
            order_lines.append({'product_id': product_id, 'name': product['name'], 'price': price, 'qty': qty})

        cursor.execute('''
            INSERT INTO orders (customer_id, total, status, payment_method, contact_name, contact_phone)
            VALUES (%s, %s, 'diproses', %s, %s, %s)
        ''', (request.customer_id, total, payment_method, contact_name, contact_phone))
        order_id = cursor.lastrowid

        for line in order_lines:
            cursor.execute('''
                INSERT INTO order_items (order_id, product_id, qty, price)
                VALUES (%s, %s, %s, %s)
            ''', (order_id, line['product_id'], line['qty'], line['price']))
            cursor.execute(
                'UPDATE products SET stock = stock - %s WHERE id = %s',
                (line['qty'], line['product_id'])
            )

        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': 'Pesanan berhasil dibuat', 'order_id': order_id, 'total': total}), 201
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()
        print(f'Create order error: {e}')
        return jsonify({'success': False, 'message': 'Error menyimpan pesanan'}), 500

@app.route('/api/customer/orders', methods=['GET'])
@customer_token_required
def customer_orders():
    """Riwayat pesanan milik pelanggan yang sedang login"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT id, total, status, payment_method, contact_name, contact_phone, created_at
            FROM orders WHERE customer_id = %s ORDER BY created_at DESC
        ''', (request.customer_id,))
        orders = cursor.fetchall()

        for order in orders:
            cursor.execute('''
                SELECT oi.qty, oi.price, p.name AS product_name
                FROM order_items oi
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = %s
            ''', (order['id'],))
            order['items'] = cursor.fetchall()

        cursor.close()
        conn.close()
        return jsonify({'success': True, 'orders': orders}), 200
    except Exception as e:
        print(f'Customer orders error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil riwayat pesanan'}), 500

# ─── ADMIN ROUTES ─────────────────────────────────────

@app.route('/api/admin/password', methods=['PUT'])
@token_required
def change_password():
    """Change admin password"""
    data = request.get_json()
    current_password = data.get('current_password', '').strip()
    new_password = data.get('new_password', '').strip()
    
    if not current_password or not new_password:
        return jsonify({'success': False, 'message': 'Password tidak boleh kosong'}), 400
    
    if len(new_password) < 8:
        return jsonify({'success': False, 'message': 'Password minimal 8 karakter'}), 400
    
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Get current admin
        cursor.execute('SELECT password_hash FROM admin_users WHERE id = %s', (request.admin_id,))
        admin = cursor.fetchone()
        
        if not admin or not check_password_hash(admin['password_hash'], current_password):
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Password saat ini salah'}), 401
        
        # Update password
        new_hash = generate_password_hash(new_password)
        cursor.execute('UPDATE admin_users SET password_hash = %s WHERE id = %s', 
                      (new_hash, request.admin_id))
        conn.commit()
        cursor.close()
        conn.close()
        
        return jsonify({'success': True, 'message': 'Password berhasil diubah'}), 200
    
    except Exception as e:
        print(f'Password change error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500

# ─── SITE SETTINGS (foto & teks situs yang bisa diubah admin) ──

@app.route('/api/site-settings', methods=['GET'])
def get_site_settings():
    """Ambil semua pengaturan situs (publik, dipakai halaman toko)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT setting_key, setting_value FROM site_settings')
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        settings = {row['setting_key']: row['setting_value'] for row in rows}
        return jsonify({'success': True, 'settings': settings}), 200
    except Exception as e:
        print(f'Get site settings error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil pengaturan situs'}), 500

@app.route('/api/admin/site-settings', methods=['PUT'])
@token_required
def update_site_settings():
    """Update satu atau lebih pengaturan situs (foto/teks)."""
    data = request.get_json() or {}
    if not data:
        return jsonify({'success': False, 'message': 'Tidak ada data yang dikirim'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        for key, value in data.items():
            cursor.execute('''
                INSERT INTO site_settings (setting_key, setting_value) VALUES (%s, %s)
                ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
            ''', (key, value))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Pengaturan situs berhasil disimpan'}), 200
    except Exception as e:
        print(f'Update site settings error: {e}')
        return jsonify({'success': False, 'message': 'Error menyimpan pengaturan situs'}), 500

@app.route('/api/products', methods=['GET'])
def list_public_products():
    """Return products for storefront"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, sku, name, price, stock, description, image_url FROM products ORDER BY name ASC')
        products = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'products': products}), 200
    except Exception as e:
        print(f'List public products error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil produk'}), 500

@app.route('/api/products/<int:product_id>', methods=['GET'])
def get_public_product(product_id):
    """Return a single product"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, sku, name, price, stock, description, image_url FROM products WHERE id = %s', (product_id,))
        product = cursor.fetchone()
        cursor.close()
        conn.close()

        if not product:
            return jsonify({'success': False, 'message': 'Produk tidak ditemukan'}), 404

        return jsonify({'success': True, 'product': product}), 200
    except Exception as e:
        print(f'Get public product error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil produk'}), 500

@app.route('/api/admin/products', methods=['GET'])
@token_required
def admin_list_products():
    """List all products for stock management"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, sku, name, price, stock, description, image_url FROM products ORDER BY name ASC')
        products = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'products': products}), 200
    except Exception as e:
        print(f'Admin list products error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil data produk'}), 500

@app.route('/api/admin/upload-image', methods=['POST'])
@token_required
def admin_upload_image():
    """Upload foto produk. Menerima form-data dengan field 'image'."""
    if 'image' not in request.files:
        return jsonify({'success': False, 'message': 'Tidak ada file yang dikirim'}), 400

    file = request.files['image']
    if not file or file.filename == '':
        return jsonify({'success': False, 'message': 'File kosong'}), 400

    ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        return jsonify({'success': False, 'message': 'Format file harus JPG, PNG, GIF, atau WEBP'}), 400

    filename = secure_filename(f"{uuid.uuid4().hex}.{ext}")
    try:
        file.save(os.path.join(UPLOAD_FOLDER, filename))
    except Exception as e:
        print(f'Upload image error: {e}')
        return jsonify({'success': False, 'message': 'Gagal menyimpan file'}), 500

    return jsonify({'success': True, 'image_url': f'/uploads/products/{filename}'}), 201

@app.route('/uploads/products/<path:filename>', methods=['GET'])
def serve_product_image(filename):
    """Sajikan foto produk yang sudah di-upload."""
    return send_from_directory(UPLOAD_FOLDER, filename)

@app.route('/api/admin/products', methods=['POST'])
@token_required
def admin_create_product():
    """Create a new product"""
    data = request.get_json() or {}
    name = (data.get('name') or '').strip()
    sku = (data.get('sku') or '').strip()
    price = data.get('price')
    stock = data.get('stock', 0)
    description = (data.get('description') or '').strip()
    image_url = (data.get('image_url') or '').strip()

    if not name:
        return jsonify({'success': False, 'message': 'Nama produk wajib diisi'}), 400

    try:
        price_value = float(price)
        stock_value = int(stock)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Harga dan stok harus berupa angka'}), 400

    if price_value < 0 or stock_value < 0:
        return jsonify({'success': False, 'message': 'Harga dan stok tidak boleh negatif'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()

        # SKU bersifat opsional — kalau kosong, sistem buat otomatis supaya
        # admin tidak perlu memikirkan kode unik sendiri. SKU BOLEH sama antar
        # produk secara sengaja: dipakai untuk mengelompokkan varian produk
        # yang sama (mis. warna berbeda) jadi satu tampilan di halaman produk.
        if not sku:
            sku = f"PRD-{secrets.token_hex(4).upper()}"

        cursor.execute(
            'INSERT INTO products (sku, name, price, stock, description, image_url) VALUES (%s, %s, %s, %s, %s, %s)',
            (sku, name, price_value, stock_value, description, image_url or None)
        )
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Produk berhasil ditambahkan', 'sku': sku}), 201
    except Exception as e:
        print(f'Admin create product error: {e}')
        return jsonify({'success': False, 'message': 'Error menambahkan produk'}), 500

@app.route('/api/admin/products/<int:product_id>', methods=['PUT'])
@token_required
def admin_update_product(product_id):
    """Update product details"""
    data = request.get_json() or {}

    try:
        conn = get_db()
        cursor = conn.cursor()

        updates = []
        values = []

        if 'name' in data:
            updates.append('name = %s')
            values.append((data.get('name') or '').strip())
        if 'sku' in data:
            new_sku = (data.get('sku') or '').strip()
            if new_sku:
                # SKU boleh sama antar produk (dipakai untuk mengelompokkan varian)
                updates.append('sku = %s')
                values.append(new_sku)
        if 'price' in data:
            updates.append('price = %s')
            values.append(float(data.get('price')))
        if 'stock' in data:
            updates.append('stock = %s')
            values.append(int(data.get('stock')))
        if 'description' in data:
            updates.append('description = %s')
            values.append((data.get('description') or '').strip())
        if 'image_url' in data:
            updates.append('image_url = %s')
            values.append((data.get('image_url') or '').strip() or None)

        if not updates:
            cursor.close()
            conn.close()
            return jsonify({'success': False, 'message': 'Tidak ada data yang diubah'}), 400

        values.append(product_id)
        cursor.execute(f'UPDATE products SET {", ".join(updates)} WHERE id = %s', tuple(values))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'message': 'Produk berhasil diupdate'}), 200
    except Exception as e:
        print(f'Admin update product error: {e}')
        return jsonify({'success': False, 'message': 'Error update produk'}), 500

@app.route('/api/admin/products/<int:product_id>', methods=['DELETE'])
@token_required
def admin_delete_product(product_id):
    """Hapus produk. Ditolak kalau produk pernah dipesan (jaga histori pesanan tetap utuh)."""
    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) AS total FROM order_items WHERE product_id = %s', (product_id,))
        row = cursor.fetchone()
        if row and row['total'] > 0:
            cursor.close()
            conn.close()
            return jsonify({
                'success': False,
                'message': 'Produk ini sudah pernah dipesan pelanggan, tidak bisa dihapus (supaya riwayat pesanan tetap utuh). Set stok ke 0 saja kalau ingin menyembunyikannya.'
            }), 400

        cursor.execute('DELETE FROM products WHERE id = %s', (product_id,))
        conn.commit()
        deleted = cursor.rowcount
        cursor.close()
        conn.close()

        if not deleted:
            return jsonify({'success': False, 'message': 'Produk tidak ditemukan'}), 404

        return jsonify({'success': True, 'message': 'Produk berhasil dihapus'}), 200
    except Exception as e:
        print(f'Admin delete product error: {e}')
        return jsonify({'success': False, 'message': 'Error menghapus produk'}), 500

@app.route('/api/admin/products/<int:product_id>/stock', methods=['PUT'])
@token_required
def admin_update_stock(product_id):
    """Update product stock"""
    data = request.get_json() or {}
    stock_value = data.get('stock')

    if stock_value is None:
        return jsonify({'success': False, 'message': 'Jumlah stok wajib diisi'}), 400

    try:
        stock = int(stock_value)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'message': 'Stok harus berupa angka'}), 400

    if stock < 0:
        return jsonify({'success': False, 'message': 'Stok tidak boleh negatif'}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE products SET stock = %s WHERE id = %s', (stock, product_id))
        conn.commit()
        cursor.close()
        conn.close()

        return jsonify({'success': True, 'message': 'Stok berhasil diupdate'}), 200
    except Exception as e:
        print(f'Admin update stock error: {e}')
        return jsonify({'success': False, 'message': 'Error update stok'}), 500

@app.route('/api/admin/users', methods=['GET'])
@token_required
def admin_list_users():
    """List all registered customers"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, username, email, full_name, created_at FROM customers ORDER BY created_at DESC')
        users = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'users': users}), 200
    except Exception as e:
        print(f'Admin list users error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil data pengguna'}), 500

@app.route('/api/admin/orders', methods=['GET'])
@token_required
def admin_list_orders():
    """List all orders with customer and item details"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            SELECT o.id, o.customer_id, c.username, c.email, c.full_name AS customer_name,
                   c.phone AS customer_phone,
                   o.total, o.status, o.payment_method, o.contact_name, o.contact_phone, o.created_at
            FROM orders o
            LEFT JOIN customers c ON c.id = o.customer_id
            ORDER BY o.created_at DESC
        ''')
        orders = cursor.fetchall()

        for order in orders:
            cursor.execute('''
                SELECT oi.qty, oi.price, p.name AS product_name
                FROM order_items oi
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE oi.order_id = %s
            ''', (order['id'],))
            order['items'] = cursor.fetchall()

        cursor.close()
        conn.close()
        return jsonify({'success': True, 'orders': orders}), 200
    except Exception as e:
        print(f'Admin list orders error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil data pesanan'}), 500

@app.route('/api/admin/orders/<int:order_id>/status', methods=['PUT'])
@token_required
def admin_update_order_status(order_id):
    """Update order status"""
    data = request.get_json() or {}
    new_status = (data.get('status') or '').strip().lower()

    if new_status not in ('diproses', 'dikemas'):
        return jsonify({'success': False, 'message': "Status harus 'diproses' atau 'dikemas'"}), 400

    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('UPDATE orders SET status = %s WHERE id = %s', (new_status, order_id))
        conn.commit()
        cursor.close()
        conn.close()

        if cursor.rowcount == 0:
            return jsonify({'success': False, 'message': 'Pesanan tidak ditemukan'}), 404

        return jsonify({'success': True, 'message': 'Status pesanan berhasil diubah'}), 200
    except Exception as e:
        print(f'Admin update order status error: {e}')
        return jsonify({'success': False, 'message': 'Error update status pesanan'}), 500

@app.route('/api/admin/dashboard', methods=['GET'])
@token_required
def admin_dashboard():
    """Return dashboard metrics for sales and users"""
    try:
        conn = get_db()
        cursor = conn.cursor()

        cursor.execute('SELECT COUNT(*) AS total_users FROM customers')
        total_users = cursor.fetchone()['total_users']

        cursor.execute('SELECT COUNT(*) AS total_orders FROM orders')
        total_orders = cursor.fetchone()['total_orders']

        cursor.execute('SELECT COALESCE(SUM(total), 0) AS total_revenue FROM orders')
        total_revenue = cursor.fetchone()['total_revenue']

        cursor.execute("SELECT COUNT(*) AS pending_orders FROM orders WHERE status = 'diproses'")
        pending_orders = cursor.fetchone()['pending_orders']

        cursor.execute('''
            SELECT p.name, SUM(oi.qty) AS total_sold
            FROM order_items oi
            LEFT JOIN products p ON p.id = oi.product_id
            GROUP BY p.id, p.name
            ORDER BY total_sold DESC
            LIMIT 5
        ''')
        top_products = cursor.fetchall()

        cursor.execute('''
            SELECT DATE_FORMAT(created_at, '%x-W%v') AS week_label, SUM(total) AS revenue
            FROM orders
            GROUP BY YEAR(created_at), WEEK(created_at, 1)
            ORDER BY YEAR(created_at), WEEK(created_at, 1)
            LIMIT 8
        ''')
        weekly_revenue = cursor.fetchall()

        cursor.execute('''
            SELECT status, COUNT(*) AS total
            FROM orders
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY status
        ''')
        weekly_status = cursor.fetchall()

        cursor.close()
        conn.close()

        return jsonify({
            'success': True,
            'summary': {
                'total_users': total_users,
                'total_orders': total_orders,
                'total_revenue': float(total_revenue),
                'pending_orders': pending_orders
            },
            'top_products': top_products,
            'weekly_revenue': weekly_revenue,
            'weekly_status': weekly_status
        }), 200
    except Exception as e:
        print(f'Admin dashboard error: {e}')
        return jsonify({'success': False, 'message': 'Error mengambil dashboard'}), 500


# ─── ADMIN: CUSTOMER / ORDER ENDPOINTS ─────────────────

@app.route('/api/admin/customers', methods=['GET'])
@token_required
def admin_list_customers():
    """Return paginated list of customers (no password hashes)"""
    try:
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, username, email, full_name, created_at FROM customers ORDER BY created_at DESC LIMIT %s OFFSET %s', (limit, offset))
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': rows}), 200
    except Exception as e:
        print(f'Admin list customers error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500

@app.route('/api/admin/customers/<int:customer_id>/orders', methods=['GET'])
@token_required
def admin_customer_orders(customer_id):
    """Return orders and items for a given customer"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT id, total, status, created_at FROM orders WHERE customer_id = %s ORDER BY created_at DESC', (customer_id,))
        orders = cursor.fetchall()
        for order in orders:
            cursor.execute('SELECT product_id, qty, price FROM order_items WHERE order_id = %s', (order['id'],))
            items = cursor.fetchall()
            order['items'] = items
        cursor.close()
        conn.close()
        return jsonify({'success': True, 'data': orders}), 200
    except Exception as e:
        print(f'Admin customer orders error: {e}')
        return jsonify({'success': False, 'message': 'Error server'}), 500


# ─── ERROR HANDLERS ───────────────────────────────────

@app.errorhandler(404)
def not_found(error):
    return jsonify({'success': False, 'message': 'Endpoint tidak ditemukan'}), 404

@app.errorhandler(500)
def server_error(error):
    return jsonify({'success': False, 'message': 'Error server'}), 500

# ─── HEALTH CHECK ─────────────────────────────────────

@app.route('/api/health', methods=['GET'])
def health_check():
    """API health check"""
    try:
        conn = get_db()
        conn.close()
        return jsonify({'status': 'healthy', 'database': 'connected'}), 200
    except:
        return jsonify({'status': 'unhealthy', 'database': 'disconnected'}), 503

# ─── MAIN ────────────────────────────────────────────

if __name__ == '__main__':
    # Development server. Debug mode (yang menyalakan Werkzeug interactive
    # debugger — bisa dipakai untuk menjalankan kode arbitrer kalau server
    # ini pernah terekspos ke internet) HANYA menyala kalau FLASK_DEBUG
    # eksplisit diset ke true di .env. Default aman: mati.
    debug_mode = os.getenv('FLASK_DEBUG', 'false').strip().lower() in ('1', 'true', 'yes')
    host = os.getenv('FLASK_RUN_HOST', '127.0.0.1')
    port = int(os.getenv('FLASK_RUN_PORT', 5000))
    app.run(host=host, port=port, debug=debug_mode)
