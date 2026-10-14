/**
 * database.js — MUSICA JAYA ELEKTRONIK
 * Lapisan akun pelanggan, sesi login, dan riwayat pesanan.
 * Semua data sekarang tersimpan terpusat di MySQL lewat backend API
 * (sebelumnya versi lama menyimpan di IndexedDB browser).
 *
 * Nama-nama fungsi sengaja dipertahankan sama seperti versi lama supaya
 * halaman lain (register.html, login.html, payment.js, history.html)
 * tidak perlu diubah.
 */

const DB_API_BASE = window.location.protocol === 'file:'
    ? 'http://localhost:5000/api'
    : '/api';

const SESSION_STORAGE_KEY = 'mj_customer_session';

// ─── USER MANAGEMENT (via backend API) ────────────────

async function registerUser(userData) {
    const response = await fetch(`${DB_API_BASE}/customer/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            full_name: userData.nama,
            phone: userData.telepon,
            email: userData.email,
            password: userData.password
        })
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
        return Promise.reject({ success: false, message: data.message || 'Registrasi gagal' });
    }

    return {
        success: true,
        user: {
            email: data.customer.email,
            nama: data.customer.full_name,
            telepon: data.customer.phone,
            avatar: (data.customer.full_name || '?').trim().charAt(0).toUpperCase(),
            token: data.token
        }
    };
}

async function loginUser(email, password) {
    const response = await fetch(`${DB_API_BASE}/customer/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
        return Promise.reject({ success: false, message: data.message || 'Login gagal' });
    }

    return {
        success: true,
        user: {
            email: data.customer.email,
            nama: data.customer.full_name,
            telepon: data.customer.phone,
            avatar: (data.customer.full_name || '?').trim().charAt(0).toUpperCase(),
            token: data.token
        }
    };
}

// Dipanggil setelah login sukses. Riwayat login sudah otomatis tercatat
// di server (tabel customer_sessions), jadi di sisi client cukup no-op.
async function recordUserLogin() {
    return Promise.resolve({ success: true });
}

// ─── SESSION MANAGEMENT (localStorage, menyimpan token API) ───

async function saveSession(user) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
}

async function getSession() {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;

    let session;
    try {
        session = JSON.parse(raw);
    } catch (error) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
    }

    if (!session || !session.token) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        return null;
    }

    return session;
}

async function clearSession() {
    const session = await getSession();
    if (session && session.token) {
        try {
            await fetch(`${DB_API_BASE}/customer/logout`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${session.token}` }
            });
        } catch (error) {
            // Abaikan error jaringan saat logout — tetap hapus sesi lokal.
            console.warn('Gagal logout di server, sesi lokal tetap dihapus:', error);
        }
    }
    localStorage.removeItem(SESSION_STORAGE_KEY);
}

// ─── ORDER MANAGEMENT (via backend API) ───────────────

async function saveOrder(orderData) {
    const session = await getSession();
    if (!session || !session.token) {
        return Promise.reject({ success: false, message: 'Silakan login terlebih dahulu' });
    }

    const response = await fetch(`${DB_API_BASE}/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`
        },
        body: JSON.stringify({
            items: orderData.items,
            payment_method: orderData.paymentMethod,
            contact_name: orderData.namaPembeli,
            contact_phone: orderData.telepon
        })
    });
    const data = await response.json();

    if (!response.ok || !data.success) {
        return Promise.reject({ success: false, message: data.message || 'Gagal menyimpan pesanan' });
    }

    return { success: true, orderId: data.order_id };
}

async function getOrdersByUser() {
    const session = await getSession();
    if (!session || !session.token) return [];

    try {
        const response = await fetch(`${DB_API_BASE}/customer/orders`, {
            headers: { Authorization: `Bearer ${session.token}` }
        });
        const data = await response.json();
        if (!data.success || !Array.isArray(data.orders)) return [];

        // Samakan bentuk data dengan format lama yang dipakai history.html
        return data.orders.map((order) => ({
            orderId: order.id,
            createdAt: order.created_at,
            status: order.status === 'dikemas' ? 'Dikemas' : 'Diproses',
            paymentMethod: order.payment_method || '-',
            namaPembeli: order.contact_name || session.nama || '-',
            telepon: order.contact_phone || session.telepon || '-',
            totalPrice: Number(order.total || 0),
            items: (order.items || []).map((item) => ({
                name: item.product_name || 'Produk',
                quantity: Number(item.qty || 0),
                price: Number(item.price || 0)
            }))
        }));
    } catch (error) {
        console.error('getOrdersByUser error:', error);
        return [];
    }
}

// ─── UTILS ───────────────────────────────────────────

function formatRupiah(amount) {
    return 'Rp ' + Number(amount || 0).toLocaleString('id-ID');
}

function formatDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('id-ID', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}
