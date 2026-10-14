const PUBLIC_API_BASE = window.location.protocol === 'file:' ? 'http://localhost:5000/api' : '/api';

function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

async function loadProductDetail() {
    const id = getQueryParam('id');
    const container = document.getElementById('productInfo');
    const imageContainer = document.getElementById('mainImage');

    if (!id || !container) return;

    try {
        const response = await fetch(`${PUBLIC_API_BASE}/products/${id}`);
        const data = await response.json();

        if (!data.success || !data.product) {
            throw new Error(data.message || 'Produk tidak ditemukan');
        }

        const product = data.product;
        imageContainer.innerHTML = `<img src="${product.image_url || 'assets/images/placeholder-product.svg'}" alt="${escapeHtml(product.name)}" onerror="this.onerror=null;this.src='assets/images/placeholder-product.svg'" />`;
        container.innerHTML = `
            <h2>${escapeHtml(product.name)}</h2>
            <p class="muted">SKU: ${escapeHtml(product.sku) || '-'}</p>
            <p>${escapeHtml(product.description) || 'Produk unggulan dari Musica Jaya Elektronik.'}</p>
            <div class="price">${formatRupiah(product.price || 0)}</div>
            <div class="stock">Stok tersedia: ${product.stock || 0}</div>
            <a class="btn btn-primary" href="products.html">Kembali ke Produk</a>
        `;
    } catch (error) {
        container.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
    }
}

window.addEventListener('DOMContentLoaded', loadProductDetail);
