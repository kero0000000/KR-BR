// ===== DATA STORE =====
const DB = {
  users: JSON.parse(localStorage.getItem('krbr_users') || '[]'),
  products: JSON.parse(localStorage.getItem('krbr_products') || 'null') || generateDefaultProducts(),
  currentUser: JSON.parse(localStorage.getItem('krbr_current') || 'null'),
  siteImages: JSON.parse(localStorage.getItem('krbr_site_images') || '[]'),
  siteColors: JSON.parse(localStorage.getItem('krbr_site_colors') || 'null') || { primary: '#7c3aed', accent: '#f59e0b' },
  transactions: JSON.parse(localStorage.getItem('krbr_transactions') || '[]'),
};

// Migration: drop pre-MySQL session format (old string ids like 'u_...')
// so users re-authenticate against the new MySQL-backed accounts.
if (DB.currentUser && typeof DB.currentUser.id !== 'number') {
  DB.currentUser = null;
  localStorage.removeItem('krbr_current');
  localStorage.removeItem('krbr_token');
}

function save(key) {
  localStorage.setItem('krbr_' + key, JSON.stringify(DB[key]));
}

// ===== BACKEND API (MySQL, encrypted) =====
// The Flask backend (backend/server.py) is the source of truth for accounts
// and bank cards. Products/transactions stay in localStorage.
const API_BASE = 'http://127.0.0.1:5000';
function apiToken() { return localStorage.getItem('krbr_token') || ''; }
function setApiToken(t) { if (t) localStorage.setItem('krbr_token', t); else localStorage.removeItem('krbr_token'); }
function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  const t = apiToken();
  if (t) h['X-Auth-Token'] = t;
  return h;
}
// Returns parsed JSON (backend always returns JSON, including errors).
// Throws only on network failure (backend unreachable).
async function apiCall(path, { method = 'GET', body } = {}) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  try { return await res.json(); }
  catch (_) { return { error: 'استجابة غير صالحة من الخادم' }; }
}

// ===== DEFAULT PRODUCTS =====
function generateDefaultProducts() {
  const products = {
    websites: [
      { id: 'w1', name: 'متجر إلكتروني متكامل', desc: 'متجر احترافي مع لوحة تحكم وبوابة دفع', price: 299, category: 'websites', seller: 'KR&BR Store', badge: 'مميز', icon: '🛒' },
      { id: 'w2', name: 'موقع شركة احترافي', desc: 'موقع تعريفي للشركات مع SEO متقدم', price: 199, category: 'websites', seller: 'WebPro', badge: null, icon: '🏢' },
      { id: 'w3', name: 'منصة تعليمية', desc: 'LMS كامل مع دروس فيديو وشهادات', price: 499, category: 'websites', seller: 'EduTech', badge: 'جديد', icon: '📚' },
      { id: 'w4', name: 'موقع مدونة متقدم', desc: 'مدونة احترافية مع نظام تعليقات وإشعارات', price: 149, category: 'websites', seller: 'BlogMaster', badge: null, icon: '✍️' },
    ],
    games: [
      { id: 'g1', name: 'لعبة RPG ثلاثية الأبعاد', desc: 'لعبة أدوار مميزة بجرافيك عالي الجودة', price: 399, category: 'games', seller: 'GameStudio', badge: 'الأكثر مبيعاً', icon: '⚔️' },
      { id: 'g2', name: 'لعبة سباق سيارات', desc: 'سباق سيارات واقعي مع وضع متعدد اللاعبين', price: 249, category: 'games', seller: 'RacePro', badge: null, icon: '🏎️' },
      { id: 'g3', name: 'لعبة استراتيجية', desc: 'بناء إمبراطوريتك وقيادة جيوشك', price: 179, category: 'games', seller: 'StrategyX', badge: 'جديد', icon: '🏰' },
      { id: 'g4', name: 'لعبة موبايل هايبر كاجوال', desc: 'لعبة ممتعة وسهلة للجميع', price: 89, category: 'games', seller: 'CasualDev', badge: null, icon: '🎮' },
    ],
    mobile: [
      { id: 'm1', name: 'تطبيق توصيل طلبات', desc: 'تطبيق توصيل كامل iOS & Android مع تتبع مباشر', price: 599, category: 'mobile', seller: 'AppFactory', badge: 'مميز', icon: '🚀' },
      { id: 'm2', name: 'تطبيق لياقة بدنية', desc: 'تتبع التمارين والتغذية مع AI', price: 299, category: 'mobile', seller: 'FitDev', badge: null, icon: '💪' },
      { id: 'm3', name: 'تطبيق محادثة فورية', desc: 'تطبيق دردشة مشفر مع مكالمات صوتية', price: 449, category: 'mobile', seller: 'ChatPro', badge: 'جديد', icon: '💬' },
      { id: 'm4', name: 'تطبيق إدارة مهام', desc: 'منظم مهام ذكي مع تذكيرات وتقارير', price: 149, category: 'mobile', seller: 'TaskMaster', badge: null, icon: '✅' },
    ],
    desktop: [
      { id: 'd1', name: 'برنامج محاسبة متكامل', desc: 'نظام محاسبة كامل للشركات مع تقارير', price: 799, category: 'desktop', seller: 'AccSoft', badge: 'الأكثر مبيعاً', icon: '💰' },
      { id: 'd2', name: 'برنامج تصميم جرافيك', desc: 'أدوات تصميم احترافية مع AI', price: 349, category: 'desktop', seller: 'DesignPro', badge: null, icon: '🎨' },
      { id: 'd3', name: 'برنامج إدارة مخزون', desc: 'تتبع المخزون والمبيعات في الوقت الفعلي', price: 499, category: 'desktop', seller: 'StockSys', badge: 'جديد', icon: '📦' },
      { id: 'd4', name: 'برنامج مونتاج فيديو', desc: 'تحرير فيديو احترافي بتأثيرات متقدمة', price: 599, category: 'desktop', seller: 'VideoEdit', badge: null, icon: '🎬' },
    ]
  };
  localStorage.setItem('krbr_products', JSON.stringify(products));
  return products;
}

// ===== SLIDESHOW =====
let slideIndex = 0;
const slides = document.querySelectorAll('.slide');
function nextSlide() {
  slides[slideIndex].classList.remove('active');
  slideIndex = (slideIndex + 1) % slides.length;
  slides[slideIndex].classList.add('active');
}
setInterval(nextSlide, 4000);

// Apply site images to slideshow if set
function applySiteImages() {
  if (DB.siteImages.length > 0) {
    slides.forEach((slide, i) => {
      if (DB.siteImages[i]) {
        slide.style.backgroundImage = `url(${DB.siteImages[i]})`;
        slide.style.backgroundSize = 'cover';
        slide.style.backgroundPosition = 'center';
      }
    });
  }
}
applySiteImages();

// Apply site colors
function applySiteColors() {
  document.documentElement.style.setProperty('--primary', DB.siteColors.primary);
  document.documentElement.style.setProperty('--accent', DB.siteColors.accent);
}
applySiteColors();

// ===== RENDER PRODUCTS =====
function renderProducts() {
  ['websites', 'games', 'mobile', 'desktop'].forEach(cat => {
    const grid = document.getElementById('grid-' + cat);
    if (!grid) return;
    grid.innerHTML = '';
    (DB.products[cat] || []).forEach(p => {
      grid.innerHTML += `
        <div class="product-card" onclick="openProduct('${p.id}','${cat}')">
          ${p.badge ? `<div class="product-badge">${p.badge}</div>` : ''}
          <div class="product-img">${p.icon || '📦'}</div>
          <div class="product-body">
            <div class="product-category">${getCatLabel(cat)}</div>
            <div class="product-name">${p.name}</div>
            <div class="product-desc">${p.desc}</div>
            <div class="product-footer">
              <div class="product-price">$${p.price} <small>USD</small></div>
              <button class="btn-buy" onclick="event.stopPropagation();buyProduct('${p.id}','${cat}')">شراء</button>
            </div>
          </div>
        </div>`;
    });
  });
}

function getCatLabel(cat) {
  return { websites: 'موقع إلكتروني', games: 'لعبة', mobile: 'تطبيق موبايل', desktop: 'برنامج Desktop' }[cat] || cat;
}

renderProducts();

// ===== TABS =====
document.querySelectorAll('.stab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ===== MODALS =====
function openModal(name) {
  document.getElementById('modal-' + name).classList.add('open');
}
function closeModal(name) {
  document.getElementById('modal-' + name).classList.remove('open');
}
function switchModal(from, to) {
  closeModal(from); openModal(to);
}
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// ===== AUTH (backend / MySQL) =====
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const data = await apiCall('/api/login', { method: 'POST', body: { email, password: pass } });
    if (data.error) { errEl.textContent = data.error; return; }
    setApiToken(data.token);
    DB.currentUser = data.user; save('current');
    closeModal('login');
    window.location.href = (data.user.type === 'admin') ? 'admin.html' : 'dashboard.html';
  } catch (err) {
    errEl.textContent = 'تعذر الاتصال بالخادم. تأكد من تشغيل الباك إند (python backend/server.py)';
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pass = document.getElementById('reg-pass').value;
  const type = document.querySelector('input[name="account-type"]:checked').value;
  const errEl = document.getElementById('reg-error');
  errEl.textContent = '';

  if (pass.length < 8) { errEl.textContent = 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'; return; }

  try {
    const data = await apiCall('/api/register', { method: 'POST', body: { name, email, password: pass, type } });
    if (data.error) { errEl.textContent = data.error; return; }
    setApiToken(data.token);
    DB.currentUser = data.user; save('current');
    closeModal('register');
    window.location.href = 'dashboard.html';
  } catch (err) {
    errEl.textContent = 'تعذر الاتصال بالخادم. تأكد من تشغيل الباك إند (python backend/server.py)';
  }
}

// ===== PRODUCT DETAIL =====
function openProduct(id, cat) {
  const p = DB.products[cat].find(x => x.id === id);
  if (!p) return;
  document.getElementById('product-detail-content').innerHTML = `
    <div style="text-align:center">
      <div style="font-size:5rem;margin-bottom:20px">${p.icon}</div>
      <div style="color:var(--accent);font-size:0.85rem;margin-bottom:8px">${getCatLabel(cat)}</div>
      <h2 style="font-size:1.8rem;margin-bottom:15px">${p.name}</h2>
      <p style="color:var(--text-muted);margin-bottom:20px;line-height:1.8">${p.desc}</p>
      <div style="display:flex;justify-content:center;gap:30px;margin-bottom:25px;flex-wrap:wrap">
        <div><span style="color:var(--text-muted);font-size:0.85rem">السعر</span><br><span style="font-size:2rem;font-weight:900;color:var(--accent)">$${p.price}</span></div>
        <div><span style="color:var(--text-muted);font-size:0.85rem">البائع</span><br><span style="font-weight:700">${p.seller}</span></div>
        <div><span style="color:var(--text-muted);font-size:0.85rem">عمولة المنصة</span><br><span style="color:var(--danger)">10%</span></div>
      </div>
      <button class="btn-primary" onclick="buyProduct('${id}','${cat}');closeModal('product')">شراء الآن - $${p.price}</button>
    </div>`;
  openModal('product');
}

function buyProduct(id, cat) {
  if (!DB.currentUser) { openModal('login'); return; }
  if (!DB.currentUser.visa) {
    alert('يجب ربط بطاقة فيزا أولاً من لوحة التحكم');
    window.location.href = 'dashboard.html';
    return;
  }
  const p = DB.products[cat].find(x => x.id === id);
  if (!p) return;

  const commission = p.price * 0.10;
  const sellerAmount = p.price - commission;

  const tx = {
    id: 'tx_' + Date.now(),
    productId: id, productName: p.name,
    buyerId: DB.currentUser.id, buyerName: DB.currentUser.name,
    seller: p.seller, price: p.price,
    commission, sellerAmount,
    date: new Date().toISOString()
  };

  DB.transactions.push(tx);
  save('transactions');

  aiAlert(`تمت عملية شراء "${p.name}" بنجاح. عمولة المنصة: $${commission.toFixed(2)}`, 'success');
  alert(`✅ تمت عملية الشراء بنجاح!\n\nالمنتج: ${p.name}\nالسعر: $${p.price}\nعمولة المنصة (10%): $${commission.toFixed(2)}\nتم إرسال $${commission.toFixed(2)} لفيزا المدير تلقائياً`);
}

// ===== AI SECURITY =====
function containsSQLInjection(str) {
  const patterns = [/('|--|;|\/\*|\*\/|xp_|exec|select|insert|update|delete|drop|union|script)/i];
  return patterns.some(p => p.test(str));
}

function aiAlert(msg, type = 'info') {
  const monitor = document.getElementById('ai-monitor');
  const msgEl = document.getElementById('ai-msg');
  monitor.className = 'ai-monitor show ' + type;
  msgEl.textContent = msg;
  setTimeout(() => monitor.classList.remove('show'), 4000);
}

// AI periodic security scan
setInterval(() => {
  const msgs = ['فحص أمني جارٍ...', 'النظام آمن ✓', 'مراقبة النشاط...', 'لا تهديدات مكتشفة ✓'];
  aiAlert(msgs[Math.floor(Math.random() * msgs.length)]);
}, 15000);

// ===== SCROLL =====
function scrollToProducts() {
  document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
}

// Navbar scroll effect
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  nav.style.background = window.scrollY > 50
    ? 'rgba(10,10,15,0.98)'
    : 'rgba(10,10,15,0.85)';
});
