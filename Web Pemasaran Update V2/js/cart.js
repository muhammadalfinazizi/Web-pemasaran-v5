function getCart() {
    const cart = localStorage.getItem('cart');
    return cart ? JSON.parse(cart) : [];
}

function saveCart(cart) {
    localStorage.setItem('cart', JSON.stringify(cart));
}

function removeFromCart(productId) {
    let cart = getCart();
    cart = cart.filter(item => item.id !== productId);
    saveCart(cart);
    renderCart();
}

function updateQuantity(productId, change) {
    let cart = getCart();
    const item = cart.find(item => item.id === productId);
    if (item) {
        item.quantity += change;
        if (item.quantity <= 0) {
            removeFromCart(productId);
            return;
        }
        saveCart(cart);
        renderCart();
    }
}

function renderCart() {
    const cart = getCart();
    const cartItems = document.getElementById('cartItems');
    const cartEmpty = document.getElementById('cartEmpty');
    const cartContent = document.getElementById('cartContent');
    
    if (cart.length === 0) {
        cartEmpty.style.display = 'block';
        cartContent.style.display = 'none';
        return;
    }
    
    cartEmpty.style.display = 'none';
    cartContent.style.display = 'grid';
    
    let totalItems = 0;
    let totalPrice = 0;
    
    cartItems.innerHTML = cart.map(item => {
        totalItems += item.quantity;
        totalPrice += item.price * item.quantity;
        
        return `
            <div class="cart-item">
                <img src="${item.image}" alt="${item.name}">
                <div class="cart-item-info">
                    <h3>${item.name}</h3>
                    <p class="cart-item-price">Rp. ${item.price.toLocaleString('id-ID')}</p>
                </div>
                <div class="cart-item-actions">
                    <div class="quantity-control">
                        <button onclick="updateQuantity(${item.id}, -1)">-</button>
                        <span>${item.quantity}</span>
                        <button onclick="updateQuantity(${item.id}, 1)">+</button>
                    </div>
                    <button class="btn-remove" onclick="removeFromCart(${item.id})">Hapus</button>
                </div>
            </div>
        `;
    }).join('');
    
    document.getElementById('totalItems').textContent = totalItems;
    document.getElementById('totalPrice').textContent = 'Rp. ' + totalPrice.toLocaleString('id-ID');
}

function checkout() {
    const cart = getCart();
    if (cart.length === 0) return;
    
    const cartData = encodeURIComponent(JSON.stringify(cart));
    window.location.href = `payment.html?cart=${cartData}`;
}

document.addEventListener('DOMContentLoaded', renderCart);