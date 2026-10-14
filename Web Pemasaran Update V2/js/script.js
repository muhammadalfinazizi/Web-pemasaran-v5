/**
 * script.js — MUSICA JAYA ELEKTRONIK
 * Utilitas umum untuk seluruh halaman: efek header saat scroll,
 * update tahun footer, dan penandaan menu aktif otomatis.
 */

document.addEventListener('DOMContentLoaded', () => {
    // Beri bayangan pada header saat halaman di-scroll ke bawah
    const header = document.querySelector('.header');
    if (header) {
        const toggleHeaderShadow = () => {
            header.classList.toggle('is-scrolled', window.scrollY > 8);
        };
        toggleHeaderShadow();
        window.addEventListener('scroll', toggleHeaderShadow, { passive: true });
    }

    // Update tahun di footer secara otomatis (©)
    document.querySelectorAll('.footer').forEach((footer) => {
        const currentYear = new Date().getFullYear();
        footer.innerHTML = footer.innerHTML.replace(/20\d{2}/, currentYear);
    });

    // Tandai menu navigasi yang aktif berdasarkan URL saat ini,
    // sebagai cadangan jika atribut aria-current belum diset manual.
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav a').forEach((link) => {
        const linkPage = link.getAttribute('href');
        if (linkPage === currentPage && !link.hasAttribute('aria-current')) {
            link.setAttribute('aria-current', 'page');
        }
    });
});
