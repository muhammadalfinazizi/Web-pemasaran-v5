/**
 * site-settings.js — MUSICA JAYA ELEKTRONIK
 * Mengambil pengaturan situs (foto & teks) dari backend dan menerapkannya
 * ke elemen halaman yang relevan. Dipakai di index.html, kontak.html,
 * dan pengembang.html supaya semua bisa diubah lewat admin.html
 * tanpa perlu edit file HTML manual.
 */

const SITE_SETTINGS_API_BASE = window.location.protocol === 'file:'
    ? 'http://localhost:5000/api'
    : '/api';

function resolveSettingImageSrc(path) {
    if (!path) return '';
    if (path.startsWith('/uploads/')) {
        return SITE_SETTINGS_API_BASE.replace(/\/api\/?$/, '') + path;
    }
    return path;
}

async function applySiteSettings() {
    try {
        const response = await fetch(`${SITE_SETTINGS_API_BASE}/site-settings`);
        const data = await response.json();
        if (!data.success || !data.settings) return;

        const settings = data.settings;

        // ── Beranda: foto & deskripsi "Tentang Toko" ──
        const aboutImg = document.querySelector('[data-setting="about_image"]');
        if (aboutImg && settings.about_image) {
            aboutImg.src = resolveSettingImageSrc(settings.about_image);
        }
        const aboutDesc = document.querySelector('[data-setting="about_description"]');
        if (aboutDesc && settings.about_description) {
            aboutDesc.textContent = settings.about_description;
        }

        // ── Kontak: foto, telepon, alamat, jam buka ──
        const contactImg = document.querySelector('[data-setting="contact_image"]');
        if (contactImg && settings.contact_image) {
            contactImg.src = resolveSettingImageSrc(settings.contact_image);
        }
        const contactPhone = document.querySelector('[data-setting="contact_phone"]');
        if (contactPhone && settings.contact_phone) {
            contactPhone.textContent = settings.contact_phone;
            contactPhone.href = 'tel:+62' + settings.contact_phone.replace(/[^0-9]/g, '').replace(/^0/, '');
        }
        const contactAddress = document.querySelector('[data-setting="contact_address"]');
        if (contactAddress && settings.contact_address) {
            contactAddress.textContent = settings.contact_address;
        }
        const contactHours = document.querySelector('[data-setting="contact_hours"]');
        if (contactHours && settings.contact_hours) {
            contactHours.textContent = settings.contact_hours;
        }

        // ── Tim: foto anggota (5 slot) ──
        for (let i = 1; i <= 5; i++) {
            const key = `team_photo_${i}`;
            const el = document.querySelector(`[data-setting="${key}"]`);
            if (el && settings[key]) {
                el.src = resolveSettingImageSrc(settings[key]);
            }
        }
    } catch (error) {
        console.warn('Gagal memuat pengaturan situs, memakai konten bawaan:', error);
    }
}

window.addEventListener('DOMContentLoaded', applySiteSettings);
