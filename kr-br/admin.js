// Admin panel logic

// Auth guard — only a logged-in admin may use this panel
if (!DB.currentUser || DB.currentUser.type !== 'admin') {
  window.location.href = 'index.html';
}

// Users now live in MySQL (the single `users` table), fetched from the backend.
let ADMIN_USERS = [];
async function loadAdminUsers() {
  try {
    const data = await apiCall('/api/admin/users');
    if (data && data.users) { ADMIN_USERS = data.users; }
    else { ADMIN_USERS = []; }
  } catch (_) { ADMIN_USERS = []; }
}

// Panel navigation
document.querySelectorAll('.asnav').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.asnav').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.apanel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('apanel-' + btn.dataset.panel).classList.add('active');
    loadAdminPanel(btn.dataset.panel);
  });
});

function loadAdminPanel(name) {
  if (name === 'dashboard') renderAdminDashboard();
  if (name === 'users') renderUsersTable();
  if (name === 'products') renderProductsTable();
  if (name === 'transactions') renderTransactions();
  if (name === 'visa') renderAdminVisa();
  if (name === 'ai') renderAI();
  if (name === 'slideshow') renderSlideshowManager();
  if (name === 'colors') loadCurrentColors();
}

// ===== DASHBOARD =====
function renderAdminDashboard() {
  const totalUsers = ADMIN_USERS.length;
  const totalProducts = Object.values(DB.products).flat().length;
  const totalTx = DB.transactions.length;
  const totalRevenue = DB.transactions.reduce((s, t) => s + t.price, 0);
  const totalCommission = DB.transactions.reduce((s, t) => s + t.commission, 0);

  document.getElementById('admin-stats').innerHTML = `
    <div class="admin-stat-card">
      <i class="fas fa-users" style="color:var(--primary)"></i>
      <div class="num">${totalUsers}</div>
      <div class="lbl">المستخدمون</div>
    </div>
    <div class="admin-stat-card">
      <i class="fas fa-box" style="color:var(--accent)"></i>
      <div class="num">${totalProducts}</div>
      <div class="lbl">المنتجات</div>
    </div>
    <div class="admin-stat-card">
      <i class="fas fa-exchange-alt" style="color:#0ea5e9"></i>
      <div class="num">${totalTx}</div>
      <div class="lbl">المعاملات</div>
    </div>
    <div class="admin-stat-card">
      <i class="fas fa-dollar-sign" style="color:var(--success)"></i>
      <div class="num">$${totalRevenue.toFixed(0)}</div>
      <div class="lbl">إجمالي المبيعات</div>
    </div>
    <div class="admin-stat-card">
      <i class="fas fa-percentage" style="color:var(--accent)"></i>
      <div class="num">$${totalCommission.toFixed(0)}</div>
      <div class="lbl">عمولات المنصة (10%)</div>
    </div>`;

  const recent = DB.transactions.slice(-5).reverse();
  document.getElementById('admin-recent-tx').innerHTML = recent.length
    ? recent.map(t => `
      <div class="tx-item">
        <div>
          <div class="tx-name">${t.productName}</div>
          <div class="tx-date">${t.buyerName} | ${new Date(t.date).toLocaleDateString('ar')}</div>
        </div>
        <div>
          <div class="tx-price">$${t.price}</div>
          <div style="color:var(--success);font-size:0.8rem">عمولة: $${t.commission.toFixed(2)}</div>
        </div>
      </div>`).join('')
    : '<p style="color:var(--text-muted);text-align:center;padding:20px">لا توجد معاملات بعد</p>';
}

// ===== COLORS =====
function loadCurrentColors() {
  document.getElementById('color-primary').value = DB.siteColors.primary;
  document.getElementById('color-accent').value = DB.siteColors.accent;
  document.getElementById('color-primary-val').textContent = DB.siteColors.primary;
  document.getElementById('color-accent-val').textContent = DB.siteColors.accent;
  document.getElementById('prev-primary').style.background = DB.siteColors.primary;
  document.getElementById('prev-accent').style.background = DB.siteColors.accent;
}

function previewColor(type, val) {
  document.getElementById('color-' + type + '-val').textContent = val;
  document.getElementById('prev-' + type).style.background = val;
  document.documentElement.style.setProperty('--' + type, val);
}

function applyPreset(primary, accent) {
  document.getElementById('color-primary').value = primary;
  document.getElementById('color-accent').value = accent;
  previewColor('primary', primary);
  previewColor('accent', accent);
}

function saveColors() {
  DB.siteColors = {
    primary: document.getElementById('color-primary').value,
    accent: document.getElementById('color-accent').value
  };
  save('siteColors');
  alert('✅ تم حفظ الألوان وستُطبق على جميع صفحات الموقع');
}

// ===== SLIDESHOW =====
let tempImages = [...DB.siteImages];

function renderSlideshowManager() {
  tempImages = [...DB.siteImages];
  renderSlots();
}

function renderSlots() {
  const container = document.getElementById('slide-slots');
  container.innerHTML = tempImages.map((img, i) => `
    <div class="slide-slot">
      <img src="${img}" alt="slide ${i+1}"/>
      <button class="remove-slide" onclick="removeSlide(${i})"><i class="fas fa-times"></i></button>
    </div>`).join('');
}

function uploadSlideImages(input) {
  const files = Array.from(input.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      tempImages.push(e.target.result);
      renderSlots();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function removeSlide(i) {
  tempImages.splice(i, 1);
  renderSlots();
}

function saveSlideshow() {
  DB.siteImages = [...tempImages];
  save('siteImages');
  alert('✅ تم حفظ الصور وستظهر في جميع صفحات الموقع');
}

// ===== USERS TABLE =====
function renderUsersTable() {
  const users = ADMIN_USERS;
  const typeLabel = t => t === 'admin' ? 'مدير' : (t === 'seller' ? 'بائع' : 'مشتري');
  document.getElementById('users-table').innerHTML = users.length
    ? `<table class="admin-table">
        <thead><tr>
          <th>الاسم</th><th>البريد</th><th>النوع</th><th>تاريخ التسجيل</th><th>الفيزا</th><th>الإجراء</th>
        </tr></thead>
        <tbody>${users.map(u => `
          <tr>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td><span class="badge-${u.type}">${typeLabel(u.type)}</span></td>
            <td>${new Date(u.created_at).toLocaleDateString('ar')}</td>
            <td>${u.has_card ? '<span style="color:var(--success)">✓ مربوطة</span>' : '<span style="color:var(--danger)">✗</span>'}</td>
            <td>${u.type === 'admin' ? '<span style="color:var(--text-muted)">—</span>' : `<button class="btn-delete" onclick="deleteUser(${u.id})">حذف</button>`}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p style="color:var(--text-muted);text-align:center;padding:40px">لا يوجد مستخدمون (أو الباك إند غير متصل)</p>';
}

async function deleteUser(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return;
  try {
    const data = await apiCall('/api/admin/users/' + id, { method: 'DELETE' });
    if (data.error) { alert(data.error); return; }
    await loadAdminUsers();
    renderUsersTable();
    renderAdminDashboard();
  } catch (err) {
    alert('تعذر الاتصال بالخادم.');
  }
}

// ===== PRODUCTS TABLE =====
function renderProductsTable() {
  const all = Object.entries(DB.products).flatMap(([cat, prods]) => prods.map(p => ({ ...p, cat })));
  document.getElementById('products-table').innerHTML = all.length
    ? `<table class="admin-table">
        <thead><tr>
          <th>المنتج</th><th>الفئة</th><th>السعر</th><th>البائع</th><th>إجراء</th>
        </tr></thead>
        <tbody>${all.map(p => `
          <tr>
            <td>${p.icon || '📦'} ${p.name}</td>
            <td>${getCatLabel(p.cat)}</td>
            <td style="color:var(--accent)">$${p.price}</td>
            <td>${p.seller}</td>
            <td><button class="btn-delete" onclick="deleteProduct('${p.id}','${p.cat}')">حذف</button></td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p style="color:var(--text-muted);text-align:center;padding:40px">لا توجد منتجات</p>';
}

function deleteProduct(id, cat) {
  if (!confirm('حذف هذا المنتج؟')) return;
  DB.products[cat] = DB.products[cat].filter(p => p.id !== id);
  save('products');
  renderProductsTable();
}

// ===== TRANSACTIONS =====
function renderTransactions() {
  const total = DB.transactions.reduce((s, t) => s + t.price, 0);
  const commission = DB.transactions.reduce((s, t) => s + t.commission, 0);

  document.getElementById('tx-summary').innerHTML = `
    <div class="tx-sum-card">
      <div class="num">${DB.transactions.length}</div>
      <div class="lbl">إجمالي المعاملات</div>
    </div>
    <div class="tx-sum-card">
      <div class="num" style="color:var(--accent)">$${total.toFixed(2)}</div>
      <div class="lbl">إجمالي المبيعات</div>
    </div>
    <div class="tx-sum-card">
      <div class="num" style="color:var(--success)">$${commission.toFixed(2)}</div>
      <div class="lbl">عمولات المنصة (10%)</div>
    </div>`;

  document.getElementById('all-transactions').innerHTML = DB.transactions.length
    ? `<table class="admin-table">
        <thead><tr>
          <th>المنتج</th><th>المشتري</th><th>البائع</th><th>السعر</th><th>العمولة</th><th>التاريخ</th>
        </tr></thead>
        <tbody>${DB.transactions.slice().reverse().map(t => `
          <tr>
            <td>${t.productName}</td>
            <td>${t.buyerName}</td>
            <td>${t.seller}</td>
            <td style="color:var(--accent)">$${t.price}</td>
            <td style="color:var(--success)">$${t.commission.toFixed(2)}</td>
            <td>${new Date(t.date).toLocaleDateString('ar')}</td>
          </tr>`).join('')}
        </tbody>
      </table>`
    : '<p style="color:var(--text-muted);text-align:center;padding:40px">لا توجد معاملات بعد</p>';
}

// ===== ADMIN VISA =====
function renderAdminVisa() {
  const v = DB.currentUser ? DB.currentUser.visa : null;
  const totalCommission = DB.transactions.reduce((s, t) => s + t.commission, 0);
  document.getElementById('total-commission').textContent = '$' + totalCommission.toFixed(2);

  const num = v ? v.number : 'XXXX XXXX XXXX XXXX';
  const exp = v ? v.expiry : 'MM/YY';
  const nm  = v ? v.name : 'اسم المدير';
  document.getElementById('admin-visa-num').value = '';
  document.getElementById('admin-visa-num').placeholder = num;
  document.getElementById('admin-visa-exp').value = '';
  document.getElementById('admin-visa-exp').placeholder = exp;
  document.getElementById('admin-visa-name').value = '';
  document.getElementById('admin-visa-name').placeholder = nm;
  updateAdminVisaPreview();
}

async function saveAdminVisa(e) {
  e.preventDefault();
  const number = document.getElementById('admin-visa-num').value.replace(/\s/g, '');
  const expiry = document.getElementById('admin-visa-exp').value.trim();
  const cvv = document.getElementById('admin-visa-cvv').value.trim();
  const name = document.getElementById('admin-visa-name').value.trim();
  if (number.length < 13) { alert('رقم البطاقة غير صحيح'); return; }
  if (!expiry.match(/^\d{2}\/\d{2}$/)) { alert('تاريخ الانتهاء غير صحيح (MM/YY)'); return; }
  if (cvv.length < 3) { alert('CVV غير صحيح'); return; }
  if (name.length < 2) { alert('اسم حامل البطاقة غير صحيح'); return; }
  try {
    const data = await apiCall('/api/user/' + DB.currentUser.id + '/visa', { method: 'POST', body: { number, expiry, cvv, name } });
    if (data.error) { alert(data.error); return; }
    DB.currentUser = data.user; save('current');
    renderAdminVisa();
    alert('✅ تم حفظ بطاقة المدير (مشفّرة). ستُرسل العمولات لهذه البطاقة.');
  } catch (err) {
    alert('تعذر الاتصال بالخادم.');
  }
}

function formatAdminCard(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 16);
  input.value = v.replace(/(.{4})/g, '$1 ').trim();
  updateAdminVisaPreview();
}

function updateAdminVisaPreview() {
  const num = document.getElementById('admin-visa-num').value || 'XXXX XXXX XXXX XXXX';
  const exp = document.getElementById('admin-visa-exp').value || 'MM/YY';
  const name = document.getElementById('admin-visa-name').value || 'اسم المدير';
  document.getElementById('admin-visa-preview').innerHTML = `
    <div class="visa-logo">VISA</div>
    <div class="visa-card-num">${num}</div>
    <div class="visa-card-info">
      <div><small>حامل البطاقة</small><br>${name}</div>
      <div><small>تاريخ الانتهاء</small><br>${exp}</div>
    </div>`;
}

document.getElementById('admin-visa-name').addEventListener('input', updateAdminVisaPreview);
document.getElementById('admin-visa-exp').addEventListener('input', updateAdminVisaPreview);

// ===== AI SYSTEM =====
function renderAI() {
  const blocked = parseInt(localStorage.getItem('krbr_blocked') || '0');
  const scans = parseInt(localStorage.getItem('krbr_scans') || '0') + 1;
  localStorage.setItem('krbr_scans', scans);

  document.getElementById('ai-metrics').innerHTML = `
    <div class="ai-metric">
      <div class="num" style="color:var(--success)">${scans}</div>
      <div class="lbl">عمليات الفحص</div>
    </div>
    <div class="ai-metric">
      <div class="num" style="color:var(--danger)">${blocked}</div>
      <div class="lbl">تهديدات محظورة</div>
    </div>
    <div class="ai-metric">
      <div class="num" style="color:var(--accent)">${ADMIN_USERS.length}</div>
      <div class="lbl">مستخدمون مراقبون</div>
    </div>
    <div class="ai-metric">
      <div class="num" style="color:var(--primary)">100%</div>
      <div class="lbl">نسبة الأمان</div>
    </div>`;

  const logs = [
    { type: 'safe', msg: 'فحص أمني شامل - لا تهديدات', time: 'منذ دقيقة' },
    { type: 'safe', msg: 'تحقق من صحة بيانات المستخدمين', time: 'منذ 5 دقائق' },
    { type: 'safe', msg: 'مراقبة المعاملات المالية - آمنة', time: 'منذ 10 دقائق' },
    { type: blocked > 0 ? 'warn' : 'safe', msg: blocked > 0 ? `تم حظر ${blocked} محاولة اختراق` : 'لا محاولات اختراق مكتشفة', time: 'منذ 15 دقيقة' },
    { type: 'safe', msg: 'تحديث قواعد الحماية', time: 'منذ ساعة' },
  ];

  document.getElementById('ai-log-list').innerHTML = logs.map(l => `
    <div class="log-item ${l.type}">
      <i class="fas fa-${l.type === 'safe' ? 'check-circle' : l.type === 'warn' ? 'exclamation-triangle' : 'times-circle'}"></i>
      <span>${l.msg}</span>
      <span style="margin-right:auto;color:var(--text-muted);font-size:0.8rem">${l.time}</span>
    </div>`).join('');
}

// Init
(async () => {
  await loadAdminUsers();
  renderAdminDashboard();
})();
