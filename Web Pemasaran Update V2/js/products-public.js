/**
 * products-public.js — MUSICA JAYA ELEKTRONIK
 * Menampilkan daftar produk publik dalam bentuk baris rapi.
 * Produk dengan SKU yang SAMA dianggap satu keluarga produk (varian, mis.
 * beda warna) dan digabung jadi satu kartu dengan galeri foto yang
 * bergeser otomatis.
 */

const PUBLIC_API_BASE = window.location.protocol === 'file:'
    ? 'http://localhost:5000/api'
    : '/api';

const PRODUCT_CAROUSEL_INTERVAL_MS = 3000;
let productGroupsCache = [];

function formatRupiah(value) {
    return `Rp ${Number(value || 0).toLocaleString('id-ID')}`;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function resolvePublicImageSrc(imageUrl) {
    if (!imageUrl) return 'assets/images/placeholder-product.svg';
    return imageUrl;
}

// Kelompokkan produk berdasarkan SKU. Produk tanpa SKU dianggap grup sendiri-sendiri.
function groupProductsBySku(products) {
    const groups = [];
    const skuToGroupIndex = new Map();

    products.forEach((product) => {
        const sku = (product.sku || '').trim();
        if (sku && skuToGroupIndex.has(sku)) {
            groups[skuToGroupIndex.get(sku)].variants.push(product);
        } else {
            const groupIndex = groups.length;
            groups.push({ key: sku || `single-${product.id}`, variants: [product] });
            if (sku) skuToGroupIndex.set(sku, groupIndex);
        }
    });

    return groups;
}

function renderProductCard(group, groupIndex) {
    const variant = group.variants[0];
    const hasMultipleVariants = group.variants.length > 1;
    const images = group.variants.map((v) => resolvePublicImageSrc(v.image_url));

    const dotsHtml = hasMultipleVariants
        ? `<div class="product-row-dots">${images.map((_, i) => `<span class="dot ${i === 0 ? 'active' : ''}" data-group="${groupIndex}" data-index="${i}"></span>`).join('')}</div>`
        : '';

    return `
        <article class="product-row" data-group-index="${groupIndex}">
            <div class="product-row-image">
                <img src="${images[0]}" alt="${escapeHtml(variant.name)}" data-role="carousel-img"
                     onerror="this.onerror=null;this.src='assets/images/placeholder-product.svg'" />
                ${dotsHtml}
            </div>
            <div class="product-row-info">
                <h3 data-role="carousel-name">${escapeHtml(variant.name)}</h3>
                <p data-role="carousel-desc">${escapeHtml(variant.description) || 'Produk unggulan dari Musica Jaya Elektronik.'}</p>
                ${hasMultipleVariants ? `<p class="muted" style="font-size:12px;">${group.variants.length} varian tersedia</p>` : ''}
            </div>
            <div class="product-row-meta">
                <span class="price" data-role="carousel-price">${formatRupiah(variant.price || 0)}</span>
                <span class="stock" data-role="carousel-stock">Stok: ${variant.stock || 0}</span>
            </div>
            <div class="product-row-actions">
                <a class="btn btn-secondary" data-role="carousel-detail-link" href="product-detail.html?id=${variant.id}">Lihat Detail</a>
                <button class="btn btn-outline" type="button" onclick="addToCartFromGroup(${groupIndex})">Tambah ke Keranjang</button>
                <button class="btn btn-primary" type="button" onclick="buyNowFromGroup(${groupIndex})">Beli</button>
            </div>
        </article>
    `;
}

function startProductCarousels() {
    productGroupsCache.forEach((group, groupIndex) => {
        if (group.variants.length <= 1) return;

        group.currentIndex = 0;
        setInterval(() => {
            group.currentIndex = (group.currentIndex + 1) % group.variants.length;
            updateCarouselDisplay(groupIndex);
        }, PRODUCT_CAROUSEL_INTERVAL_MS);
    });
}

function updateCarouselDisplay(groupIndex) {
    const group = productGroupsCache[groupIndex];
    const card = document.querySelector(`.product-row[data-group-index="${groupIndex}"]`);
    if (!card || !group) return;

    const variant = group.variants[group.currentIndex];
    card.querySelector('[data-role="carousel-img"]').src = resolvePublicImageSrc(variant.image_url);
    card.querySelector('[data-role="carousel-name"]').textContent = variant.name;
    card.querySelector('[data-role="carousel-desc"]').textContent = variant.description || 'Produk unggulan dari Musica Jaya Elektronik.';
    card.querySelector('[data-role="carousel-price"]').textContent = formatRupiah(variant.price || 0);
    card.querySelector('[data-role="carousel-stock"]').textContent = `Stok: ${variant.stock || 0}`;
    card.querySelector('[data-role="carousel-detail-link"]').href = `product-detail.html?id=${variant.id}`;

    card.querySelectorAll('.product-row-dots .dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === group.currentIndex);
    });
}

async function loadPublicProducts() {
    const container = document.getElementById('productList');
    if (!container) return;

    container.innerHTML = '<p>Memuat produk...</p>';

    try {
        const response = await fetch(`${PUBLIC_API_BASE}/products`);
        const data = await response.json();

        if (!data.success || !data.products) {
            throw new Error(data.message || 'Gagal memuat produk');
        }

        if (!data.products.length) {
            container.innerHTML = '<p>Belum ada produk tersedia.</p>';
            return;
        }

        productGroupsCache = groupProductsBySku(data.products);
        container.innerHTML = productGroupsCache.map((group, i) => renderProductCard(group, i)).join('');

        // Klik titik carousel untuk lompat ke varian tertentu
        container.querySelectorAll('.product-row-dots .dot').forEach((dot) => {
            dot.addEventListener('click', () => {
                const groupIndex = Number(dot.dataset.group);
                const index = Number(dot.dataset.index);
                productGroupsCache[groupIndex].currentIndex = index;
                updateCarouselDisplay(groupIndex);
            });
        });

        startProductCarousels();
    } catch (error) {
        container.innerHTML = `<p>${error.message}</p>`;
    }
}

// ─── KERANJANG ─────────────────────────────────────────

function getCurrentVariant(groupIndex) {
    const group = productGroupsCache[groupIndex];
    if (!group) return null;
    return group.variants[group.currentIndex || 0];
}

function addToCart(product) {
    const cart = JSON.parse(localStorage.getItem('cart') || '[]');
    const existing = cart.find((item) => item.id === product.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: Number(product.price || 0),
            quantity: 1,
            image: resolvePublicImageSrc(product.image_url)
        });
    }
    localStorage.setItem('cart', JSON.stringify(cart));
    alert(`${product.name} ditambahkan ke keranjang.`);
}

function addToCartFromGroup(groupIndex) {
    const variant = getCurrentVariant(groupIndex);
    if (variant) addToCart(variant);
}

function buyNowFromGroup(groupIndex) {
    const variant = getCurrentVariant(groupIndex);
    if (variant) window.buyNow(variant.id, variant);
}

// Beli langsung 1 produk (tanpa lewat keranjang dulu) — mengarah ke payment.html
// dengan format data yang sama seperti dari cart.html.
window.buyNow = function (productId, productData) {
    const variant = productData || (productGroupsCache.flatMap((g) => g.variants).find((v) => v.id === productId));
    if (!variant) return;

    const cartData = encodeURIComponent(JSON.stringify([{
        id: variant.id,
        name: variant.name,
        price: Number(variant.price || 0),
        quantity: 1,
        image: resolvePublicImageSrc(variant.image_url)
    }]));
    window.location.href = `payment.html?cart=${cartData}`;
};

window.addEventListener('DOMContentLoaded', loadPublicProducts);
