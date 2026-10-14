const API_BASE = window.location.protocol === 'file:' ? 'http://localhost:5000/api' : '/api';
let token = '';

// Escape teks sebelum dimasukkan lewat innerHTML. Data pelanggan (nama,
// email, nama kontak pesanan) diisi sendiri oleh pelanggan saat registrasi/
// checkout, jadi HARUS dianggap tidak tepercaya di sini — tanpa ini,
// pelanggan bisa mendaftar dengan nama berisi <script>/onerror="..." yang
// akan tereksekusi di browser admin (bisa mencuri token admin di sessionStorage).
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function showMessage(element, type, text) {
    element.className = `status ${type}`;
    element.textContent = text;
}

function setAuthToken(newToken) {
    token = newToken;
    sessionStorage.setItem('adminToken', newToken);
}

function getAuthToken() {
    return sessionStorage.getItem('adminToken') || token || '';
}

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function apiRequest(path, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (getAuthToken()) {
        headers.Authorization = `Bearer ${getAuthToken()}`;
    }

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const text = await response.text();
    let data = {};

    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        data = { message: text || 'Respons server tidak valid' };
    }

    if (!response.ok) {
        throw new Error(data.message || 'Permintaan gagal');
    }

    return data;
}

async function loginAdmin(event) {
    event.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    const messageBox = document.getElementById('messageBox');

    try {
        const data = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });

        if (data.success) {
            setAuthToken(data.token);
            showMessage(messageBox, 'success', 'Login berhasil');
            document.getElementById('loginView').classList.add('hidden');
            document.getElementById('dashboardView').classList.remove('hidden');
            await loadDashboard();
        } else {
            showMessage(messageBox, 'error', data.message || 'Login gagal');
        }
    } catch (error) {
        const message = error.message || 'Tidak dapat terhubung ke backend';
        const detail = message.includes('Failed to fetch')
            ? 'Backend Flask belum aktif atau URL API tidak bisa dijangkau. Pastikan server berjalan di port 5000 atau gunakan server dengan proxy /api.'
            : message;
        showMessage(messageBox, 'error', detail);
    }
}

async function loadDashboard() {
    const message = document.getElementById('dashboardMessage');
    try {
        const data = await apiRequest('/admin/dashboard');
        if (!data.success) throw new Error(data.message || 'Gagal mengambil dashboard');

        document.getElementById('totalUsers').textContent = data.summary.total_users;
        document.getElementById('totalOrders').textContent = data.summary.total_orders;
        document.getElementById('totalRevenue').textContent = formatRupiah(data.summary.total_revenue);
        document.getElementById('pendingOrders').textContent = data.summary.pending_orders;

        renderTopProducts(data.top_products || []);
        renderWeeklyRevenue(data.weekly_revenue || []);
        renderWeeklyStatus(data.weekly_status || []);

        await Promise.all([loadUsers(), loadOrders(), loadProducts()]);
    } catch (error) {
        showMessage(message, 'error', error.message || 'Gagal memuat dashboard');
    }
}

function renderTopProducts(items) {
    const container = document.getElementById('topProductsChart');
    if (!items.length) {
        container.innerHTML = '<div class="muted">Belum ada data penjualan.</div>';
        return;
    }

    const max = Math.max(...items.map(item => Number(item.total_sold || 0)), 1);
    container.innerHTML = items.map((item) => `
        <div class="bar-item">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:14px;">
                <span>${item.name || '-'}</span>
                <strong>${item.total_sold || 0} terjual</strong>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width:${(Number(item.total_sold || 0) / max) * 100}%;"></div>
            </div>
        </div>
    `).join('');
}

function renderWeeklyRevenue(items) {
    const container = document.getElementById('weeklyRevenueChart');
    if (!items.length) {
        container.innerHTML = '<div class="muted">Belum ada data minggu.</div>';
        return;
    }

    const max = Math.max(...items.map(item => Number(item.revenue || 0)), 1);
    container.innerHTML = items.map((item) => `
        <div class="bar-item">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:14px;">
                <span>${item.week_label || '-'}</span>
                <strong>${formatRupiah(item.revenue || 0)}</strong>
            </div>
            <div class="bar-track">
                <div class="bar-fill" style="width:${(Number(item.revenue || 0) / max) * 100}%;"></div>
            </div>
        </div>
    `).join('');
}

function renderWeeklyStatus(items) {
    const container = document.getElementById('weeklyStatusList');
    if (!items.length) {
        container.innerHTML = '<div class="muted">Belum ada status minggu ini.</div>';
        return;
    }

    container.innerHTML = items.map((item) => `
        <div class="bar-item">
            <div style="display:flex;justify-content:space-between;gap:8px;font-size:14px;">
                <span>${item.status || '-'}</span>
                <strong>${item.total || 0} pesanan</strong>
            </div>
        </div>
    `).join('');
}

async function loadUsers() {
    const body = document.getElementById('usersTableBody');
    try {
        const data = await apiRequest('/admin/users');
        if (!data.success) throw new Error(data.message || 'Gagal mengambil pengguna');
        if (!data.users || !data.users.length) {
            body.innerHTML = '<tr><td colspan="4" class="muted">Belum ada pengguna terdaftar.</td></tr>';
            return;
        }
        body.innerHTML = data.users.map((user) => `
            <tr>
                <td>${escapeHtml(user.full_name) || '-'}</td>
                <td>${escapeHtml(user.email) || '-'}</td>
                <td>${escapeHtml(user.username) || '-'}</td>
                <td>${formatDate(user.created_at)}</td>
            </tr>
        `).join('');
    } catch (error) {
        body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

// Format nomor telepon Indonesia ke format wa.me (62xxxxxxxxxx)
function toWhatsAppNumber(phone) {
    if (!phone) return '';
    let digits = String(phone).replace(/[^0-9]/g, '');
    if (digits.startsWith('0')) digits = '62' + digits.slice(1);
    if (!digits.startsWith('62')) digits = '62' + digits;
    return digits;
}

async function loadOrders() {
    const body = document.getElementById('ordersTableBody');
    try {
        const data = await apiRequest('/admin/orders');
        if (!data.success) throw new Error(data.message || 'Gagal mengambil pesanan');
        if (!data.orders || !data.orders.length) {
            body.innerHTML = '<tr><td colspan="6" class="muted">Belum ada pesanan.</td></tr>';
            return;
        }
        body.innerHTML = data.orders.map((order) => {
            const itemsList = (order.items || [])
                .map((item) => `${escapeHtml(item.product_name) || 'Produk'} × ${item.qty || 0}`)
                .join('<br>') || '-';

            const waNumber = toWhatsAppNumber(order.contact_phone || order.customer_phone);
            const waLink = waNumber
                ? `<a href="https://wa.me/${waNumber}?text=${encodeURIComponent('Halo ' + (order.contact_name || order.customer_name || '') + ', terkait pesanan Anda di Musica Jaya Elektronik...')}" target="_blank" rel="noopener noreferrer" class="wa-btn">💬 Hubungi via WA</a>`
                : '<span class="muted">No. HP tidak ada</span>';

            const status = order.status === 'dikemas' ? 'dikemas' : 'diproses';

            return `
                <tr>
                    <td>
                        <strong>${escapeHtml(order.contact_name || order.customer_name) || '-'}</strong><br>
                        <span class="muted" style="font-size:13px;">${escapeHtml(order.email) || '-'}</span>
                    </td>
                    <td style="font-size:13px;">${itemsList}</td>
                    <td>${formatRupiah(order.total || 0)}</td>
                    <td><span class="pill status-pill status-${status}">${status === 'dikemas' ? 'Dikemas' : 'Sedang Diproses'}</span></td>
                    <td>${waLink}</td>
                    <td>
                        <select id="status-${order.id}">
                            <option value="diproses" ${status === 'diproses' ? 'selected' : ''}>Sedang Diproses</option>
                            <option value="dikemas" ${status === 'dikemas' ? 'selected' : ''}>Dikemas (Diterima)</option>
                        </select>
                        <button type="button" onclick="updateOrderStatus(${order.id})" style="margin-top: 6px; width: auto;">Simpan</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        body.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(error.message)}</td></tr>`;
    }
}

async function uploadProductImage(fileInputEl) {
    const file = fileInputEl.files && fileInputEl.files[0];
    if (!file) return null;

    const formData = new FormData();
    formData.append('image', file);

    const response = await fetch(`${API_BASE}/admin/upload-image`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAuthToken()}` },
        body: formData
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
        throw new Error(data.message || 'Gagal upload foto');
    }
    return data.image_url;
}

function setupImagePreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) { preview.classList.add('hidden'); return; }
        preview.src = URL.createObjectURL(file);
        preview.classList.remove('hidden');
    });
}

function resolveImageSrc(imageUrl) {
    if (!imageUrl) return '';
    // image_url dari upload berupa path relatif (/uploads/products/xxx) — arahkan ke API_BASE origin
    if (imageUrl.startsWith('/uploads/')) {
        return API_BASE.replace(/\/api\/?$/, '') + imageUrl;
    }
    return imageUrl;
}

async function loadProducts() {
    const body = document.getElementById('productTableBody');
    try {
        const data = await apiRequest('/admin/products');
        if (!data.success) throw new Error(data.message || 'Gagal mengambil data produk');
        if (!data.products || !data.products.length) {
            body.innerHTML = '<tr><td colspan="6" class="muted">Belum ada produk.</td></tr>';
            return;
        }
        window.__productsCache = data.products;
        body.innerHTML = data.products.map((product) => `
            <tr>
                <td>
                    <img src="${resolveImageSrc(product.image_url) || 'assets/images/placeholder-product.svg'}"
                         alt="${escapeHtml(product.name)}" style="width:48px; height:48px; object-fit:cover; border-radius:6px;"
                         onerror="this.onerror=null;this.src='assets/images/placeholder-product.svg'">
                </td>
                <td>${escapeHtml(product.name)}</td>
                <td>${escapeHtml(product.sku) || '-'}</td>
                <td>${formatRupiah(product.price || 0)}</td>
                <td>${product.stock || 0}</td>
                <td>
                    <button type="button" onclick="openEditProduct(${product.id})" style="width:auto;">Edit</button>
                    <button type="button" onclick="deleteProduct(${product.id})" style="width:auto; background:var(--danger);">Hapus</button>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        body.innerHTML = `<tr><td colspan="6" class="muted">${error.message}</td></tr>`;
    }
}

async function deleteProduct(productId) {
    const message = document.getElementById('dashboardMessage');
    const product = (window.__productsCache || []).find((p) => p.id === productId);
    const confirmText = `Hapus produk "${product ? product.name : 'ini'}"? Tindakan ini tidak bisa dibatalkan.`;
    if (!window.confirm(confirmText)) return;

    try {
        const data = await apiRequest(`/admin/products/${productId}`, { method: 'DELETE' });
        showMessage(message, 'success', data.message || 'Produk berhasil dihapus');
        await loadProducts();
    } catch (error) {
        showMessage(message, 'error', error.message || 'Gagal menghapus produk');
    }
}

function openEditProduct(productId) {
    const product = (window.__productsCache || []).find((p) => p.id === productId);
    if (!product) return;

    document.getElementById('editProductId').value = product.id;
    document.getElementById('editProductName').value = product.name || '';
    document.getElementById('editProductSku').value = product.sku || '';
    document.getElementById('editProductPrice').value = product.price || 0;
    document.getElementById('editProductStock').value = product.stock || 0;
    document.getElementById('editProductDescription').value = product.description || '';

    const preview = document.getElementById('editProductImagePreview');
    const currentSrc = resolveImageSrc(product.image_url);
    if (currentSrc) {
        preview.src = currentSrc;
        preview.classList.remove('hidden');
    } else {
        preview.classList.add('hidden');
    }
    document.getElementById('editProductImage').value = '';

    document.getElementById('editProductModal').classList.remove('hidden');
}

function closeEditProduct() {
    document.getElementById('editProductModal').classList.add('hidden');
}

async function saveEditProduct() {
    const message = document.getElementById('dashboardMessage');
    const productId = document.getElementById('editProductId').value;
    const imageInput = document.getElementById('editProductImage');

    try {
        const payload = {
            name: document.getElementById('editProductName').value.trim(),
            sku: document.getElementById('editProductSku').value.trim(),
            price: document.getElementById('editProductPrice').value,
            stock: document.getElementById('editProductStock').value,
            description: document.getElementById('editProductDescription').value.trim()
        };

        if (imageInput.files && imageInput.files[0]) {
            payload.image_url = await uploadProductImage(imageInput);
        }

        const data = await apiRequest(`/admin/products/${productId}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        showMessage(message, 'success', data.message || 'Produk berhasil diupdate');
        closeEditProduct();
        await loadProducts();
    } catch (error) {
        showMessage(message, 'error', error.message || 'Gagal update produk');
    }
}

async function updateOrderStatus(orderId) {
    const message = document.getElementById('dashboardMessage');
    const select = document.getElementById(`status-${orderId}`);
    const status = select ? select.value : '';

    try {
        const data = await apiRequest(`/admin/orders/${orderId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        showMessage(message, 'success', data.message || 'Status berhasil diubah');
        await loadOrders();
    } catch (error) {
        showMessage(message, 'error', error.message || 'Gagal ubah status');
    }
}

async function addProduct() {
    const message = document.getElementById('dashboardMessage');
    const imageInput = document.getElementById('newProductImage');

    const payload = {
        name: document.getElementById('newProductName').value.trim(),
        sku: document.getElementById('newProductSku').value.trim(),
        price: document.getElementById('newProductPrice').value,
        stock: document.getElementById('newProductStock').value,
        description: document.getElementById('newProductDescription').value.trim()
    };

    try {
        if (imageInput && imageInput.files && imageInput.files[0]) {
            payload.image_url = await uploadProductImage(imageInput);
        }

        const data = await apiRequest('/admin/products', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showMessage(message, 'success', data.message || 'Produk berhasil ditambahkan');
        document.getElementById('newProductName').value = '';
        document.getElementById('newProductSku').value = '';
        document.getElementById('newProductPrice').value = '';
        document.getElementById('newProductStock').value = '';
        document.getElementById('newProductDescription').value = '';
        if (imageInput) imageInput.value = '';
        const preview = document.getElementById('newProductImagePreview');
        if (preview) preview.classList.add('hidden');
        await loadProducts();
    } catch (error) {
        showMessage(message, 'error', error.message || 'Gagal menambahkan produk');
    }
}

// ─── PENGATURAN SITUS (foto & teks halaman publik) ────

const SITE_SETTING_IMAGE_FIELDS = [
    { key: 'about_image', inputId: 'siteAboutImage', previewId: 'siteAboutImagePreview' },
    { key: 'contact_image', inputId: 'siteContactImage', previewId: 'siteContactImagePreview' },
    { key: 'team_photo_1', inputId: 'siteTeamPhoto1', previewId: 'siteTeamPhoto1Preview' },
    { key: 'team_photo_2', inputId: 'siteTeamPhoto2', previewId: 'siteTeamPhoto2Preview' },
    { key: 'team_photo_3', inputId: 'siteTeamPhoto3', previewId: 'siteTeamPhoto3Preview' },
    { key: 'team_photo_4', inputId: 'siteTeamPhoto4', previewId: 'siteTeamPhoto4Preview' },
    { key: 'team_photo_5', inputId: 'siteTeamPhoto5', previewId: 'siteTeamPhoto5Preview' }
];

async function loadSiteSettings() {
    const message = document.getElementById('dashboardMessage');
    try {
        const data = await apiRequest('/site-settings');
        if (!data.success) throw new Error(data.message || 'Gagal mengambil pengaturan situs');
        const settings = data.settings || {};

        document.getElementById('siteAboutDescription').value = settings.about_description || '';
        document.getElementById('siteContactPhone').value = settings.contact_phone || '';
        document.getElementById('siteContactAddress').value = settings.contact_address || '';
        document.getElementById('siteContactHours').value = settings.contact_hours || '';

        SITE_SETTING_IMAGE_FIELDS.forEach(({ key, previewId }) => {
            const preview = document.getElementById(previewId);
            const src = resolveImageSrc(settings[key]);
            if (preview && src) {
                preview.src = src;
                preview.classList.remove('hidden');
            }
        });

        window.__siteSettingsLoaded = true;
    } catch (error) {
        showMessage(message, 'error', error.message || 'Gagal memuat pengaturan situs');
    }
}

async function saveSiteSettings() {
    const message = document.getElementById('dashboardMessage');
    try {
        const payload = {
            about_description: document.getElementById('siteAboutDescription').value.trim(),
            contact_phone: document.getElementById('siteContactPhone').value.trim(),
            contact_address: document.getElementById('siteContactAddress').value.trim(),
            contact_hours: document.getElementById('siteContactHours').value.trim()
        };

        // Upload foto yang baru dipilih saja (kalau tidak diganti, foto lama tetap dipakai)
        for (const { key, inputId } of SITE_SETTING_IMAGE_FIELDS) {
            const input = document.getElementById(inputId);
            if (input && input.files && input.files[0]) {
                payload[key] = await uploadProductImage(input);
            }
        }

        const data = await apiRequest('/admin/site-settings', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });
        showMessage(message, 'success', data.message || 'Pengaturan situs berhasil disimpan');

        SITE_SETTING_IMAGE_FIELDS.forEach(({ inputId }) => {
            const input = document.getElementById(inputId);
            if (input) input.value = '';
        });

        await loadSiteSettings();
    } catch (error) {
        showMessage(message, 'error', error.message || 'Gagal menyimpan pengaturan situs');
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tabName));
    document.getElementById('overviewTab').classList.toggle('hidden', tabName !== 'overview');
    document.getElementById('usersTab').classList.toggle('hidden', tabName !== 'users');
    document.getElementById('ordersTab').classList.toggle('hidden', tabName !== 'orders');
    document.getElementById('stockTab').classList.toggle('hidden', tabName !== 'stock');
    document.getElementById('siteTab').classList.toggle('hidden', tabName !== 'site');
    if (tabName === 'site' && !window.__siteSettingsLoaded) {
        loadSiteSettings();
    }
}

function logoutAdmin() {
    sessionStorage.removeItem('adminToken');
    document.getElementById('dashboardView').classList.add('hidden');
    document.getElementById('loginView').classList.remove('hidden');
    document.getElementById('loginForm').reset();
    document.getElementById('messageBox').className = 'status';
    document.getElementById('messageBox').textContent = '';
    document.getElementById('dashboardMessage').className = 'status';
    document.getElementById('dashboardMessage').textContent = '';
}

function initAdminPage() {
    const loginForm = document.getElementById('loginForm');
    const logoutBtn = document.getElementById('logoutBtn');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const addProductBtn = document.getElementById('addProductBtn');
    const saveEditProductBtn = document.getElementById('saveEditProductBtn');
    const cancelEditProductBtn = document.getElementById('cancelEditProductBtn');
    const editProductModal = document.getElementById('editProductModal');
    const saveSiteSettingsBtn = document.getElementById('saveSiteSettingsBtn');

    if (loginForm) {
        loginForm.addEventListener('submit', loginAdmin);
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', logoutAdmin);
    }

    if (tabButtons && tabButtons.length) {
        tabButtons.forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    }

    if (addProductBtn) {
        addProductBtn.addEventListener('click', addProduct);
    }

    if (saveEditProductBtn) {
        saveEditProductBtn.addEventListener('click', saveEditProduct);
    }

    if (cancelEditProductBtn) {
        cancelEditProductBtn.addEventListener('click', closeEditProduct);
    }

    if (editProductModal) {
        // Klik di area gelap luar kotak modal juga menutup modal
        editProductModal.addEventListener('click', (event) => {
            if (event.target === editProductModal) closeEditProduct();
        });
    }

    setupImagePreview('newProductImage', 'newProductImagePreview');
    setupImagePreview('editProductImage', 'editProductImagePreview');

    if (saveSiteSettingsBtn) {
        saveSiteSettingsBtn.addEventListener('click', saveSiteSettings);
    }
    SITE_SETTING_IMAGE_FIELDS.forEach(({ inputId, previewId }) => setupImagePreview(inputId, previewId));

    const token = getAuthToken();
    if (token) {
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('dashboardView').classList.remove('hidden');
        loadDashboard().catch(() => {});
    }
}

document.addEventListener('DOMContentLoaded', initAdminPage);
