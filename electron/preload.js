import { contextBridge, ipcRenderer } from 'electron';

// Kept in the isolated preload world; the renderer never receives this token.
let sessionToken = null;

contextBridge.exposeInMainWorld('electronAuth', {
  login: async (credentials) => {
    const result = await ipcRenderer.invoke('auth:login', credentials);
    if (result?.success && result.sessionToken) {
      sessionToken = result.sessionToken;
      delete result.sessionToken;
    }
    return result;
  },
  getSession: () => ipcRenderer.invoke('auth:get-session', { sessionToken }),
  logout: async () => {
    const result = await ipcRenderer.invoke('auth:logout', { sessionToken });
    sessionToken = null;
    return result;
  },
  listUsers: () => ipcRenderer.invoke('auth:list-users', { sessionToken }),
  createUser: (data) => ipcRenderer.invoke('auth:create-user', { sessionToken, data }),
  updateUser: (id, data) => ipcRenderer.invoke('auth:update-user', { sessionToken, id, data }),
  resetPassword: (id, password) => ipcRenderer.invoke('auth:reset-password', { sessionToken, id, password }),
  deleteUser: (id) => ipcRenderer.invoke('auth:delete-user', { sessionToken, id }),
  listRoles: () => ipcRenderer.invoke('auth:list-roles', { sessionToken }),
  createRole: (data) => ipcRenderer.invoke('auth:create-role', { sessionToken, data }),
  updateRole: (id, data) => ipcRenderer.invoke('auth:update-role', { sessionToken, id, data }),
  deleteRole: (id) => ipcRenderer.invoke('auth:delete-role', { sessionToken, id }),
  getAuditLogs: (filters) => ipcRenderer.invoke('auth:get-audit-logs', { sessionToken, filters }),
});

// ─── PostgreSQL via Drizzle ORM (IPC Bridge) ─────────────────────────────────
contextBridge.exposeInMainWorld('electronDB', {
  ping: () => ipcRenderer.invoke('db:ping'),
  _exec: (sql, params = []) => ipcRenderer.invoke('db:internal-query', { sql, params, sessionToken }),
  _execBatch: (queries) => ipcRenderer.invoke('db:internal-transaction', { queries, sessionToken }),
  testConnection: (config) => ipcRenderer.invoke('db:test-connection', config),
  updateConfig: (config) => ipcRenderer.invoke('db:update-config', config),
  seedDefault: (adminPassword) => ipcRenderer.invoke('db:seed-default', { sessionToken, adminPassword }),
  seedDemo: (adminPassword) => ipcRenderer.invoke('db:seed-demo', { sessionToken, adminPassword }),
  clearAll: (payload) => ipcRenderer.invoke('db:clear-all', { ...(payload || {}), sessionToken }),
  getDbInfo: () => ipcRenderer.invoke('db:info'),

  // ── Typed RPC surface (Phase 4) ─────────────────────────────────────
  accounting: {
    getAccounts: (payload) => ipcRenderer.invoke('db:rpc:accounting.getAccounts', { ...payload, sessionToken }),
    createAccount: (payload) => ipcRenderer.invoke('db:rpc:accounting.createAccount', { ...payload, sessionToken }),
    getTransactions: (payload) => ipcRenderer.invoke('db:rpc:accounting.getTransactions', { ...payload, sessionToken }),
    createTransaction: (payload) => ipcRenderer.invoke('db:rpc:accounting.createTransaction', { ...payload, sessionToken }),
  },
  inventory: {
    getProducts: (payload) => ipcRenderer.invoke('db:rpc:inventory.getProducts', { ...payload, sessionToken }),
    createProduct: (payload) => ipcRenderer.invoke('db:rpc:inventory.createProduct', { ...payload, sessionToken }),
    createProductCategories: (payload) => ipcRenderer.invoke('db:rpc:inventory.createProductCategories', { ...payload, sessionToken }),
  },
  contacts: {
    getCustomers: (payload) => ipcRenderer.invoke('db:rpc:contacts.getCustomers', { ...payload, sessionToken }),
    getSuppliers: (payload) => ipcRenderer.invoke('db:rpc:contacts.getSuppliers', { ...payload, sessionToken }),
    createCustomer: (payload) => ipcRenderer.invoke('db:rpc:contacts.createCustomer', { ...payload, sessionToken }),
    createSupplier: (payload) => ipcRenderer.invoke('db:rpc:contacts.createSupplier', { ...payload, sessionToken }),
  },
  // Session-derived company scoping (Phase 4 slice 3). The renderer sends
  // no company id — the main process uses the authenticated session.
  core: {
    getCompany: (payload = {}) => ipcRenderer.invoke('db:rpc:core.getCompany', { ...payload, sessionToken }),
    updateCompany: (payload) => ipcRenderer.invoke('db:rpc:core.updateCompany', { ...payload, sessionToken }),
  },
});

// ─── AI Harness (LLM proxy — API key stays in main process) ─────────────────
// Every AI channel is authenticated server-side; the session token proves the
// caller's identity so the main process can derive companyId/userId itself.
contextBridge.exposeInMainWorld('electronAI', {
  getConfig: () => ipcRenderer.invoke('ai:get-config', { sessionToken }),
  saveConfig: (payload) => ipcRenderer.invoke('ai:save-config', { ...payload, sessionToken }),
  testConnection: (payload) => ipcRenderer.invoke('ai:test-connection', { ...payload, sessionToken }),
  complete: (payload) => ipcRenderer.invoke('ai:complete', { ...payload, sessionToken }),
  // Push-based streaming — start the stream, then listen for chunks and done events
  startStream: (payload) => ipcRenderer.send('ai:start-stream', { ...payload, sessionToken }),
  onStreamChunk: (callback) => ipcRenderer.on('ai:stream-chunk', (_event, chunk) => callback(chunk)),
  onStreamDone: (callback) => ipcRenderer.on('ai:stream-done', (_event, result) => callback(result)),
  removeStreamListeners: () => {
    ipcRenderer.removeAllListeners('ai:stream-chunk');
    ipcRenderer.removeAllListeners('ai:stream-done');
  },
  listSessions: () => ipcRenderer.invoke('ai:list-sessions', { sessionToken }),
  getSessionMessages: (payload) => ipcRenderer.invoke('ai:get-session-messages', { ...payload, sessionToken }),
  saveSession: (payload) => ipcRenderer.invoke('ai:save-session', { ...payload, sessionToken }),
  deleteSession: (payload) => ipcRenderer.invoke('ai:delete-session', { ...payload, sessionToken }),
});

// ─── App Environment Info ─────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronEnv', {
  isElectron: true,
  platform: process.platform,
});
