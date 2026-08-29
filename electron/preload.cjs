const { contextBridge, ipcRenderer } = require('electron');

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

// ─── Secure PostgreSQL Interface (Business-Safe Operations Only) ─────────────
// Security Note: Raw SQL execution is removed from renderer access.
// Only predefined business operations are exposed through specific methods.
contextBridge.exposeInMainWorld('electronDB', {
  ping: () => ipcRenderer.invoke('db:ping'),
  testConnection: (config) => ipcRenderer.invoke('db:test-connection', config, sessionToken),
  updateConfig: (config) => ipcRenderer.invoke('db:update-config', config, sessionToken),
  seedDefault: (adminPassword) => ipcRenderer.invoke('db:seed-default', { sessionToken, adminPassword }),
  seedDemo: (adminPassword) => ipcRenderer.invoke('db:seed-demo', { sessionToken, adminPassword }),
  clearAll: (payload) => ipcRenderer.invoke('db:clear-all', { ...(payload || {}), sessionToken }),
  getDbInfo: () => ipcRenderer.invoke('db:info'),
  
  // Internal use only - NOT for direct renderer access
  // These methods are used by the adapter layer which implements business logic
  _exec: (sql, params = []) => ipcRenderer.invoke('db:internal-query', { sql, params, sessionToken }),
  _execBatch: (queries) => ipcRenderer.invoke('db:internal-transaction', { queries, sessionToken }),

  // ── Typed RPC surface (Phase 4) ─────────────────────────────────────
  // Preferred over `_exec`. The renderer sends structured payloads — the
  // main process composes and authorizes the SQL. Each method is bound
  // to a fixed SQL statement and reuses the same auth/RBAC surface.
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
  // Phase 4 slice 7 — CRM typed RPC. Session-derived companyId; the
  // renderer payload carries only the editable fields + filters.
  crm: {
    getLeads: (payload) => ipcRenderer.invoke('db:rpc:crm.getLeads', { ...payload, sessionToken }),
    getLeadsPaginated: (payload) => ipcRenderer.invoke('db:rpc:crm.getLeadsPaginated', { ...payload, sessionToken }),
    getLeadById: (payload) => ipcRenderer.invoke('db:rpc:crm.getLeadById', { ...payload, sessionToken }),
    createLead: (payload) => ipcRenderer.invoke('db:rpc:crm.createLead', { ...payload, sessionToken }),
    updateLead: (payload) => ipcRenderer.invoke('db:rpc:crm.updateLead', { ...payload, sessionToken }),
    deleteLead: (payload) => ipcRenderer.invoke('db:rpc:crm.deleteLead', { ...payload, sessionToken }),
    convertLeadToCustomer: (payload) => ipcRenderer.invoke('db:rpc:crm.convertLeadToCustomer', { ...payload, sessionToken }),
    getOpportunities: (payload) => ipcRenderer.invoke('db:rpc:crm.getOpportunities', { ...payload, sessionToken }),
    getOpportunitiesPaginated: (payload) => ipcRenderer.invoke('db:rpc:crm.getOpportunitiesPaginated', { ...payload, sessionToken }),
    createOpportunity: (payload) => ipcRenderer.invoke('db:rpc:crm.createOpportunity', { ...payload, sessionToken }),
    updateOpportunity: (payload) => ipcRenderer.invoke('db:rpc:crm.updateOpportunity', { ...payload, sessionToken }),
    deleteOpportunity: (payload) => ipcRenderer.invoke('db:rpc:crm.deleteOpportunity', { ...payload, sessionToken }),
    getTasks: (payload) => ipcRenderer.invoke('db:rpc:crm.getTasks', { ...payload, sessionToken }),
    getTasksPaginated: (payload) => ipcRenderer.invoke('db:rpc:crm.getTasksPaginated', { ...payload, sessionToken }),
    createTask: (payload) => ipcRenderer.invoke('db:rpc:crm.createTask', { ...payload, sessionToken }),
    updateTask: (payload) => ipcRenderer.invoke('db:rpc:crm.updateTask', { ...payload, sessionToken }),
    deleteTask: (payload) => ipcRenderer.invoke('db:rpc:crm.deleteTask', { ...payload, sessionToken }),
    getActivities: (payload) => ipcRenderer.invoke('db:rpc:crm.getActivities', { ...payload, sessionToken }),
    getActivitiesPaginated: (payload) => ipcRenderer.invoke('db:rpc:crm.getActivitiesPaginated', { ...payload, sessionToken }),
    createActivity: (payload) => ipcRenderer.invoke('db:rpc:crm.createActivity', { ...payload, sessionToken }),
    updateActivity: (payload) => ipcRenderer.invoke('db:rpc:crm.updateActivity', { ...payload, sessionToken }),
    deleteActivity: (payload) => ipcRenderer.invoke('db:rpc:crm.deleteActivity', { ...payload, sessionToken }),
  },
  // Phase 4 slice 8 — Manufacturing typed RPC. Session-derived companyId +
  // audit userId; the renderer payload carries only editable fields + filters.
  // updateBom / updateWorkOrder use a transaction-wrapped payload ({ data }).
  manufacturing: {
    getBoms: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.getBoms', { ...payload, sessionToken }),
    getBomsPaginated: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.getBomsPaginated', { ...payload, sessionToken }),
    getBomById: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.getBomById', { ...payload, sessionToken }),
    createBom: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.createBom', { ...payload, sessionToken }),
    updateBom: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.updateBom', { ...payload, sessionToken }),
    deleteBom: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.deleteBom', { ...payload, sessionToken }),
    getWorkOrders: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.getWorkOrders', { ...payload, sessionToken }),
    getWorkOrdersPaginated: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.getWorkOrdersPaginated', { ...payload, sessionToken }),
    getWorkOrderById: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.getWorkOrderById', { ...payload, sessionToken }),
    createWorkOrder: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.createWorkOrder', { ...payload, sessionToken }),
    updateWorkOrder: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.updateWorkOrder', { ...payload, sessionToken }),
    deleteWorkOrder: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.deleteWorkOrder', { ...payload, sessionToken }),
    batchUpdateConsumptions: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.batchUpdateConsumptions', { ...payload, sessionToken }),
    updateConsumption: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.updateConsumption', { ...payload, sessionToken }),
    getManufacturingKpis: (payload) => ipcRenderer.invoke('db:rpc:manufacturing.getManufacturingKpis', { ...payload, sessionToken }),
  },
  // Phase 4 slice 9 — HR typed RPC. Session-derived companyId + audit
  // userId; `saveAttendance` is a custom transaction handler (no
  // UNIQUE(employee_id, date) on attendance so fetch-then-upsert is
  // required). UPDATE SQL omits `updated_at` for attendance / leaves /
  // payroll_runs where the live schema lacks the column.
  hr: {
    getEmployees: (payload) => ipcRenderer.invoke('db:rpc:hr.getEmployees', { ...payload, sessionToken }),
    getEmployeesPaginated: (payload) => ipcRenderer.invoke('db:rpc:hr.getEmployeesPaginated', { ...payload, sessionToken }),
    getEmployeeById: (payload) => ipcRenderer.invoke('db:rpc:hr.getEmployeeById', { ...payload, sessionToken }),
    createEmployee: (payload) => ipcRenderer.invoke('db:rpc:hr.createEmployee', { ...payload, sessionToken }),
    updateEmployee: (payload) => ipcRenderer.invoke('db:rpc:hr.updateEmployee', { ...payload, sessionToken }),
    deleteEmployee: (payload) => ipcRenderer.invoke('db:rpc:hr.deleteEmployee', { ...payload, sessionToken }),
    getAttendance: (payload) => ipcRenderer.invoke('db:rpc:hr.getAttendance', { ...payload, sessionToken }),
    saveAttendance: (payload) => ipcRenderer.invoke('db:rpc:hr.saveAttendance', { ...payload, sessionToken }),
    getPayrollRuns: (payload) => ipcRenderer.invoke('db:rpc:hr.getPayrollRuns', { ...payload, sessionToken }),
    getPayrollRunsPaginated: (payload) => ipcRenderer.invoke('db:rpc:hr.getPayrollRunsPaginated', { ...payload, sessionToken }),
    createPayrollRun: (payload) => ipcRenderer.invoke('db:rpc:hr.createPayrollRun', { ...payload, sessionToken }),
    postPayrollRun: (payload) => ipcRenderer.invoke('db:rpc:hr.postPayrollRun', { ...payload, sessionToken }),
    getLeaves: (payload) => ipcRenderer.invoke('db:rpc:hr.getLeaves', { ...payload, sessionToken }),
    getLeavesPaginated: (payload) => ipcRenderer.invoke('db:rpc:hr.getLeavesPaginated', { ...payload, sessionToken }),
    createLeave: (payload) => ipcRenderer.invoke('db:rpc:hr.createLeave', { ...payload, sessionToken }),
    updateLeaveStatus: (payload) => ipcRenderer.invoke('db:rpc:hr.updateLeaveStatus', { ...payload, sessionToken }),
    deleteLeave: (payload) => ipcRenderer.invoke('db:rpc:hr.deleteLeave', { ...payload, sessionToken }),
    getEndOfServices: (payload) => ipcRenderer.invoke('db:rpc:hr.getEndOfServices', { ...payload, sessionToken }),
    getEndOfServicesPaginated: (payload) => ipcRenderer.invoke('db:rpc:hr.getEndOfServicesPaginated', { ...payload, sessionToken }),
    createEndOfService: (payload) => ipcRenderer.invoke('db:rpc:hr.createEndOfService', { ...payload, sessionToken }),
    updateEndOfServiceStatus: (payload) => ipcRenderer.invoke('db:rpc:hr.updateEndOfServiceStatus', { ...payload, sessionToken }),
    deleteEndOfService: (payload) => ipcRenderer.invoke('db:rpc:hr.deleteEndOfService', { ...payload, sessionToken }),
    getHrKpis: (payload) => ipcRenderer.invoke('db:rpc:hr.getHrKpis', { ...payload, sessionToken }),
  },
  // Phase 4 slice 10 — Sales typed RPC. Session-derived companyId + audit
  // userId; updateInvoice / updateQuotation / updateReturn are
  // transaction-wrapped payloads ({ data }). Delete/post ops use guarded CTEs.
  sales: {
    getCustomers: (payload) => ipcRenderer.invoke('db:rpc:sales.getCustomers', { ...payload, sessionToken }),
    getCustomersPaginated: (payload) => ipcRenderer.invoke('db:rpc:sales.getCustomersPaginated', { ...payload, sessionToken }),
    getCustomerById: (payload) => ipcRenderer.invoke('db:rpc:sales.getCustomerById', { ...payload, sessionToken }),
    createCustomer: (payload) => ipcRenderer.invoke('db:rpc:sales.createCustomer', { ...payload, sessionToken }),
    updateCustomer: (payload) => ipcRenderer.invoke('db:rpc:sales.updateCustomer', { ...payload, sessionToken }),
    deleteCustomer: (payload) => ipcRenderer.invoke('db:rpc:sales.deleteCustomer', { ...payload, sessionToken }),
    getCustomerStatement: (payload) => ipcRenderer.invoke('db:rpc:sales.getCustomerStatement', { ...payload, sessionToken }),
    getCustomerArAging: (payload) => ipcRenderer.invoke('db:rpc:sales.getCustomerArAging', { ...payload, sessionToken }),
    getInvoices: (payload) => ipcRenderer.invoke('db:rpc:sales.getInvoices', { ...payload, sessionToken }),
    getOutstandingInvoicesForCustomer: (payload) => ipcRenderer.invoke('db:rpc:sales.getOutstandingInvoicesForCustomer', { ...payload, sessionToken }),
    getPostedInvoicesWithLines: (payload) => ipcRenderer.invoke('db:rpc:sales.getPostedInvoicesWithLines', { ...payload, sessionToken }),
    getInvoicesPaginated: (payload) => ipcRenderer.invoke('db:rpc:sales.getInvoicesPaginated', { ...payload, sessionToken }),
    getInvoiceById: (payload) => ipcRenderer.invoke('db:rpc:sales.getInvoiceById', { ...payload, sessionToken }),
    createInvoice: (payload) => ipcRenderer.invoke('db:rpc:sales.createInvoice', { ...payload, sessionToken }),
    updateInvoice: (payload) => ipcRenderer.invoke('db:rpc:sales.updateInvoice', { ...payload, sessionToken }),
    deleteInvoice: (payload) => ipcRenderer.invoke('db:rpc:sales.deleteInvoice', { ...payload, sessionToken }),
    postInvoice: (payload) => ipcRenderer.invoke('db:rpc:sales.postInvoice', { ...payload, sessionToken }),
    getQuotations: (payload) => ipcRenderer.invoke('db:rpc:sales.getQuotations', { ...payload, sessionToken }),
    getQuotationsPaginated: (payload) => ipcRenderer.invoke('db:rpc:sales.getQuotationsPaginated', { ...payload, sessionToken }),
    getQuotationById: (payload) => ipcRenderer.invoke('db:rpc:sales.getQuotationById', { ...payload, sessionToken }),
    createQuotation: (payload) => ipcRenderer.invoke('db:rpc:sales.createQuotation', { ...payload, sessionToken }),
    updateQuotation: (payload) => ipcRenderer.invoke('db:rpc:sales.updateQuotation', { ...payload, sessionToken }),
    deleteQuotation: (payload) => ipcRenderer.invoke('db:rpc:sales.deleteQuotation', { ...payload, sessionToken }),
    getReturns: (payload) => ipcRenderer.invoke('db:rpc:sales.getReturns', { ...payload, sessionToken }),
    getReturnsPaginated: (payload) => ipcRenderer.invoke('db:rpc:sales.getReturnsPaginated', { ...payload, sessionToken }),
    getReturnById: (payload) => ipcRenderer.invoke('db:rpc:sales.getReturnById', { ...payload, sessionToken }),
    createReturn: (payload) => ipcRenderer.invoke('db:rpc:sales.createReturn', { ...payload, sessionToken }),
    updateReturn: (payload) => ipcRenderer.invoke('db:rpc:sales.updateReturn', { ...payload, sessionToken }),
    deleteReturn: (payload) => ipcRenderer.invoke('db:rpc:sales.deleteReturn', { ...payload, sessionToken }),
    postReturn: (payload) => ipcRenderer.invoke('db:rpc:sales.postReturn', { ...payload, sessionToken }),
  },
  // Session-derived company scoping (Phase 4 slice 3). The renderer sends
  // no company id — the main process uses the authenticated session.
  core: {
    getCompany: (payload = {}) => ipcRenderer.invoke('db:rpc:core.getCompany', { ...payload, sessionToken }),
    updateCompany: (payload) => ipcRenderer.invoke('db:rpc:core.updateCompany', { ...payload, sessionToken }),
    getCurrencies: (payload = {}) => ipcRenderer.invoke('db:rpc:core.getCurrencies', { ...payload, sessionToken }),
    createCurrency: (payload) => ipcRenderer.invoke('db:rpc:core.createCurrency', { ...payload, sessionToken }),
    updateCurrency: (payload) => ipcRenderer.invoke('db:rpc:core.updateCurrency', { ...payload, sessionToken }),
    getVatSettings: (payload = {}) => ipcRenderer.invoke('db:rpc:core.getVatSettings', { ...payload, sessionToken }),
    updateVatSettings: (payload) => ipcRenderer.invoke('db:rpc:core.updateVatSettings', { ...payload, sessionToken }),
    getBranches: (payload = {}) => ipcRenderer.invoke('db:rpc:core.getBranches', { ...payload, sessionToken }),
    createBranch: (payload) => ipcRenderer.invoke('db:rpc:core.createBranch', { ...payload, sessionToken }),
    updateBranch: (payload) => ipcRenderer.invoke('db:rpc:core.updateBranch', { ...payload, sessionToken }),
    getSettings: (payload = {}) => ipcRenderer.invoke('db:rpc:core.getSettings', { ...payload, sessionToken }),
    setSetting: (payload) => ipcRenderer.invoke('db:rpc:core.setSetting', { ...payload, sessionToken }),
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
  renameSession: (payload) => ipcRenderer.invoke('ai:rename-session', { ...payload, sessionToken }),
  deleteSession: (payload) => ipcRenderer.invoke('ai:delete-session', { ...payload, sessionToken }),
});

// ─── App Environment Info ─────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronEnv', {
  isElectron: true,
  platform: process.platform,
});
