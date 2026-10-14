/* ============================================
   CUSTOM CURSOR - Implementasi kursor custom
   ============================================ */
const cursor = document.getElementById('cursor');
const ring = document.getElementById('cursorRing');
let mx = 0, my = 0, rx = 0, ry = 0;

document.addEventListener('mousemove', e => {
  mx = e.clientX;
  my = e.clientY;
  cursor.style.left = mx - 5 + 'px';
  cursor.style.top = my - 5 + 'px';
});

function animateRing() {
  rx += (mx - rx) * 0.1;
  ry += (my - ry) * 0.1;
  ring.style.left = rx - 17 + 'px';
  ring.style.top = ry - 17 + 'px';
  requestAnimationFrame(animateRing);
}
animateRing();

document.querySelectorAll('a, button, .skill-card, .port-card').forEach(el => {
  el.addEventListener('mouseenter', () => {
    cursor.style.transform = 'scale(2.5)';
    ring.style.transform = 'scale(1.6)';
    ring.style.opacity = '0.3';
  });
  el.addEventListener('mouseleave', () => {
    cursor.style.transform = 'scale(1)';
    ring.style.transform = 'scale(1)';
    ring.style.opacity = '1';
  });
});

/* ============================================
   SPIDER WEB / NETWORK BACKGROUND
   Jaring laba-laba bertema jaringan komputer:
   - Node bergerak pelan seperti titik jaringan
   - Garis koneksi antar node (benang jaring)
   - Node bereaksi terhadap posisi mouse
   - Paket data animasi bergerak di sepanjang koneksi
   ============================================ */
const canvas = document.getElementById('signalCanvas');
if (canvas) {
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const MOUSE = { x: -9999, y: -9999 };
  document.addEventListener('mousemove', e => {
    MOUSE.x = e.clientX;
    MOUSE.y = e.clientY;
  });

  // --- NODES ---
  const NODE_COUNT = 55;
  const MAX_DIST = 180;       // jarak maksimal agar terhubung (benang jaring)
  const MOUSE_REPEL = 120;    // radius tolak dari kursor mouse

  const nodes = Array.from({ length: NODE_COUNT }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: Math.random() * 2 + 1.5,
    pulse: Math.random() * Math.PI * 2,
    pulseSpeed: Math.random() * 0.015 + 0.008,
    // tipe node: 'router', 'switch', 'host' - untuk ukuran berbeda
    type: Math.random() < 0.1 ? 'router' : Math.random() < 0.25 ? 'switch' : 'host'
  }));

  // Ukuran node berdasarkan tipe
  const nodeSize = { router: 4, switch: 2.5, host: 1.5 };

  // --- DATA PACKETS ---
  // Paket data kecil yang bergerak di sepanjang koneksi antar node
  const packets = [];
  function spawnPacket(a, b) {
    packets.push({ from: a, to: b, t: 0, speed: Math.random() * 0.008 + 0.004 });
  }

  // Spawn paket awal secara acak
  for (let i = 0; i < 12; i++) {
    const a = Math.floor(Math.random() * NODE_COUNT);
    const b = Math.floor(Math.random() * NODE_COUNT);
    spawnPacket(a, b);
  }

  function drawWeb() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Update posisi node + efek tolak dari mouse
    nodes.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;
      n.pulse += n.pulseSpeed;

      // Bounce di tepi
      if (n.x < 0 || n.x > canvas.width)  n.vx *= -1;
      if (n.y < 0 || n.y > canvas.height) n.vy *= -1;

      // Tolak dari kursor mouse
      const dxM = n.x - MOUSE.x;
      const dyM = n.y - MOUSE.y;
      const distM = Math.sqrt(dxM * dxM + dyM * dyM);
      if (distM < MOUSE_REPEL) {
        const force = (MOUSE_REPEL - distM) / MOUSE_REPEL * 0.8;
        n.x += (dxM / distM) * force;
        n.y += (dyM / distM) * force;
      }
    });

    // Kumpulkan koneksi aktif (node yang cukup dekat)
    const connections = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MAX_DIST) {
          connections.push({ a: i, b: j, dist });
        }
      }
    }

    // Gambar garis benang jaring
    connections.forEach(({ a, b, dist }) => {
      const alpha = (1 - dist / MAX_DIST) * 0.35;
      const na = nodes[a], nb = nodes[b];

      // Garis utama
      ctx.beginPath();
      ctx.moveTo(na.x, na.y);
      ctx.lineTo(nb.x, nb.y);
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
      ctx.lineWidth = 0.5;
      ctx.stroke();

      // Garis highlight tipis di tengah (efek kabel serat optik)
      if (alpha > 0.18) {
        ctx.beginPath();
        ctx.moveTo(na.x, na.y);
        ctx.lineTo(nb.x, nb.y);
        ctx.strokeStyle = `rgba(186, 230, 253, ${alpha * 0.4})`;
        ctx.lineWidth = 0.2;
        ctx.stroke();
      }
    });

    // Gambar paket data bergerak di koneksi
    for (let p = packets.length - 1; p >= 0; p--) {
      const pkt = packets[p];
      pkt.t += pkt.speed;
      if (pkt.t >= 1) {
        // Sampai tujuan: respawn ke koneksi acak
        const conn = connections[Math.floor(Math.random() * connections.length)];
        if (conn) {
          pkt.from = conn.a;
          pkt.to = conn.b;
          pkt.t = 0;
          pkt.speed = Math.random() * 0.008 + 0.004;
        } else {
          packets.splice(p, 1);
        }
        continue;
      }
      const nf = nodes[pkt.from], nt = nodes[pkt.to];
      const px = nf.x + (nt.x - nf.x) * pkt.t;
      const py = nf.y + (nt.y - nf.y) * pkt.t;

      // Ekor paket
      const tailLen = 0.08;
      const t0 = Math.max(0, pkt.t - tailLen);
      const tx = nf.x + (nt.x - nf.x) * t0;
      const ty = nf.y + (nt.y - nf.y) * t0;
      const grad = ctx.createLinearGradient(tx, ty, px, py);
      grad.addColorStop(0, 'rgba(56,189,248,0)');
      grad.addColorStop(1, 'rgba(186,230,253,0.9)');
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Kepala paket (titik terang)
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(224, 242, 254, 0.95)';
      ctx.fill();
    }

    // Pastikan selalu ada minimal 8 paket di layar
    if (packets.length < 8 && connections.length > 0) {
      const conn = connections[Math.floor(Math.random() * connections.length)];
      if (conn) spawnPacket(conn.a, conn.b);
    }

    // Gambar nodes (titik jaringan)
    nodes.forEach(n => {
      const pulse = (Math.sin(n.pulse) + 1) / 2;
      const baseR = nodeSize[n.type] ?? 1.5;
      const glowR = baseR + pulse * 3;

      // Glow aura
      const grd = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR * 5);
      grd.addColorStop(0, `rgba(56, 189, 248, ${0.25 + pulse * 0.25})`);
      grd.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.beginPath();
      ctx.arc(n.x, n.y, glowR * 5, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      // Node utama
      ctx.beginPath();
      ctx.arc(n.x, n.y, baseR + pulse * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.65 + pulse * 0.35})`;
      ctx.fill();

      // Highlight putih di node router/switch
      if (n.type !== 'host') {
        ctx.beginPath();
        ctx.arc(n.x - baseR * 0.3, n.y - baseR * 0.3, baseR * 0.35, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(224, 242, 254, 0.6)';
        ctx.fill();
      }
    });

    requestAnimationFrame(drawWeb);
  }

  drawWeb();
}

/* ============================================
   SCROLL REVEAL
   ============================================ */
const revealElements = document.querySelectorAll('.reveal');
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -80px 0px' });
revealElements.forEach(el => observer.observe(el));

/* ============================================
   SKILL BARS
   ============================================ */
const skillBars = document.querySelectorAll('.skill-bar-fill');
const barObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.width = entry.target.getAttribute('data-width');
      barObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.5 });
skillBars.forEach(bar => barObserver.observe(bar));

/* ============================================
   PORTFOLIO FILTERING
   ============================================ */
const tabBtns = document.querySelectorAll('.tab-btn');
const portCards = document.querySelectorAll('.port-card');
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const category = btn.getAttribute('data-cat');
    portCards.forEach(card => {
      if (category === 'all' || card.classList.contains(category)) {
        card.classList.add('visible');
      } else {
        card.classList.remove('visible');
      }
    });
  });
});

/* ============================================
   ACTIVE NAV LINK
   ============================================ */
const navLinks = document.querySelectorAll('.nav-links a');
const currentPage = window.location.pathname.split('/').pop() || 'index.html';
navLinks.forEach(link => {
  link.classList.remove('active');
  if (link.getAttribute('href') === currentPage ||
      (link.getAttribute('href') === 'index.html' && currentPage === '')) {
    link.classList.add('active');
  }
});

/* ============================================
   PAGE LOAD INIT
   ============================================ */
window.addEventListener('load', () => {
  revealElements.forEach(el => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) el.classList.add('visible');
  });
  skillBars.forEach(bar => {
    const rect = bar.getBoundingClientRect();
    if (rect.top < window.innerHeight) {
      bar.style.width = bar.getAttribute('data-width');
    }
  });
});

console.log('Spider-web network background aktif! Jaringan siap.');
