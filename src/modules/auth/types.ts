export interface User {
  id: string;
  companyId?: string;
  username: string;
  email?: string;
  fullName?: string;
  phone?: string;
  photoUrl?: string;
  role: 'super_admin' | 'admin' | 'manager' | 'accountant' | 'sales_rep' | 'viewer' | string;
  roleId?: string;
  branchId?: string | null;
  branchName?: string;
  isActive: boolean;
  passwordHash?: string;
  lastLoginAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Role {
  id: string;
  companyId?: string;
  name: string;
  description?: string;
  permissions: Permission[];
  isSystem?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuditLog {
  id: string;
  companyId?: string;
  userId: string;
  username: string;
  action: 'create' | 'update' | 'delete' | 'post' | 'cancel' | 'login' | 'logout' | 'reset_password' | 'toggle_active';
  tableName: string;
  recordId: string;
  recordLabel?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

export type Permission =
  // Wildcard
  | '*'
  // Core
  | 'core.view' | 'core.edit'
  // Accounting
  | 'accounting.view' | 'accounting.create' | 'accounting.edit' | 'accounting.delete' | 'accounting.post' | 'accounting.own'
  // Inventory
  | 'inventory.view' | 'inventory.create' | 'inventory.edit' | 'inventory.delete' | 'inventory.own'
  // Sales
  | 'sales.view' | 'sales.create' | 'sales.edit' | 'sales.delete' | 'sales.post' | 'sales.own'
  // Purchases
  | 'purchases.view' | 'purchases.create' | 'purchases.edit' | 'purchases.delete' | 'purchases.own'
  // Manufacturing
  | 'manufacturing.view' | 'manufacturing.create' | 'manufacturing.edit' | 'manufacturing.delete' | 'manufacturing.post' | 'manufacturing.own'
  // HR
  | 'hr.view' | 'hr.create' | 'hr.edit' | 'hr.delete' | 'hr.own'
  // CRM
  | 'crm.view' | 'crm.create' | 'crm.edit' | 'crm.delete' | 'crm.own'
  // Reports
  | 'reports.view' | 'reports.export' | 'reports.custom'
  // Settings
  | 'settings.view' | 'settings.edit' | 'settings.users' | 'settings.roles' | 'settings.audit_log'
  // AI Harness
  | 'ai.use' | 'ai.settings';

export interface LoginCredentials {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface UserFilters {
  search?: string;
  role?: string;
  branchId?: string;
  isActive?: boolean;
}

export interface RoleFilters {
  search?: string;
}

export interface AuditLogFilters {
  userId?: string;
  tableName?: string;
  action?: string;
  fromDate?: string;
  toDate?: string;
}

export const ALL_PERMISSIONS: Permission[] = [
  'core.view', 'core.edit',
  'accounting.view', 'accounting.create', 'accounting.edit', 'accounting.delete', 'accounting.post', 'accounting.own',
  'inventory.view', 'inventory.create', 'inventory.edit', 'inventory.delete', 'inventory.own',
  'sales.view', 'sales.create', 'sales.edit', 'sales.delete', 'sales.post', 'sales.own',
  'purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete', 'purchases.own',
  'manufacturing.view', 'manufacturing.create', 'manufacturing.edit', 'manufacturing.delete', 'manufacturing.post', 'manufacturing.own',
  'hr.view', 'hr.create', 'hr.edit', 'hr.delete', 'hr.own',
  'crm.view', 'crm.create', 'crm.edit', 'crm.delete', 'crm.own',
  'reports.view', 'reports.export', 'reports.custom',
  'settings.view', 'settings.edit', 'settings.users', 'settings.roles', 'settings.audit_log',
  'ai.use', 'ai.settings',
];

export const PERMISSION_GROUPS = [
  {
    module: 'core',
    labelAr: 'النظام',
    labelEn: 'Core',
    permissions: [
      { key: 'core.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'core.edit', labelAr: 'تعديل', labelEn: 'Edit' },
    ],
  },
  {
    module: 'accounting',
    labelAr: 'الحسابات',
    labelEn: 'Accounting',
    permissions: [
      { key: 'accounting.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'accounting.own', labelAr: 'مستنداتي فقط', labelEn: 'Own Only' },
      { key: 'accounting.create', labelAr: 'إنشاء', labelEn: 'Create' },
      { key: 'accounting.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'accounting.delete', labelAr: 'حذف', labelEn: 'Delete' },
      { key: 'accounting.post', labelAr: 'ترحيل', labelEn: 'Post' },
    ],
  },
  {
    module: 'inventory',
    labelAr: 'المخازن',
    labelEn: 'Inventory',
    permissions: [
      { key: 'inventory.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'inventory.own', labelAr: 'مستنداتي فقط', labelEn: 'Own Only' },
      { key: 'inventory.create', labelAr: 'إنشاء', labelEn: 'Create' },
      { key: 'inventory.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'inventory.delete', labelAr: 'حذف', labelEn: 'Delete' },
    ],
  },
  {
    module: 'sales',
    labelAr: 'المبيعات',
    labelEn: 'Sales',
    permissions: [
      { key: 'sales.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'sales.own', labelAr: 'مستنداتي فقط', labelEn: 'Own Only' },
      { key: 'sales.create', labelAr: 'إنشاء', labelEn: 'Create' },
      { key: 'sales.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'sales.delete', labelAr: 'حذف', labelEn: 'Delete' },
      { key: 'sales.post', labelAr: 'ترحيل', labelEn: 'Post' },
    ],
  },
  {
    module: 'purchases',
    labelAr: 'المشتريات',
    labelEn: 'Purchases',
    permissions: [
      { key: 'purchases.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'purchases.own', labelAr: 'مستنداتي فقط', labelEn: 'Own Only' },
      { key: 'purchases.create', labelAr: 'إنشاء', labelEn: 'Create' },
      { key: 'purchases.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'purchases.delete', labelAr: 'حذف', labelEn: 'Delete' },
    ],
  },
  {
    module: 'manufacturing',
    labelAr: 'التصنيع',
    labelEn: 'Manufacturing',
    permissions: [
      { key: 'manufacturing.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'manufacturing.own', labelAr: 'مستنداتي فقط', labelEn: 'Own Only' },
      { key: 'manufacturing.create', labelAr: 'إنشاء', labelEn: 'Create' },
      { key: 'manufacturing.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'manufacturing.delete', labelAr: 'حذف', labelEn: 'Delete' },
      { key: 'manufacturing.post', labelAr: 'ترحيل', labelEn: 'Post' },
    ],
  },
  {
    module: 'hr',
    labelAr: 'الموارد البشرية',
    labelEn: 'HR',
    permissions: [
      { key: 'hr.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'hr.own', labelAr: 'مستنداتي فقط', labelEn: 'Own Only' },
      { key: 'hr.create', labelAr: 'إنشاء', labelEn: 'Create' },
      { key: 'hr.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'hr.delete', labelAr: 'حذف', labelEn: 'Delete' },
    ],
  },
  {
    module: 'crm',
    labelAr: 'علاقات العملاء',
    labelEn: 'CRM',
    permissions: [
      { key: 'crm.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'crm.own', labelAr: 'مستنداتي فقط', labelEn: 'Own Only' },
      { key: 'crm.create', labelAr: 'إنشاء', labelEn: 'Create' },
      { key: 'crm.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'crm.delete', labelAr: 'حذف', labelEn: 'Delete' },
    ],
  },
  {
    module: 'reports',
    labelAr: 'التقارير',
    labelEn: 'Reports',
    permissions: [
      { key: 'reports.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'reports.export', labelAr: 'تصدير', labelEn: 'Export' },
      { key: 'reports.custom', labelAr: 'تقارير مخصصة', labelEn: 'Custom' },
    ],
  },
  {
    module: 'settings',
    labelAr: 'الإعدادات',
    labelEn: 'Settings',
    permissions: [
      { key: 'settings.view', labelAr: 'عرض', labelEn: 'View' },
      { key: 'settings.edit', labelAr: 'تعديل', labelEn: 'Edit' },
      { key: 'settings.users', labelAr: 'المستخدمين', labelEn: 'Users' },
      { key: 'settings.roles', labelAr: 'الأدوار', labelEn: 'Roles' },
      { key: 'settings.audit_log', labelAr: 'سجل العمليات', labelEn: 'Audit Log' },
    ],
  },
  {
    module: 'ai',
    labelAr: 'المساعد الذكي',
    labelEn: 'AI Assistant',
    permissions: [
      { key: 'ai.use', labelAr: 'استخدام', labelEn: 'Use' },
      { key: 'ai.settings', labelAr: 'إعدادات', labelEn: 'Settings' },
    ],
  },
];
