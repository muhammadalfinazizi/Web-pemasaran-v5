/**
 * payment.js — MUSICA JAYA ELEKTRONIK
 * Mengelola halaman pembayaran: menampilkan ringkasan keranjang,
 * memilih metode pembayaran, dan menyimpan pesanan setelah submit.
 */

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

let currentPaymentSession = null;
let selectedPaymentMethod = 'OVO';
let cartItemsForPayment = [];

// item.name berasal dari keranjang di localStorage/URL (bisa diubah manual oleh
// pemiliknya sendiri lewat DevTools) — escape sebelum dimasukkan lewat innerHTML
// supaya tidak jadi self-XSS. escapeHtml() sudah didefinisikan di auth.js yang
// dimuat sebelum file ini di payment.html.

function getCartFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('cart');
    if (!raw) return [];
    try {
        const parsed = JSON.parse(decodeURIComponent(raw));
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Gagal membaca data keranjang dari URL:', error);
        return [];
    }
}

function renderOrderSummary() {
    const summaryList = document.getElementById('productSummary');
    const summaryTotal = document.getElementById('summaryTotal');
    if (!summaryList || !summaryTotal) return;

    if (!cartItemsForPayment.length) {
        summaryList.innerHTML = '<p>Tidak ada produk pada pesanan ini.</p>';
        summaryTotal.textContent = formatRupiah(0);
        return;
    }

    let total = 0;
    summaryList.innerHTML = cartItemsForPayment.map((item) => {
        const subtotal = item.price * item.quantity;
        total += subtotal;
        return `
            <div class="summary-product-item">
                <div>
                    <div class="summary-product-name">${escapeHtml(item.name)}</div>
                    <div class="summary-product-qty">${item.quantity} x ${formatRupiah(item.price)}</div>
                </div>
                <div class="summary-product-name">${formatRupiah(subtotal)}</div>
            </div>
        `;
    }).join('');

    summaryTotal.textContent = formatRupiah(total);
}

function initPaymentMethodPicker() {
    const cards = document.querySelectorAll('.payment-method-card');
    cards.forEach((card) => {
        card.addEventListener('click', () => {
            cards.forEach((c) => {
                c.classList.remove('active');
                c.setAttribute('aria-pressed', 'false');
            });
            card.classList.add('active');
            card.setAttribute('aria-pressed', 'true');
            selectedPaymentMethod = card.dataset.method || selectedPaymentMethod;
        });
    });
}

function showSuccessPopup(order) {
    const overlay = document.getElementById('successOverlay');
    const detail = document.getElementById('popupDetail');
    if (!overlay) return;

    if (detail) {
        detail.innerHTML = `
            <div class="summary-product-item">
                <div class="summary-product-name">Total Pembayaran</div>
                <div class="summary-product-name">${formatRupiah(order.totalPrice)}</div>
            </div>
            <div class="summary-product-item">
                <div class="summary-product-name">Metode</div>
                <div class="summary-product-name">${order.paymentMethod}</div>
            </div>
        `;
    }

    overlay.hidden = false;
}

async function handlePaymentSubmit(event) {
    event.preventDefault();

    if (!cartItemsForPayment.length) {
        alert('Keranjang belanja kosong.');
        return;
    }

    const namaPembeli = document.getElementById('namaPembeli').value.trim();
    const nomorTelepon = document.getElementById('nomorTelepon').value.trim();
    const emailPembeli = document.getElementById('emailPembeli').value.trim();

    if (!namaPembeli || !nomorTelepon || !emailPembeli) {
        alert('Mohon lengkapi semua data pada form.');
        return;
    }

    const totalPrice = cartItemsForPayment.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const orderData = {
        userEmail: currentPaymentSession ? currentPaymentSession.email : emailPembeli,
        items: cartItemsForPayment,
        totalPrice,
        paymentMethod: selectedPaymentMethod,
        namaPembeli,
        telepon: nomorTelepon
    };

    const submitBtn = document.querySelector('.btn-submit');
    if (submitBtn) submitBtn.disabled = true;

    try {
        const result = await saveOrder(orderData);
        localStorage.removeItem('cart');
        showSuccessPopup({ totalPrice, paymentMethod: selectedPaymentMethod, orderId: result.orderId });
    } catch (error) {
        console.error('Gagal menyimpan pesanan:', error);
        alert('Terjadi kesalahan saat menyimpan pesanan. Silakan coba lagi.');
    } finally {
        if (submitBtn) submitBtn.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    currentPaymentSession = await checkLogin();
    await renderAuthHeader({ active: '' });

    if (!currentPaymentSession) {
        window.location.href = 'login.html?redirect=cart.html';
        return;
    }

    cartItemsForPayment = getCartFromUrl();
    renderOrderSummary();
    initPaymentMethodPicker();

    const form = document.getElementById('paymentForm');
    if (form) {
        form.addEventListener('submit', handlePaymentSubmit);
    }
});
