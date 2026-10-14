/**
 * recommended.js — MUSICA JAYA ELEKTRONIK
 * Menampilkan beberapa produk unggulan di halaman beranda (index.html)
 * Sumber data: backend API (/api/products)
 */

const RECOMMENDED_API_BASE = window.location.protocol === 'file:'
    ? 'http://localhost:5000/api'
    : '/api';

const RECOMMENDED_LIMIT = 4;
const RECOMMENDED_PLACEHOLDER_IMG = 'assets/images/placeholder-product.svg';

function formatRupiahRecommended(value) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

async function loadRecommendedProducts() {
    const container = document.getElementById('recommendedProducts');
    if (!container) return;

    container.innerHTML = '<p>Memuat produk rekomendasi...</p>';

    try {
        const response = await fetch(`${RECOMMENDED_API_BASE}/products`);
        const data = await response.json();

        if (!data.success || !Array.isArray(data.products)) {
            throw new Error(data.message || 'Gagal memuat produk rekomendasi');
        }

        if (!data.products.length) {
            container.innerHTML = '<p>Belum ada produk yang bisa direkomendasikan saat ini.</p>';
            return;
        }

        const products = data.products.slice(0, RECOMMENDED_LIMIT);

        container.innerHTML = products.map((product) => `
            <article class="recommended-card" role="listitem">
                <img src="${product.image_url || RECOMMENDED_PLACEHOLDER_IMG}"
                     alt="${escapeHtml(product.name)}"
                     loading="lazy"
                     onerror="this.onerror=null;this.src='${RECOMMENDED_PLACEHOLDER_IMG}'">
                <h3>${escapeHtml(product.name)}</h3>
                <div class="recommended-price">${formatRupiahRecommended(product.price)}</div>
                <a class="btn btn-primary" href="product-detail.html?id=${product.id}">Lihat Detail</a>
            </article>
        `).join('');
    } catch (error) {
        console.error('loadRecommendedProducts error:', error);
        container.innerHTML = '<p>Produk rekomendasi belum bisa dimuat. Silakan coba lagi nanti.</p>';
    }
}

window.addEventListener('DOMContentLoaded', loadRecommendedProducts);
