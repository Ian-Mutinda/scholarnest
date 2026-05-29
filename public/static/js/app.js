// ─── State ────────────────────────────────────────────────────────────────────
const State = {
  user: null,
  universities: [],
  currentDoc: null,
  viewer: { code: null, docId: null, page: 1, totalPages: 1, zoom: 100 },
  marketplace: { uniId: 'all', deptId: 'all', docType: 'all', search: '', page: 1, docs: [] },
  paymentPoll: null,
};

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupAntiScreenshot();
  setupDeviceInfo();
  await loadUniversities();
  await tryRestoreSession();
  window.location.hash = '';
  navigate('marketplace', null, false);
  window.addEventListener('hashchange', handleHashNav);
  setupSearchDebounce();
  bindStaticListeners();
});

// ─── Bind all static event listeners ─────────────────────────────────────────
function bindStaticListeners() {
  // Nav
  document.getElementById('nav-logo').addEventListener('click', e => { e.preventDefault(); navigate('marketplace'); });
  document.getElementById('nav-login-btn').addEventListener('click', () => navigate('login'));
  document.getElementById('nav-register-btn').addEventListener('click', () => navigate('register'));
  document.getElementById('notif-btn').addEventListener('click', toggleNotifications);
  document.getElementById('user-avatar-btn').addEventListener('click', toggleUserMenu);
  document.getElementById('mark-all-read-btn').addEventListener('click', markAllRead);

  // User menu
  document.getElementById('menu-my-codes').addEventListener('click', () => navigate('my-codes'));
  document.getElementById('menu-purchases').addEventListener('click', () => navigate('my-codes'));
  document.getElementById('menu-seller-dashboard').addEventListener('click', () => navigate('seller-dashboard'));
  document.getElementById('menu-upload').addEventListener('click', () => navigate('upload'));
  document.getElementById('menu-admin').addEventListener('click', () => navigate('admin'));
  document.getElementById('menu-logout').addEventListener('click', logout);

  // Marketplace
  document.getElementById('load-more-btn').addEventListener('click', loadMoreDocs);
  document.getElementById('doc-back-btn').addEventListener('click', () => navigate('marketplace'));

  // Uni filter chips (static "All" chip)
  document.querySelector('#uni-filters .chip[data-uni="all"]').addEventListener('click', function() {
    filterByUni('all', this);
  });

  // Type filter chips
  document.querySelectorAll('#type-filters .chip').forEach(chip => {
    chip.addEventListener('click', function() {
      filterByType(this.dataset.type, this);
    });
  });

  // Viewer
  document.getElementById('viewer-back-btn').addEventListener('click', () => navigate('marketplace'));
  document.getElementById('zoom-out-btn').addEventListener('click', zoomOut);
  document.getElementById('zoom-in-btn').addEventListener('click', zoomIn);
  document.getElementById('prev-page').addEventListener('click', () => changePage(-1));
  document.getElementById('next-page').addEventListener('click', () => changePage(1));

  // Access code
  document.getElementById('access-code-input').addEventListener('input', function() { formatAccessCode(this); });
  document.getElementById('access-code-input').addEventListener('keydown', e => { if (e.key === 'Enter') submitAccessCode(); });
  document.getElementById('unlock-btn').addEventListener('click', submitAccessCode);
  document.getElementById('view-all-codes-btn').addEventListener('click', () => navigate('my-codes'));

  // My codes
  document.getElementById('buy-more-btn').addEventListener('click', () => navigate('marketplace'));

  // Login
  document.getElementById('login-btn').addEventListener('click', doLogin);
  document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('go-register-link').addEventListener('click', e => { e.preventDefault(); navigate('register'); });

  // Register
  document.getElementById('reg-btn').addEventListener('click', doRegister);
  document.getElementById('go-login-link').addEventListener('click', e => { e.preventDefault(); navigate('login'); });
  document.getElementById('role-toggle').addEventListener('click', e => {
    const btn = e.target.closest('.role-btn');
    if (btn) selectRole(btn.dataset.role, btn);
  });

  // Upload
  document.getElementById('upload-dropzone').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', function() { handleFileSelect(this); });
  document.getElementById('upload-btn').addEventListener('click', submitUpload);

  // Seller dashboard
  document.getElementById('seller-upload-btn').addEventListener('click', () => navigate('upload'));

  // Admin tabs
  document.getElementById('admin-tabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) switchAdminTab(btn.dataset.tab, btn);
  });

  // Payment modal
  document.getElementById('modal-close-btn').addEventListener('click', closePaymentModal);
  document.getElementById('pay-btn').addEventListener('click', initiatePayment);

  // Close dropdowns on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#notif-btn') && !e.target.closest('#notif-panel')) {
      document.getElementById('notif-panel').hidden = true;
    }
    if (!e.target.closest('#user-avatar-btn') && !e.target.closest('#user-menu-panel')) {
      document.getElementById('user-menu-panel').hidden = true;
    }
  });

  // Hero search
  document.getElementById('hero-search').addEventListener('input', e => handleSearch(e.target.value));
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function handleHashNav() {
  const hash = window.location.hash.slice(1) || 'marketplace';
  const [page, param] = hash.split('/');
  navigate(page, param, false);
}

function navigate(page, param = null, pushState = true) {
  const protectedPages = ['my-codes', 'purchases', 'seller-dashboard', 'upload', 'admin'];
  if (protectedPages.includes(page) && !State.user) { navigate('login'); return; }
  if (['seller-dashboard', 'upload'].includes(page) && State.user?.role === 'buyer') { showToast('Seller account required'); return; }
  if (page === 'admin' && State.user?.role !== 'admin') { showToast('Admin access required'); return; }

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const pageEl = document.getElementById(`page-${page}`);
  if (!pageEl) { navigate('marketplace'); return; }
  pageEl.classList.add('active');

  if (pushState) window.history.pushState(null, '', `#${page}${param ? '/' + param : ''}`);

  if (page === 'marketplace') loadMarketplace();
  if (page === 'document' && param) loadDocumentDetail(param);
  if (page === 'viewer' && param) openViewer(param, State.viewer.code);
  if (page === 'my-codes') loadMyCodes();
  if (page === 'seller-dashboard') loadSellerDashboard();
  if (page === 'admin') loadAdminPanel();
  if (page === 'upload') loadUploadForm();
  if (page === 'access') setupAccessPage();

  closeDropdowns();
}

// ─── Session ──────────────────────────────────────────────────────────────────
async function tryRestoreSession() {
  try {
    const user = await API.auth.me();
    setUser(user);
  } catch {}
}

function setUser(user) {
  State.user = user;
  const authBtns = document.getElementById('nav-auth-btns');
  const userMenu = document.getElementById('nav-user-menu');

  if (user) {
    authBtns.hidden = true;
    userMenu.hidden = false;
    document.getElementById('nav-avatar-initials').textContent =
      user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    document.getElementById('user-menu-name').textContent = user.full_name;
    document.getElementById('user-menu-role').textContent =
      user.role === 'seller' ? 'Seller account' :
      user.role === 'admin' ? 'Administrator' : 'Student account';
    document.getElementById('seller-menu-items').hidden = !['seller', 'admin'].includes(user.role);
    document.getElementById('admin-menu-items').hidden = user.role !== 'admin';
    loadNotifications();
  } else {
    authBtns.hidden = false;
    userMenu.hidden = true;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  errEl.hidden = true;
  btn.disabled = true; btn.textContent = 'Logging in…';

  try {
    const { user } = await API.auth.login({ email, password });
    setUser(user);
    showToast(`Welcome back, ${user.full_name.split(' ')[0]}!`);
    navigate('marketplace');
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Log in';
  }
}

let selectedRole = 'buyer';
function selectRole(role, btn) {
  selectedRole = role;
  document.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('seller-note').hidden = role !== 'seller';
}

async function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const university_id = document.getElementById('reg-university').value;
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-error');
  const btn = document.getElementById('reg-btn');

  errEl.hidden = true;
  if (!name || !email || !password || !university_id) {
    errEl.textContent = 'Please fill in all required fields'; errEl.hidden = false; return;
  }

  btn.disabled = true; btn.textContent = 'Creating account…';

  try {
    const { user } = await API.auth.register({ full_name: name, phone, email, university_id, password, role: selectedRole });
    setUser(user);
    showToast(selectedRole === 'seller' ? "Application submitted! We'll review it soon." : 'Account created!');
    navigate('marketplace');
  } catch (err) {
    errEl.textContent = err.message; errEl.hidden = false;
  } finally {
    btn.disabled = false; btn.textContent = 'Create account';
  }
}

async function logout() {
  await API.auth.logout().catch(() => {});
  State.user = null;
  setUser(null);
  navigate('marketplace');
  showToast('Logged out');
}

// ─── Universities ─────────────────────────────────────────────────────────────
async function loadUniversities() {
  try {
    State.universities = await API.universities();
    const sel = document.getElementById('reg-university');
    State.universities.forEach(u => {
      sel.innerHTML += `<option value="${u.id}">${u.name} (${u.short_name})</option>`;
    });
    const filtersEl = document.getElementById('uni-filters');
    State.universities.forEach(u => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.dataset.uni = u.id;
      btn.textContent = u.short_name;
      btn.addEventListener('click', function() { filterByUni(u.id, this); });
      filtersEl.appendChild(btn);
    });
  } catch {}
}

// ─── Marketplace ──────────────────────────────────────────────────────────────
async function loadMarketplace(reset = false) {
  if (reset) { State.marketplace.page = 1; State.marketplace.docs = []; }

  const { uniId, deptId, docType, search, page } = State.marketplace;
  const params = { page, limit: 18 };
  if (uniId !== 'all') params.university_id = uniId;
  if (deptId !== 'all') params.department_id = deptId;
  if (docType !== 'all') params.doc_type = docType;
  if (search) params.search = search;

  const grid = document.getElementById('notes-grid');
  if (page === 1) grid.innerHTML = Array(6).fill('<div class="skeleton-card"></div>').join('');

  try {
    const { documents } = await API.docs.list(params);
    if (page === 1) State.marketplace.docs = documents;
    else State.marketplace.docs = [...State.marketplace.docs, ...documents];

    renderNotesGrid(State.marketplace.docs);
    document.getElementById('notes-count').textContent =
      State.marketplace.docs.length ? `${State.marketplace.docs.length} documents` : '';
    document.getElementById('load-more-wrap').hidden = documents.length < 18;
  } catch {
    grid.innerHTML = '<div class="empty-state"><i class="ti ti-mood-sad"></i><p>Failed to load documents</p></div>';
  }
}

function renderNotesGrid(docs) {
  const grid = document.getElementById('notes-grid');
  if (!docs.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="ti ti-file-off"></i><p>No documents found</p></div>';
    return;
  }
  grid.innerHTML = docs.map(d => noteCardHTML(d)).join('');
  // Bind click events on cards
  grid.querySelectorAll('.note-card').forEach(card => {
    card.addEventListener('click', () => navigate('document', card.dataset.id));
  });
  grid.querySelectorAll('.note-buy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const { id, price, title } = btn.dataset;
      openPaymentModal('individual', null, id, price, title);
    });
  });
}

function noteCardHTML(d) {
  const typeColors = {
    notes: { bg: '#e1f5ee', text: '#085041' },
    past_paper: { bg: '#faeeda', text: '#633806' },
    summary: { bg: '#eeedfe', text: '#3c3489' },
    revision_pack: { bg: '#fcebeb', text: '#791f1f' },
    bundle: { bg: '#e6f1fb', text: '#0c447c' },
  };
  const c = typeColors[d.doc_type] || typeColors.notes;
  const typeLabel = d.doc_type.replace('_', ' ');
  const stars = d.avg_rating > 0 ? `<span class="star">★</span> ${parseFloat(d.avg_rating).toFixed(1)}` : 'New';
  return `
  <div class="note-card" data-id="${d.id}">
    <div class="note-thumb">
      <div class="note-thumb-lines">
        ${[80,60,80,40,80,60].map(w => `<div class="note-thumb-line w${w}"></div>`).join('')}
      </div>
      <div class="note-type-badge" style="background:${c.bg};color:${c.text}">${typeLabel}</div>
      <div class="note-lock-badge"><i class="ti ti-lock"></i> locked</div>
    </div>
    <div class="note-body">
      <div class="note-title">${escHtml(d.title)}</div>
      <div class="note-meta">
        <span>${escHtml(d.course_code || '')}</span>
        ${d.course_code ? '<span class="meta-dot"></span>' : ''}
        <span>${escHtml(d.seller_name)}</span>
        <span class="meta-dot"></span>
        <span>${d.total_pages}p</span>
      </div>
      <div class="note-footer">
        <div class="note-price">KSh ${d.price_individual || '—'} <sub>/ code</sub></div>
        <div class="note-rating">${stars}</div>
      </div>
    </div>
  </div>`;
}

function loadMoreDocs() {
  State.marketplace.page++;
  loadMarketplace();
}

async function filterByUni(uniId, btn) {
  document.querySelectorAll('#uni-filters .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  State.marketplace.uniId = uniId;
  State.marketplace.deptId = 'all';

  const deptBar = document.getElementById('dept-filter-bar');
  const passesSection = document.getElementById('passes-section');

  if (uniId !== 'all') {
    const depts = await API.departments(uniId).catch(() => []);
    const deptFilters = document.getElementById('dept-filters');
    deptFilters.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'chip active';
    allBtn.textContent = 'All departments';
    allBtn.addEventListener('click', function() { filterByDept('all', this); });
    deptFilters.appendChild(allBtn);

    depts.forEach(d => {
      const chip = document.createElement('button');
      chip.className = 'chip';
      chip.textContent = d.name;
      chip.addEventListener('click', function() { filterByDept(d.id, this); });
      deptFilters.appendChild(chip);
    });
    deptBar.hidden = false;

    const passes = await API.passes(uniId).catch(() => []);
    if (passes.length) { renderPasses(passes); passesSection.hidden = false; }
    else passesSection.hidden = true;
  } else {
    deptBar.hidden = true;
    passesSection.hidden = true;
  }

  loadMarketplace(true);
}

function filterByDept(deptId, btn) {
  document.querySelectorAll('#dept-filters .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  State.marketplace.deptId = deptId;
  loadMarketplace(true);
}

function filterByType(type, btn) {
  document.querySelectorAll('#type-filters .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  State.marketplace.docType = type;
  loadMarketplace(true);
}

function renderPasses(passes) {
  const grid = document.getElementById('passes-grid');
  grid.innerHTML = passes.map(p => `
    <div class="pass-card" data-pass-id="${p.id}" data-price="${p.price}" data-name="${escHtml(p.name)}">
      <div class="pass-duration">${p.duration_hours >= 24 ? Math.round(p.duration_hours / 24) + ' day' : p.duration_hours + 'hr'} access</div>
      <div class="pass-name">${escHtml(p.name)}</div>
      <div class="pass-price">KSh ${p.price} <span>/ pass</span></div>
      <div class="pass-badge"><i class="ti ti-infinity"></i> Unlimited docs in dept</div>
    </div>`).join('');

  grid.querySelectorAll('.pass-card').forEach(card => {
    card.addEventListener('click', () => {
      openPaymentModal('dept_pass', card.dataset.passId, null, card.dataset.price, card.dataset.name);
    });
  });
}

// ─── Document detail ──────────────────────────────────────────────────────────
async function loadDocumentDetail(docId) {
  const container = document.getElementById('doc-detail-content');
  container.innerHTML = '<div class="empty-state"><i class="ti ti-loader ti-spin"></i></div>';

  try {
    const doc = await API.docs.get(docId);
    State.currentDoc = doc;

    container.innerHTML = `
      <div class="doc-detail-grid">
        <div class="doc-preview-pane">
          <img src="${API.docs.preview(docId)}" alt="Preview" onerror="this.style.display='none'" />
          <div class="doc-preview-note"><i class="ti ti-eye"></i> First page preview only</div>
        </div>
        <div class="doc-info-pane">
          <div class="doc-badges">
            <span class="badge badge-accent">${doc.university_short}</span>
            <span class="badge">${escHtml(doc.department_name)}</span>
            <span class="badge">${doc.doc_type.replace('_', ' ')}</span>
            ${doc.course_code ? `<span class="badge">${escHtml(doc.course_code)}</span>` : ''}
            ${doc.is_premium ? '<span class="badge badge-accent">★ Premium</span>' : ''}
          </div>
          <h1>${escHtml(doc.title)}</h1>
          <div class="doc-seller-row">
            <div class="seller-avatar-sm">${doc.seller_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
            <span>by ${escHtml(doc.seller_name)}</span>
            ${doc.avg_rating > 0 ? `<span>· ★ ${parseFloat(doc.avg_rating).toFixed(1)} (${doc.total_ratings})</span>` : ''}
            <span>· ${doc.total_pages} pages</span>
          </div>
          <p class="doc-description">${escHtml(doc.description || 'No description provided.')}</p>
          <div class="doc-price-box">
            <div class="doc-price-main">KSh ${doc.price_individual || '—'}</div>
            <div class="doc-price-sub">One-time purchase · 7-day device-locked access</div>
          </div>
          <div class="doc-actions">
            ${State.user
              ? `<button class="btn btn-primary" id="buy-doc-btn" data-id="${doc.id}" data-price="${doc.price_individual}" data-title="${escHtml(doc.title)}">
                   <i class="ti ti-lock-open"></i> Buy access — KSh ${doc.price_individual}
                 </button>`
              : `<button class="btn btn-primary" id="signup-to-buy-btn">
                   <i class="ti ti-user-plus"></i> Sign up to purchase
                 </button>`
            }
            <button class="btn btn-ghost" id="have-code-btn">
              <i class="ti ti-key"></i> I already have a code
            </button>
          </div>
          <div style="margin-top:16px;font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:4px;">
            <span><i class="ti ti-shield-check" style="color:var(--accent)"></i> Access code locked to your device only</span>
            <span><i class="ti ti-eye-off" style="color:var(--accent)"></i> Documents served as images — not downloadable</span>
            <span><i class="ti ti-writing-sign" style="color:var(--accent)"></i> Personalized watermark on every page</span>
          </div>
        </div>
      </div>`;

    // Bind buttons after render
    document.getElementById('buy-doc-btn')?.addEventListener('click', function() {
      openPaymentModal('individual', null, this.dataset.id, this.dataset.price, this.dataset.title);
    });
    document.getElementById('signup-to-buy-btn')?.addEventListener('click', () => navigate('register'));
    document.getElementById('have-code-btn')?.addEventListener('click', () => navigate('access'));
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="ti ti-file-off"></i><p>${err.message}</p></div>`;
  }
}

// ─── Viewer ───────────────────────────────────────────────────────────────────
async function openViewer(docId, code) {
  if (!code) { navigate('access'); return; }

  State.viewer.docId = docId;
  State.viewer.code = code;
  State.viewer.page = 1;
  State.viewer.zoom = 100;

  try {
    const result = await API.payments.validateCode({ code, document_id: docId });
    State.viewer.totalPages = result.totalPages || 1;
    document.getElementById('viewer-title').textContent = result.documentTitle || 'Document';
    document.getElementById('viewer-subtitle').textContent = `Code: ${code} · Locked to this device`;
    renderViewerPages();
    loadViewerPage(1);
    trackEngagement('open');
    startReadingTimer();
  } catch (err) {
    navigate('access');
    setTimeout(() => {
      const errEl = document.getElementById('access-error');
      errEl.textContent = err.message;
      errEl.hidden = false;
    }, 100);
  }
}

function renderViewerPages() {
  const container = document.getElementById('viewer-pages');
  container.innerHTML = '';
  for (let i = 1; i <= State.viewer.totalPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = `viewer-page-wrap${i === 1 ? ' active' : ''}`;
    wrap.id = `viewer-page-${i}`;
    wrap.innerHTML = `
      <div class="viewer-page-loading" id="viewer-loading-${i}"><i class="ti ti-loader"></i></div>
      <img id="viewer-img-${i}" style="display:none" alt="Page ${i}" />`;
    container.appendChild(wrap);
  }
  updateViewerPageInfo();
  renderPageDots();
}

function loadViewerPage(page) {
  const img = document.getElementById(`viewer-img-${page}`);
  const loading = document.getElementById(`viewer-loading-${page}`);
  if (!img || img.src) return;
  img.onload = () => { loading.hidden = true; img.style.display = 'block'; };
  img.onerror = () => { loading.innerHTML = '<span style="color:var(--muted);font-size:13px">Failed to load page</span>'; };
  img.src = API.docs.page(State.viewer.docId, page, State.viewer.code);
}

function changePage(delta) {
  const newPage = State.viewer.page + delta;
  if (newPage < 1 || newPage > State.viewer.totalPages) return;
  document.getElementById(`viewer-page-${State.viewer.page}`)?.classList.remove('active');
  State.viewer.page = newPage;
  document.getElementById(`viewer-page-${newPage}`)?.classList.add('active');
  loadViewerPage(newPage);
  if (newPage < State.viewer.totalPages) loadViewerPage(newPage + 1);
  updateViewerPageInfo();
  renderPageDots();
  document.getElementById('viewer-body').scrollTop = 0;
  if (newPage >= Math.floor(State.viewer.totalPages * 0.8)) trackEngagement('reach_80pct');
}

function updateViewerPageInfo() {
  document.getElementById('viewer-page-info').textContent = `Page ${State.viewer.page} of ${State.viewer.totalPages}`;
  document.getElementById('prev-page').disabled = State.viewer.page === 1;
  document.getElementById('next-page').disabled = State.viewer.page === State.viewer.totalPages;
}

function renderPageDots() {
  const dotsEl = document.getElementById('viewer-page-dots');
  const max = Math.min(State.viewer.totalPages, 10);
  dotsEl.innerHTML = '';
  for (let i = 1; i <= max; i++) {
    const dot = document.createElement('div');
    dot.className = `page-dot${i === State.viewer.page ? ' active' : ''}`;
    const target = i;
    dot.addEventListener('click', () => changePage(target - State.viewer.page));
    dotsEl.appendChild(dot);
  }
}

function zoomIn() { State.viewer.zoom = Math.min(State.viewer.zoom + 15, 200); applyZoom(); }
function zoomOut() { State.viewer.zoom = Math.max(State.viewer.zoom - 15, 60); applyZoom(); }
function applyZoom() {
  document.getElementById('viewer-pages').style.maxWidth = `${620 * State.viewer.zoom / 100}px`;
  document.getElementById('zoom-level').textContent = `${State.viewer.zoom}%`;
}

// ─── Engagement ───────────────────────────────────────────────────────────────
const _tracked = new Set();
let _readTimer = null;
const _sessionId = Math.random().toString(36).slice(2);

function trackEngagement(type) {
  if (!State.user || !State.viewer.code || _tracked.has(type)) return;
  _tracked.add(type);
  API.docs.engage(State.viewer.docId, { event_type: type, session_id: _sessionId, code: State.viewer.code }).catch(() => {});
}

function startReadingTimer() {
  clearTimeout(_readTimer);
  _readTimer = setTimeout(() => trackEngagement('read_5min'), 5 * 60 * 1000);
}

// ─── Access code ──────────────────────────────────────────────────────────────
function setupAccessPage() {
  document.getElementById('access-code-input').value = '';
  document.getElementById('access-error').hidden = true;
}

function formatAccessCode(el) {
  let v = el.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  let out = '';
  for (let i = 0; i < v.length && i < 12; i++) {
    if (i > 0 && i % 4 === 0) out += '-';
    out += v[i];
  }
  el.value = out;
  el.classList.remove('error');
  document.getElementById('access-error').hidden = true;
}

async function submitAccessCode() {
  const code = document.getElementById('access-code-input').value.trim();
  const errEl = document.getElementById('access-error');
  const btn = document.getElementById('unlock-btn');
  errEl.hidden = true;

  if (code.length < 12) { errEl.textContent = 'Please enter a complete code'; errEl.hidden = false; return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Validating…';

  try {
    const result = await API.payments.validateCode({ code });
    State.viewer.code = code;
    showToast(result.firstBind ? 'Code activated on this device!' : 'Code verified!');
    navigate('viewer', result.documentId || 'doc');
  } catch (err) {
    document.getElementById('access-code-input').classList.add('error');
    errEl.textContent = err.message; errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-lock-open"></i> Unlock document';
  }
}

// ─── My Codes ─────────────────────────────────────────────────────────────────
async function loadMyCodes() {
  const list = document.getElementById('my-codes-list');
  list.innerHTML = '<div class="empty-state"><i class="ti ti-loader ti-spin"></i></div>';
  try {
    const codes = await API.payments.myCodes();
    if (!codes.length) {
      list.innerHTML = '<div class="empty-state"><i class="ti ti-key"></i><p>No access codes yet. Browse notes to get started.</p></div>';
      return;
    }
    list.innerHTML = codes.map(c => {
      const expired = new Date(c.expires_at) < new Date();
      const label = c.document_title || c.pass_name || 'Document';
      const days = expired ? 'Expired' : `Expires ${relativeTime(c.expires_at)}`;
      return `
      <div class="code-row">
        <div>
          <div class="code-value">${c.code}</div>
          <div style="font-size:11px;margin-top:3px" class="${c.device_bound_at ? 'code-bound' : ''}">
            ${c.device_bound_at ? '🔒 Device bound' : '⚪ Not yet activated'}
          </div>
        </div>
        <div class="code-doc">
          <div class="code-doc-title">${escHtml(label)}</div>
          <div class="code-doc-meta">${days} · ${c.university || ''}</div>
        </div>
        <span class="code-status ${expired ? 'code-expired' : 'code-active'}">${expired ? 'Expired' : 'Active'}</span>
        ${!expired && c.document_title
          ? `<button class="btn btn-sm btn-primary open-code-btn" data-code="${c.code}">Open</button>`
          : ''}
      </div>`;
    }).join('');

    list.querySelectorAll('.open-code-btn').forEach(btn => {
      btn.addEventListener('click', () => activateCode(btn.dataset.code));
    });
  } catch {
    list.innerHTML = '<div class="empty-state"><p>Failed to load codes</p></div>';
  }
}

function activateCode(code) {
  State.viewer.code = code;
  navigate('access');
  setTimeout(() => { document.getElementById('access-code-input').value = code; }, 100);
}

// ─── Payment modal ────────────────────────────────────────────────────────────
let _pendingPayment = {};

function openPaymentModal(purchaseType, passId, docId, amount, label) {
  if (!State.user) { navigate('login'); return; }
  _pendingPayment = { purchaseType, passId, docId, amount };
  document.getElementById('modal-title').textContent = purchaseType === 'dept_pass' ? 'Buy department pass' : 'Buy document access';
  document.getElementById('modal-desc').textContent = `You're purchasing: ${label}`;
  document.getElementById('modal-amount').textContent = `KSh ${amount}`;
  document.getElementById('pay-phone').value = State.user?.phone || '';
  document.getElementById('pay-status').hidden = true;
  document.getElementById('pay-code-result').hidden = true;
  document.getElementById('pay-btn').hidden = false;
  document.getElementById('pay-btn').disabled = false;
  document.getElementById('pay-btn').innerHTML = '<i class="ti ti-brand-mastercard"></i> Send STK Push';
  document.getElementById('payment-modal').hidden = false;
}

function closePaymentModal() {
  document.getElementById('payment-modal').hidden = true;
  if (State.paymentPoll) clearInterval(State.paymentPoll);
}

async function initiatePayment() {
  const phone = document.getElementById('pay-phone').value.trim();
  const statusEl = document.getElementById('pay-status');
  const btn = document.getElementById('pay-btn');
  const codeResult = document.getElementById('pay-code-result');

  if (!phone) { showToast('Enter your M-Pesa number'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Sending…';
  statusEl.hidden = false;
  statusEl.textContent = '📲 Check your phone — enter your M-Pesa PIN to confirm';

  try {
    const result = await API.payments.initiate({
      phone,
      purchase_type: _pendingPayment.purchaseType,
      document_id: _pendingPayment.docId,
      pass_id: _pendingPayment.passId,
    });

    statusEl.textContent = '⏳ Waiting for M-Pesa confirmation…';
    let attempts = 0;

    State.paymentPoll = setInterval(async () => {
      attempts++;
      if (attempts > 24) {
        clearInterval(State.paymentPoll);
        statusEl.textContent = '⚠️ Payment timed out. Check your M-Pesa messages.';
        btn.disabled = false;
        btn.innerHTML = 'Try again';
        return;
      }
      try {
        const status = await API.payments.status(result.requestId);
        if (status.status === 'completed' && status.code) {
          clearInterval(State.paymentPoll);
          statusEl.hidden = true;
          btn.hidden = true;
          codeResult.hidden = false;
          codeResult.innerHTML = `
            <p>✅ Payment confirmed!</p>
            <div class="code-reveal">${status.code}</div>
            <p>Your access code — valid for 7 days on this device only</p>`;
          const openBtn = document.createElement('button');
          openBtn.className = 'btn btn-primary btn-full';
          openBtn.style.marginTop = '12px';
          openBtn.innerHTML = 'Open document <i class="ti ti-arrow-right"></i>';
          openBtn.addEventListener('click', () => {
            closePaymentModal();
            activateCode(status.code);
          });
          codeResult.appendChild(openBtn);
          showToast('Payment confirmed! Code generated.');
        } else if (status.status === 'failed') {
          clearInterval(State.paymentPoll);
          statusEl.textContent = '❌ Payment failed or cancelled. Please try again.';
          btn.disabled = false;
          btn.innerHTML = 'Try again';
        }
      } catch {}
    }, 5000);
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-brand-mastercard"></i> Send STK Push';
  }
}

// ─── Seller dashboard ─────────────────────────────────────────────────────────
async function loadSellerDashboard() {
  try {
    const data = await API.seller.dashboard();
    document.getElementById('seller-stats-grid').innerHTML = [
      { val: `KSh ${data.earnings.total.toLocaleString()}`, lbl: 'Total earned' },
      { val: `KSh ${data.earnings.pending.toLocaleString()}`, lbl: 'Pending payout' },
      { val: data.documents.approved, lbl: 'Live documents' },
      { val: data.documents.pending, lbl: 'Under review' },
      { val: data.ratings.average.toFixed(1) + ' ★', lbl: 'Avg rating' },
    ].map(s => `<div class="stat-card"><div class="stat-val">${s.val}</div><div class="stat-lbl">${s.lbl}</div></div>`).join('');

    const docs = await API.seller.documents();
    const docsList = document.getElementById('seller-docs-list');
    if (!docs.length) {
      docsList.innerHTML = '<div class="empty-state"><i class="ti ti-file-off"></i><p>No documents yet.</p></div>';
    } else {
      docsList.innerHTML = docs.map(d => `
        <div class="seller-doc-row">
          <div class="seller-doc-info">
            <div class="seller-doc-title">${escHtml(d.title)}</div>
            <div class="seller-doc-meta">${d.course_code || '—'} · ${d.total_purchases} sales · ${d.avg_rating > 0 ? '★ ' + parseFloat(d.avg_rating).toFixed(1) : 'No ratings'}</div>
            ${d.rejection_reason ? `<div style="font-size:12px;color:var(--danger);margin-top:3px">Rejected: ${escHtml(d.rejection_reason)}</div>` : ''}
          </div>
          <span class="doc-status-badge status-${d.status}">${d.status}</span>
        </div>`).join('');
    }

    const salesList = document.getElementById('seller-sales-list');
    if (!data.recentSales?.length) {
      salesList.innerHTML = '<div class="empty-state-sm">No sales yet</div>';
    } else {
      salesList.innerHTML = data.recentSales.map(s => `
        <div class="sale-row">
          <span class="sale-amount">KSh ${s.seller_amount}</span>
          <span class="sale-doc">${escHtml(s.document_title)}</span>
          <span class="sale-payout ${s.payout_status === 'paid' ? 'payout-paid' : 'payout-pending'}">${s.payout_status}</span>
        </div>`).join('');
    }
  } catch { showToast('Failed to load dashboard'); }
}

// ─── Upload ───────────────────────────────────────────────────────────────────
async function loadUploadForm() {
  if (!State.user) return;
  const deptSel = document.getElementById('up-department');
  deptSel.innerHTML = '<option value="">Select department…</option>';
  try {
    const depts = await API.departments(State.user.university_id);
    depts.forEach(d => { deptSel.innerHTML += `<option value="${d.id}">${d.name}</option>`; });
  } catch {}
}

let _uploadFile = null;
function handleFileSelect(input) {
  const file = input.files[0];
  if (!file) return;
  _uploadFile = file;
  document.getElementById('upload-dropzone').classList.add('has-file');
  document.getElementById('upload-filename').textContent = `📎 ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
}

async function submitUpload() {
  const title = document.getElementById('up-title').value.trim();
  const course = document.getElementById('up-course').value.trim();
  const deptId = document.getElementById('up-department').value;
  const type = document.getElementById('up-type').value;
  const year = document.getElementById('up-year').value;
  const price = document.getElementById('up-price').value;
  const desc = document.getElementById('up-description').value.trim();
  const errEl = document.getElementById('upload-error');
  const btn = document.getElementById('upload-btn');

  errEl.hidden = true;
  if (!_uploadFile) { errEl.textContent = 'Please select a file'; errEl.hidden = false; return; }
  if (!title) { errEl.textContent = 'Title is required'; errEl.hidden = false; return; }
  if (!deptId) { errEl.textContent = 'Please select a department'; errEl.hidden = false; return; }

  const form = new FormData();
  form.append('document', _uploadFile);
  form.append('title', title);
  form.append('course_code', course);
  form.append('department_id', deptId);
  form.append('doc_type', type);
  form.append('year', year);
  form.append('price_individual', price);
  form.append('description', desc);

  btn.disabled = true;
  btn.innerHTML = '<i class="ti ti-loader ti-spin"></i> Uploading…';

  try {
    await API.docs.upload(form);
    showToast('Document submitted for review!');
    _uploadFile = null;
    document.getElementById('upload-dropzone').classList.remove('has-file');
    document.getElementById('upload-filename').textContent = '';
    document.getElementById('up-title').value = '';
    document.getElementById('up-description').value = '';
    navigate('seller-dashboard');
  } catch (err) {
    errEl.textContent = err.message; errEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-upload"></i> Submit for review';
  }
}

// ─── Admin ────────────────────────────────────────────────────────────────────
async function loadAdminPanel() {
  try {
    const stats = await API.admin.stats();
    document.getElementById('admin-stats-grid').innerHTML = [
      { val: stats.totalUsers, lbl: 'Total users' },
      { val: stats.approvedDocuments, lbl: 'Live docs' },
      { val: stats.totalPurchases, lbl: 'Purchases' },
      { val: `KSh ${(stats.platformRevenue || 0).toLocaleString()}`, lbl: 'Platform revenue' },
      { val: stats.pendingDocuments, lbl: 'Docs to review' },
      { val: stats.pendingSellers, lbl: 'Seller applications' },
    ].map(s => `<div class="stat-card"><div class="stat-val">${s.val}</div><div class="stat-lbl">${s.lbl}</div></div>`).join('');
    loadAdminSellers();
  } catch {}
}

async function loadAdminSellers() {
  const list = document.getElementById('admin-sellers-list');
  const sellers = await API.admin.pendingSellers().catch(() => []);
  if (!sellers.length) { list.innerHTML = '<div class="empty-state-sm">No pending applications</div>'; return; }
  list.innerHTML = sellers.map(s => `
    <div class="admin-row">
      <div class="admin-row-info">
        <div class="admin-row-title">${escHtml(s.full_name)}</div>
        <div class="admin-row-sub">${escHtml(s.email)} · ${escHtml(s.university_name || '—')} · Applied ${relativeTime(s.created_at)}</div>
        ${s.seller_bio ? `<div style="font-size:13px;margin-top:4px">${escHtml(s.seller_bio)}</div>` : ''}
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-sm btn-primary approve-seller-btn" data-id="${s.id}">Approve</button>
        <button class="btn btn-sm btn-ghost reject-seller-btn" data-id="${s.id}">Reject</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.approve-seller-btn').forEach(btn => {
    btn.addEventListener('click', () => adminApproveSeller(btn.dataset.id));
  });
  list.querySelectorAll('.reject-seller-btn').forEach(btn => {
    btn.addEventListener('click', () => adminRejectSeller(btn.dataset.id));
  });
}

async function loadAdminDocs() {
  const list = document.getElementById('admin-docs-list');
  const docs = await API.admin.pendingDocs().catch(() => []);
  if (!docs.length) { list.innerHTML = '<div class="empty-state-sm">No documents pending review</div>'; return; }
  list.innerHTML = docs.map(d => `
    <div class="admin-row">
      <div class="admin-row-info">
        <div class="admin-row-title">${escHtml(d.title)}</div>
        <div class="admin-row-sub">${escHtml(d.seller_name)} · ${d.short_name} ${escHtml(d.department)} · ${d.total_pages} pages · Plagiarism: ${d.plagiarism_score}%</div>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-sm btn-primary approve-doc-btn" data-id="${d.id}">Approve</button>
        <button class="btn btn-sm btn-danger reject-doc-btn" data-id="${d.id}">Reject</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.approve-doc-btn').forEach(btn => {
    btn.addEventListener('click', () => adminApproveDoc(btn.dataset.id));
  });
  list.querySelectorAll('.reject-doc-btn').forEach(btn => {
    btn.addEventListener('click', () => adminRejectDoc(btn.dataset.id));
  });
}

async function loadAdminPayouts() {
  const list = document.getElementById('admin-payouts-list');
  const payouts = await API.admin.pendingPayouts().catch(() => []);
  if (!payouts.length) { list.innerHTML = '<div class="empty-state-sm">No payouts due</div>'; return; }
  list.innerHTML = payouts.map(p => `
    <div class="admin-row">
      <div class="admin-row-info">
        <div class="admin-row-title">${escHtml(p.seller_name)} — KSh ${p.seller_amount}</div>
        <div class="admin-row-sub">${escHtml(p.document_title)} · ${escHtml(p.seller_phone)} · Due ${relativeTime(p.payout_at)}</div>
      </div>
      <div class="admin-row-actions">
        <button class="btn btn-sm btn-primary process-payout-btn" data-id="${p.id}">Pay now</button>
      </div>
    </div>`).join('');

  list.querySelectorAll('.process-payout-btn').forEach(btn => {
    btn.addEventListener('click', () => adminProcessPayout(btn.dataset.id));
  });
}

function switchAdminTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`admin-tab-${tab}`).classList.add('active');
  if (tab === 'sellers') loadAdminSellers();
  if (tab === 'documents') loadAdminDocs();
  if (tab === 'payouts') loadAdminPayouts();
}

async function adminApproveSeller(id) {
  await API.admin.approveSeller(id).catch(err => showToast(err.message));
  showToast('Seller approved'); loadAdminSellers();
}
async function adminRejectSeller(id) {
  const reason = prompt('Reason for rejection (sent to applicant):');
  if (!reason) return;
  await API.admin.rejectSeller(id, reason).catch(err => showToast(err.message));
  showToast('Seller rejected'); loadAdminSellers();
}
async function adminApproveDoc(id) {
  await API.admin.approveDoc(id).catch(err => showToast(err.message));
  showToast('Document approved and live!'); loadAdminDocs();
}
async function adminRejectDoc(id) {
  const reason = prompt('Reason for rejection (sent to seller):');
  if (!reason) return;
  await API.admin.rejectDoc(id, reason).catch(err => showToast(err.message));
  showToast('Document rejected'); loadAdminDocs();
}
async function adminProcessPayout(id) {
  await API.admin.processPayout(id).catch(err => showToast(err.message));
  showToast('Payout processed'); loadAdminPayouts();
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function loadNotifications() {
  try {
    const notifs = await API.notifications();
    const unread = notifs.filter(n => !n.is_read);
    document.getElementById('notif-dot').hidden = unread.length === 0;
    const list = document.getElementById('notif-list');
    if (!notifs.length) { list.innerHTML = '<div class="empty-state-sm">No notifications</div>'; return; }
    list.innerHTML = notifs.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}" data-id="${n.id}">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-msg">${escHtml(n.message)}</div>
      </div>`).join('');

    list.querySelectorAll('.notif-item').forEach(item => {
      item.addEventListener('click', function() {
        this.classList.remove('unread');
        API.markNotifRead(this.dataset.id).catch(() => {});
      });
    });
  } catch {}
}

function markAllRead() {
  document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
  document.getElementById('notif-dot').hidden = true;
}

function toggleNotifications() {
  document.getElementById('user-menu-panel').hidden = true;
  const panel = document.getElementById('notif-panel');
  panel.hidden = !panel.hidden;
}

function toggleUserMenu() {
  document.getElementById('notif-panel').hidden = true;
  const panel = document.getElementById('user-menu-panel');
  panel.hidden = !panel.hidden;
}

function closeDropdowns() {
  document.getElementById('notif-panel').hidden = true;
  document.getElementById('user-menu-panel').hidden = true;
}

// ─── Device info ──────────────────────────────────────────────────────────────
function setupDeviceInfo() {
  const raw = [navigator.userAgent, navigator.language, screen.width, screen.height, new Date().getTimezoneOffset()].join('|');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) { hash = ((hash << 5) - hash) + raw.charCodeAt(i); hash |= 0; }
  const fp = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
  const browser = navigator.userAgent.includes('Chrome') ? 'Chrome'
    : navigator.userAgent.includes('Firefox') ? 'Firefox'
    : navigator.userAgent.includes('Safari') ? 'Safari' : 'Browser';
  document.getElementById('di-fp').textContent = fp;
  document.getElementById('di-browser').textContent = `${browser} / ${navigator.platform || 'Unknown'}`;
}

// ─── Anti-screenshot ──────────────────────────────────────────────────────────
function setupAntiScreenshot() {
  document.addEventListener('contextmenu', e => {
    if (e.target.closest('#page-viewer')) e.preventDefault();
  });
  document.addEventListener('keydown', e => {
    if (!document.getElementById('page-viewer')?.classList.contains('active')) return;
    const blocked = (e.ctrlKey || e.metaKey) && ['s','p','c','a','u'].includes(e.key.toLowerCase());
    if (blocked || e.key === 'PrintScreen') {
      e.preventDefault();
      showToast('This action is disabled for protected documents');
    }
  });
  document.addEventListener('visibilitychange', () => {
    const pages = document.getElementById('viewer-pages');
    if (!pages) return;
    pages.style.filter = document.hidden && document.getElementById('page-viewer')?.classList.contains('active') ? 'blur(20px)' : '';
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────
let _searchTimeout;
function setupSearchDebounce() {
  document.getElementById('nav-search-input').addEventListener('input', e => handleSearch(e.target.value));
}

function handleSearch(val) {
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(() => {
    State.marketplace.search = val;
    document.getElementById('hero-search').value = val;
    document.getElementById('nav-search-input').value = val;
    if (document.getElementById('page-marketplace')?.classList.contains('active')) loadMarketplace(true);
  }, 350);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function relativeTime(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const abs = Math.abs(diff), future = diff < 0;
  if (abs < 60000) return 'just now';
  if (abs < 3600000) return `${future ? 'in ' : ''}${Math.round(abs/60000)}m${future ? '' : ' ago'}`;
  if (abs < 86400000) return `${future ? 'in ' : ''}${Math.round(abs/3600000)}h${future ? '' : ' ago'}`;
  return `${future ? 'in ' : ''}${Math.round(abs/86400000)}d${future ? '' : ' ago'}`;
}

let _toastTimeout;
function showToast(msg, duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => { toast.hidden = true; }, duration);
}

// ─── Lucide icons ─────────────────────────────────────────────────────────────
function initIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// Re-init icons whenever DOM changes (after dynamic content renders)
const _iconObserver = new MutationObserver(() => {
  if (window.lucide) window.lucide.createIcons();
});
_iconObserver.observe(document.getElementById('app'), { childList: true, subtree: true });
