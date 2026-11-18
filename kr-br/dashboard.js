// Check auth
if (!DB.currentUser) { window.location.href = 'index.html'; }

let user = DB.currentUser;
const isSeller = user.type === 'seller';

// Update nav
document.getElementById('dash-user-info').innerHTML =
  `<i class="fas fa-user-circle"></i> ${user.name} <span style="color:var(--${isSeller ? 'accent' : 'primary'});margin-right:8px">(${isSeller ? 'بائع' : 'مشتري'})</span>`;

// Sidebar avatar
document.getElementById('sidebar-avatar').innerHTML = `
  <div style="width:70px;height:70px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-size:1.8rem;margin:0 auto 10px">
    ${user.name.charAt(0)}
  </div>
  <div style="font-weight:700">${user.name}</div>
  <div style="color:var(--text-muted);font-size:0.8rem">${isSeller ? '🏪 بائع برمجيات' : '🛒 مشتري برامج'}</div>`;

// Show/hide seller panels
if (!isSeller) {
  document.getElementById('btn-products').style.display = 'none';
  document.getElementById('btn-earnings').style.display = 'none';
  document.getElementById('btn-add').style.display = 'none';
}

// Panel navigation
document.querySelectorAll('.snav').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.snav').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('panel-' + btn.dataset.panel).classList.add('active');
    loadPanel(btn.dataset.panel);
  });
});

function loadPanel(name) {
  if (name === 'overview') renderOverview();
  if (name === 'purchases') renderPurchases();
  if (name === 'products') renderMyProducts();
  if (name === 'earnings') renderEarnings();
  if (name === 'visa') renderVisaForm();
}

// ===== OVERVIEW =====
function renderOverview() {
  const myTx = DB.transactions.filter(t => t.buyerId === user.id);
  const myEarnings = isSeller
    ? DB.transactions.filter(t => t.seller === user.name).reduce((s, t) => s + t.sellerAmount, 0)
    : 0;
  const myProducts = isSeller
    ? Object.values(DB.products).flat().filter(p => p.sellerId === user.id).length
    : 0;

  document.getElementById('overview-stats').innerHTML = `
    <div class="stat-card">
      <i class="fas fa-shopping-bag" style="color:var(--primary)"></i>
      <div class="num">${myTx.length}</div>
      <div class="lbl">مشترياتي</div>
    </div>
    ${isSeller ? `
    <div class="stat-card">
      <i class="fas fa-box" style="color:var(--accent)"></i>
      <div class="num">${myProducts}</div>
      <div class="lbl">منتجاتي</div>
    </div>
    <div class="stat-card">
      <i class="fas fa-dollar-sign" style="color:var(--success)"></i>
      <div class="num">$${myEarnings.toFixed(0)}</div>
      <div class="lbl">إجمالي الأرباح</div>
    </div>` : ''}
    <div class="stat-card">
      <i class="fas fa-credit-card" style="color:${user.visa ? 'var(--success)' : 'var(--danger)'}"></i>
      <div class="num" style="font-size:1rem">${user.visa ? '✓ مربوطة' : '✗ غير مربوطة'}</div>
      <div class="lbl">بطاقة الفيزا</div>
    </div>`;

  const recent = DB.transactions.filter(t => t.buyerId === user.id).slice(-5).reverse();
  document.getElementById('recent-tx').innerHTML = recent.length
    ? recent.map(t => `
      <div class="tx-item">
        <div>
          <div class="tx-name">${t.productName}</div>
          <div class="tx-date">${new Date(t.date).toLocaleDateString('ar')}</div>
        </div>
        <div class="tx-price">$${t.price}</div>
      </div>`).join('')
    : '<div class="empty-state"><i class="fas fa-receipt"></i><p>لا توجد معاملات بعد</p></div>';
}

// ===== VISA =====
function renderVisaForm() {
  const v = user.visa;
  const num = v ? v.number : 'XXXX XXXX XXXX XXXX';
  const exp = v ? v.expiry : 'MM/YY';
  const nm  = v ? v.name : 'اسمك هنا';
  const brand = v ? (v.brand || 'VISA') : 'VISA';
  document.getElementById('visa-preview').innerHTML = `
    <div class="visa-logo">${brand}</div>
    <div class="visa-card-num">${num}</div>
    <div class="visa-card-info">
      <div><small>حامل البطاقة</small><br>${nm}</div>
      <div><small>تاريخ الانتهاء</small><br>${exp}</div>
    </div>`;
  // Card data is encrypted server-side (AES-256-GCM). We never pre-fill the
  // full PAN; existing values are shown as placeholders, re-enter to update.
  document.getElementById('visa-number').value = '';
  document.getElementById('visa-expiry').value = '';
  document.getElementById('visa-name').value = '';
  document.getElementById('visa-number').placeholder = num;
  document.getElementById('visa-expiry').placeholder = exp;
  document.getElementById('visa-name').placeholder = nm;
}

async function saveVisa(e) {
  e.preventDefault();
  const number = document.getElementById('visa-number').value.replace(/\s/g, '');
  const expiry = document.getElementById('visa-expiry').value.trim();
  const cvv = document.getElementById('visa-cvv').value.trim();
  const name = document.getElementById('visa-name').value.trim();

  if (number.length < 13) { alert('رقم البطاقة غير صحيح'); return; }
  if (!expiry.match(/^\d{2}\/\d{2}$/)) { alert('تاريخ الانتهاء غير صحيح (MM/YY)'); return; }
  if (cvv.length < 3) { alert('CVV غير صحيح'); return; }
  if (name.length < 2) { alert('اسم حامل البطاقة غير صحيح'); return; }

  try {
    const data = await apiCall('/api/user/' + user.id + '/visa', { method: 'POST', body: { number, expiry, cvv, name } });
    if (data.error) { alert(data.error); return; }
    user = data.user; DB.currentUser = data.user; save('current');
    renderVisaForm();
    alert('✅ تم ربط البطاقة بنجاح. البيانات مشفّرة (AES-256) في قاعدة البيانات.');
  } catch (err) {
    alert('تعذر الاتصال بالخادم. تأكد من تشغيل الباك إند.');
  }
}

function formatCard(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 16);
  input.value = v.replace(/(.{4})/g, '$1 ').trim();
  updateVisaPreview();
}
function formatExpiry(input) {
  let v = input.value.replace(/\D/g, '').substring(0, 4);
  if (v.length >= 2) v = v.substring(0,2) + '/' + v.substring(2);
  input.value = v;
  updateVisaPreview();
}
function updateVisaPreview() {
  const num = document.getElementById('visa-number').value || 'XXXX XXXX XXXX XXXX';
  const exp = document.getElementById('visa-expiry').value || 'MM/YY';
  const name = document.getElementById('visa-name').value || 'اسمك هنا';
  document.getElementById('visa-preview').innerHTML = `
    <div class="visa-logo">VISA</div>
    <div class="visa-card-num">${num}</div>
    <div class="visa-card-info">
      <div><small>حامل البطاقة</small><br>${name}</div>
      <div><small>تاريخ الانتهاء</small><br>${exp}</div>
    </div>`;
}
document.getElementById('visa-name').addEventListener('input', updateVisaPreview);

// ===== PURCHASES =====
function renderPurchases() {
  const myTx = DB.transactions.filter(t => t.buyerId === user.id).reverse();
  document.getElementById('purchases-list').innerHTML = myTx.length
    ? myTx.map(t => `
      <div class="product-list-item">
        <div class="pli-icon">📦</div>
        <div class="pli-info">
          <div class="pli-name">${t.productName}</div>
          <div class="pli-desc">البائع: ${t.seller} | ${new Date(t.date).toLocaleDateString('ar')}</div>
        </div>
        <div class="pli-price">$${t.price}</div>
      </div>`).join('')
    : '<div class="empty-state"><i class="fas fa-shopping-bag"></i><p>لا توجد مشتريات بعد</p></div>';
}

// ===== MY PRODUCTS (seller) =====
function renderMyProducts() {
  const myProds = Object.values(DB.products).flat().filter(p => p.sellerId === user.id);
  document.getElementById('my-products-list').innerHTML = myProds.length
    ? myProds.map(p => `
      <div class="product-list-item">
        <div class="pli-icon">${p.icon || '📦'}</div>
        <div class="pli-info">
          <div class="pli-name">${p.name}</div>
          <div class="pli-desc">${p.desc}</div>
        </div>
        <div class="pli-price">$${p.price}</div>
      </div>`).join('')
    : '<div class="empty-state"><i class="fas fa-box-open"></i><p>لم تضف منتجات بعد</p></div>';
}

// ===== EARNINGS (seller) =====
function renderEarnings() {
  const myTx = DB.transactions.filter(t => t.seller === user.name);
  const total = myTx.reduce((s, t) => s + t.sellerAmount, 0);
  const commission = myTx.reduce((s, t) => s + t.commission, 0);

  document.getElementById('earnings-content').innerHTML = `
    <div class="earnings-summary">
      <div style="color:var(--text-muted);margin-bottom:10px">إجمالي الأرباح (بعد خصم العمولة)</div>
      <div class="earnings-total">$${total.toFixed(2)}</div>
      <div class="earnings-note">تم خصم $${commission.toFixed(2)} كعمولة للمنصة (10%)</div>
    </div>
    ${myTx.length ? myTx.reverse().map(t => `
      <div class="tx-item">
        <div>
          <div class="tx-name">${t.productName}</div>
          <div class="tx-date">${new Date(t.date).toLocaleDateString('ar')} | المشتري: ${t.buyerName}</div>
        </div>
        <div>
          <div class="tx-price">$${t.sellerAmount.toFixed(2)}</div>
          <div style="color:var(--danger);font-size:0.8rem">عمولة: $${t.commission.toFixed(2)}</div>
        </div>
      </div>`).join('')
    : '<div class="empty-state"><i class="fas fa-chart-line"></i><p>لا توجد مبيعات بعد</p></div>'}`;
}

// ===== ADD PRODUCT =====
function addProduct(e) {
  e.preventDefault();
  if (!isSeller) return;

  const name = document.getElementById('p-name').value.trim();
  const desc = document.getElementById('p-desc').value.trim();
  const cat = document.getElementById('p-cat').value;
  const price = parseFloat(document.getElementById('p-price').value);
  const icon = document.getElementById('p-icon').value || '📦';

  const product = {
    id: 'p_' + Date.now(),
    name, desc, price, category: cat,
    seller: user.name, sellerId: user.id,
    icon, badge: 'جديد'
  };

  DB.products[cat].push(product);
  save('products');

  alert('✅ تم نشر المنتج بنجاح');
  document.getElementById('add-product-form').reset();
  document.querySelectorAll('.snav')[4].click();
}

// ===== LOGOUT =====
function logout() {
  DB.currentUser = null;
  localStorage.removeItem('krbr_current');
  setApiToken(null);
  window.location.href = 'index.html';
}

// Init — pull the latest profile from the encrypted backend, then render
(async () => {
  try {
    const res = await fetch(API_BASE + '/api/user/' + user.id, { headers: authHeaders() });
    if (res.status === 401 || res.status === 403) { logout(); return; }
    const data = await res.json();
    if (data && !data.error) { user = data; DB.currentUser = data; save('current'); }
  } catch (_) { /* backend down — continue with the local session */ }
  renderOverview();
  renderVisaForm();
})();
