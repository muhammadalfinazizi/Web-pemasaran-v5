# 🔗 Frontend-Backend Integration Guide

## Integrasi Admin Panel dengan Backend API

Panduan lengkap menghubungkan admin.html dengan Flask backend API.

---

## 📋 Setup Checklist

- [ ] Backend API running di `http://localhost:5000`
- [ ] Database MySQL siap dengan admin user
- [ ] CORS sudah dikonfigurasi di backend
- [ ] Frontend HTML siap untuk API integration

---

## 🔧 Integrasi Step by Step

### Step 1: Update Admin Login Handler

Edit bagian login di **admin.html** (cari: `adminLoginForm`):

```javascript
// OLD CODE:
document.getElementById('adminLoginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const pw = document.getElementById('adminPw').value.trim();
    const alertEl = document.getElementById('loginAlert');
    const submitBtn = this.querySelector('button[type="submit"]');

    if (!pw) {
        alertEl.textContent = '❌ Masukkan password admin.';
        alertEl.hidden = false;
        alertEl.className = 'admin-alert error';
        return;
    }

    const ok = adminLogin(pw);
    if (ok) {
        // ... direct to panel
    }
});

// NEW CODE (with API):
document.getElementById('adminLoginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const pw = document.getElementById('adminPw').value.trim();
    const alertEl = document.getElementById('loginAlert');
    const submitBtn = this.querySelector('button[type="submit"]');
    const form = this;

    if (!pw) {
        alertEl.textContent = '❌ Masukkan password admin.';
        alertEl.hidden = false;
        alertEl.className = 'admin-alert error';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Memverifikasi...';

    try {
        // Call backend API
        const response = await fetch('http://localhost:5000/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                username: 'admin',
                password: pw
            })
        });

        const data = await response.json();

        if (data.success) {
            // Save token & session to sessionStorage
            sessionStorage.setItem('adminToken', data.token);
            sessionStorage.setItem('adminSessionId', data.session_id);
            sessionStorage.setItem('adminLoginTime', new Date().toISOString());

            // Clear form
            form.reset();
            alertEl.hidden = true;

            // Show panel
            console.log('✓ Login berhasil');
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('adminPanel').hidden = false;

            // Load data
            await loadAllData();
            showToast('✓ Selamat datang di Panel Admin', 'success');
        } else {
            // Error
            alertEl.textContent = '❌ ' + (data.message || 'Password salah');
            alertEl.hidden = false;
            alertEl.className = 'admin-alert error';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Masuk ke Panel Admin';
        }
    } catch (error) {
        console.error('Login error:', error);
        alertEl.textContent = '❌ Error koneksi ke server (' + (error.message || 'Unknown') + ')';
        alertEl.hidden = false;
        alertEl.className = 'admin-alert error';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Masuk ke Panel Admin';
    }
});
```

### Step 2: Create API Helper Functions

Tambahkan di **admin.html** (dalam `<script>` tag):

```javascript
// ─── API BASE URL ────────────────────────────────────
const API_BASE_URL = 'http://localhost:5000/api';

// ─── GET TOKEN ───────────────────────────────────────
function getAdminToken() {
    return sessionStorage.getItem('adminToken') || '';
}

// ─── API HELPER ───────────────────────────────────────
async function apiCall(endpoint, method = 'GET', body = null) {
    const token = getAdminToken();
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        const data = await response.json();

        if (response.status === 401) {
            // Token expired/invalid
            console.log('✗ Session expired');
            doAdminLogout();
            return { success: false, message: 'Session expired' };
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        return { success: false, message: error.message };
    }
}

// ─── VERIFY SESSION ──────────────────────────────────
async function verifyAdminSession() {
    const result = await apiCall('/auth/verify');
    return result.success || false;
}

// ─── LOGOUT ──────────────────────────────────────────
async function logoutFromAPI() {
    try {
        await apiCall('/auth/logout', 'POST');
    } catch (e) {
        console.error('Logout error:', e);
    }
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('adminSessionId');
}
```

### Step 3: Update Logout Function

```javascript
// Update doAdminLogout function
async function doAdminLogout() {
    // Logout dari API
    await logoutFromAPI();
    
    // Clear local storage
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('adminSessionId');
    sessionStorage.removeItem('adminLoginTime');
    
    // Reset UI
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('adminPanel').hidden = true;
    document.getElementById('adminPw').value = '';
    
    showToast('✓ Logout berhasil', 'success');
}
```

### Step 4: Update Auto-Logout on Close

```javascript
// Replace existing beforeunload handler:
window.addEventListener('beforeunload', async function() {
    if (sessionStorage.getItem('adminToken')) {
        // Optional: Log activity
        console.log('Admin closing window');
        
        // Logout via API (async tidak dijamin selesai)
        logoutFromAPI().catch(e => console.error('Logout error:', e));
    }
});

window.addEventListener('unload', function() {
    // Final cleanup
    sessionStorage.removeItem('adminToken');
    sessionStorage.removeItem('adminSessionId');
});
```

### Step 5: Update Change Password Handler

```javascript
// Replace password change form handler:
document.getElementById('pwChangeForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const current = document.getElementById('pwCurrent').value;
    const newPw = document.getElementById('pwNew').value;
    const confirmPw = document.getElementById('pwConfirm').value;
    const alertEl = document.getElementById('pwChangeAlert');
    const submitBtn = this.querySelector('button[type="submit"]');

    // Validations
    if (!current || !newPw || !confirmPw) {
        alertEl.textContent = '❌ Semua field harus diisi';
        alertEl.className = 'admin-alert error';
        alertEl.hidden = false;
        return;
    }
    if (newPw.length < 8) {
        alertEl.textContent = '❌ Password minimal 8 karakter';
        alertEl.className = 'admin-alert error';
        alertEl.hidden = false;
        return;
    }
    if (newPw !== confirmPw) {
        alertEl.textContent = '❌ Konfirmasi password tidak cocok';
        alertEl.className = 'admin-alert error';
        alertEl.hidden = false;
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan...';

    try {
        const result = await apiCall('/admin/password', 'PUT', {
            current_password: current,
            new_password: newPw
        });

        alertEl.hidden = false;
        if (result.success) {
            alertEl.textContent = '✅ Password berhasil diubah';
            alertEl.className = 'admin-alert';
            alertEl.style.background = 'rgba(25,200,120,0.15)';
            alertEl.style.borderColor = 'rgba(25,200,120,0.4)';
            alertEl.style.color = '#5eeabb';
            this.reset();
            showToast('✓ Password admin berhasil diubah', 'success');
        } else {
            alertEl.textContent = '❌ ' + (result.message || 'Error mengubah password');
            alertEl.className = 'admin-alert error';
        }
    } catch (error) {
        alertEl.textContent = '❌ Error: ' + error.message;
        alertEl.className = 'admin-alert error';
        alertEl.hidden = false;
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan Password Baru';
    }
});
```

### Step 6: Session Check on Page Load

```javascript
// Add at beginning of script
window.addEventListener('load', async () => {
    const token = sessionStorage.getItem('adminToken');
    
    if (token) {
        // Check if session still valid
        const isValid = await verifyAdminSession();
        
        if (isValid) {
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('adminPanel').hidden = false;
            await loadAllData();
        } else {
            // Session invalid/expired
            console.log('✗ Session tidak valid');
            doAdminLogout();
        }
    }
});
```

---

## 🧪 Testing Checklist

- [ ] Login dengan password benar → Masuk ke panel
- [ ] Login dengan password salah → Error message muncul
- [ ] Refresh halaman → Tetap login (session persistent)
- [ ] Close tab → Logout otomatis
- [ ] Change password berhasil
- [ ] Logout button → Kembali ke login
- [ ] API responses correct format
- [ ] Token validation working

---

## 🚨 Troubleshooting

### ❌ CORS Error

```
Access to XMLHttpRequest at 'http://localhost:5000/...' from origin 'http://localhost:8000' 
has been blocked by CORS policy
```

**Solution:**
- Update `CORS_ORIGINS` di backend `.env`
- Restart backend server

### ❌ Token Invalid Error

```javascript
{success: false, message: "Token tidak valid atau sudah expired"}
```

**Solution:**
- Check token expiration time
- Verify token is being sent in Authorization header
- Re-login untuk mendapatkan token baru

### ❌ Session Not Persisting After Refresh

**Solution:**
```javascript
// Add this to verify session on load
window.addEventListener('load', async () => {
    const token = sessionStorage.getItem('adminToken');
    if (token) {
        const isValid = await verifyAdminSession();
        if (!isValid) {
            doAdminLogout();
        }
    }
});
```

---

## 📊 Production Considerations

1. **HTTPS Only**: Use HTTPS in production
2. **Secure Cookies**: Set secure flag for cookies
3. **CSRF Protection**: Implement CSRF tokens
4. **Rate Limiting**: Limit login attempts
5. **Logging**: Log all admin activities
6. **Error Handling**: Don't expose sensitive errors
7. **Session Timeout**: Set appropriate timeout (1 hour recommended)
8. **Token Rotation**: Rotate tokens periodically

---

## 📚 Related Documentation

- [Backend QUICKSTART](./BACKEND_QUICKSTART.md)
- [BACKEND_SETUP](./BACKEND_SETUP.md)
- [Database Schema](./database_schema.py)

---

Happy coding! 🎉

