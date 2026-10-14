/**
 * auth.js — MUSICA JAYA ELEKTRONIK
 * Mengelola state login, render header dinamis, dan guard halaman
 */

// Escape teks yang berasal dari input pengguna (nama, email, dsb) sebelum
// dimasukkan lewat innerHTML, supaya nama akun yang berisi tag HTML/skrip
// tidak dieksekusi sebagai kode (stored XSS).
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Render header dengan menu login/profil
async function renderAuthHeader(options = {}) {
    const session = await getSession();
    const isLoggedIn = !!session;

    // Tentukan nav links
    const navLinks = `
        <a href="index.html" ${options.active === 'beranda' ? 'aria-current="page"' : ''}>Beranda</a>
        <a href="products.html" ${options.active === 'produk' ? 'aria-current="page"' : ''}>Produk</a>
        <a href="kontak.html" ${options.active === 'kontak' ? 'aria-current="page"' : ''}>Kontak</a>
        <a href="pengembang.html" ${options.active === 'pengembang' ? 'aria-current="page"' : ''}>Pengembang</a>
    `;

    const authHTML = isLoggedIn ? `
        <div class="auth-menu">
            <button class="auth-avatar-btn" id="authMenuToggle" aria-expanded="false" aria-haspopup="true">
                <div class="avatar-circle">${escapeHtml(session.avatar) || '👤'}</div>
                <span class="auth-name">${escapeHtml(session.nama)}</span>
                <span class="auth-caret">▾</span>
            </button>
            <div class="auth-dropdown" id="authDropdown" hidden>
                <div class="auth-dropdown-header">
                    <div class="avatar-circle large">${escapeHtml(session.avatar) || '👤'}</div>
                    <div>
                        <div class="auth-dropdown-name">${escapeHtml(session.nama)}</div>
                        <div class="auth-dropdown-email">${escapeHtml(session.email)}</div>
                    </div>
                </div>
                <div class="auth-dropdown-divider"></div>
                <a href="history.html" class="auth-dropdown-item">
                    <span>📋</span> Riwayat Pembelian
                </a>
                <button class="auth-dropdown-item danger" onclick="handleLogout()">
                    <span>🚪</span> Keluar
                </button>
            </div>
        </div>
    ` : `
        <a href="login.html" class="btn-login-header">Masuk / Daftar</a>
    `;

    const cartBtn = `<a href="cart.html" class="cart-btn" aria-label="Keranjang belanja"><span aria-hidden="true">🛒</span></a>`;

    // Inject ke header jika sudah ada, atau kembalikan HTML
    const headerActionsEl = document.getElementById('headerAuthArea');
    if (headerActionsEl) {
        headerActionsEl.innerHTML = authHTML;
    }

    const cartEl = document.getElementById('headerCartBtn');
    if (cartEl) {
        cartEl.innerHTML = cartBtn;
    }

    // Toggle dropdown
    setTimeout(() => {
        const toggleBtn = document.getElementById('authMenuToggle');
        const dropdown = document.getElementById('authDropdown');
        if (toggleBtn && dropdown) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = !dropdown.hidden;
                dropdown.hidden = isOpen;
                toggleBtn.setAttribute('aria-expanded', !isOpen);
            });
            document.addEventListener('click', () => {
                dropdown.hidden = true;
                toggleBtn.setAttribute('aria-expanded', 'false');
            });
        }
    }, 100);

    return { isLoggedIn, session };
}

// Logout
async function handleLogout() {
    await clearSession();
    localStorage.removeItem('cart');
    window.location.href = 'index.html';
}

// Guard: redirect ke login jika belum login
async function requireLogin(redirectBack = window.location.href) {
    const session = await getSession();
    if (!session) {
        const encoded = encodeURIComponent(redirectBack);
        window.location.href = `login.html?redirect=${encoded}`;
        return null;
    }
    return session;
}

// Cek login tanpa redirect
async function checkLogin() {
    return await getSession();
}
