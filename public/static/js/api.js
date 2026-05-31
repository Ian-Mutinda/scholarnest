// ─── API Client ───────────────────────────────────────────────────────────────
const API = {
  base: '/api',

  async request(method, path, body = null, isFormData = false) {
    const opts = {
      method,
      credentials: 'include',
      headers: isFormData ? {} : { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);

    const res = await fetch(`${this.base}${path}`, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
    return data;
  },

  get:    (path)        => API.request('GET', path),
  post:   (path, body)  => API.request('POST', path, body),
  put:    (path, body)  => API.request('PUT', path, body),
  delete: (path)        => API.request('DELETE', path),
  upload: (path, form)  => API.request('POST', path, form, true),

  // Auth
  auth: {
    register: (data)  => API.post('/auth/register', data),
    login:    (data)  => API.post('/auth/login', data),
    logout:   ()      => API.post('/auth/logout'),
    me:       ()      => API.get('/auth/me'),
  },

  // Documents
  docs: {
    list:    (params) => API.get(`/documents?${new URLSearchParams(params)}`),
    get:     (id)     => API.get(`/documents/${id}`),
    preview: (id)     => `/api/documents/${id}/preview`,
    page:    (id, p, code) => `/api/documents/${id}/page/${p}?code=${encodeURIComponent(code)}`,
    upload:  (form)   => API.upload('/documents', form),
    engage:  (id, data) => API.post(`/documents/${id}/engage`, data),
  },

  // Payments
  payments: {
    initiate:     (data) => API.post('/payments/initiate', data),
    status:       (id)   => API.get(`/payments/status/${id}`),
    myCodes:      ()     => API.get('/payments/my-codes'),
    validateCode: (data) => API.post('/payments/validate-code', data),
  },

  // Seller
  seller: {
    dashboard: () => API.get('/seller/dashboard'),
    documents: () => API.get('/seller/documents'),
    payouts:   () => API.get('/seller/payouts'),
    profile:   (data) => API.put('/seller/profile', data),
  },

  // Admin
  admin: {
    stats:           ()       => API.get('/admin/stats'),
    pendingSellers:  ()       => API.get('/admin/sellers/pending'),
    approveSeller:   (id)     => API.post(`/admin/sellers/${id}/approve`),
    rejectSeller:    (id, r)  => API.post(`/admin/sellers/${id}/reject`, { reason: r }),
    pendingDocs:     ()       => API.get('/admin/documents/pending'),
    approveDoc:      (id)     => API.post(`/admin/documents/${id}/approve`),
    rejectDoc:       (id, r)  => API.post(`/admin/documents/${id}/reject`, { reason: r }),
    pendingPayouts:  ()       => API.get('/admin/payouts/pending'),
    processPayout:   (id)     => API.post(`/admin/payouts/process/${id}`),
    allUsers:        ()       => API.get('/admin/users'),
    deleteUser:      (id)     => API.delete(`/admin/users/${id}`),
    restoreUser:     (id)     => API.post(`/admin/users/${id}/restore`),
    suspendSeller:   (id)     => API.post(`/admin/sellers/${id}/suspend`),
    allDocuments:    ()       => API.get('/admin/documents/all'),
    deleteDocument:  (id)     => API.delete(`/admin/documents/${id}`),
    restoreDocument: (id)     => API.post(`/admin/documents/${id}/restore`),
  },

  // Misc
  universities: ()    => API.get('/universities'),
  departments:  (id)  => API.get(`/universities/${id}/departments`),
  passes:       (id)  => API.get(`/universities/${id}/passes`),
  notifications: ()   => API.get('/notifications'),
  markNotifRead: (id) => API.put(`/notifications/${id}/read`),
};
