# خطة الوحدة: المستخدمين والصلاحيات (Auth)

> **الهدف:** بناء نظام إدارة المستخدمين والأدوار والصلاحيات (RBAC) متكامل.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Auth |
| **المجلد** | `src/modules/auth/` |
| **التبعيات** | Core |
| **المدة** | أسبوع واحد (المرحلة 1) |
| **الأولوية** | عالية |

---

## 2. المتطلبات الوظيفية

### 2.1 تسجيل الدخول
- صفحة تسجيل دخول (Login Page).
- التحقق من صحة البيانات.
- تذكر الجلسة (Remember Me).
- تسجيل الخروج (Logout).

### 2.2 إدارة المستخدمين
- إنشاء/تعديل/حذف مستخدم.
- تعيين الدور (Role).
- تفعيل/تعطيل حساب.
- إعادة تعيين كلمة المرور.

### 2.3 نظام الأدوار (Roles)
- **Super Admin:** صلاحيات كاملة.
- **Manager:** كل شيء ما عدا حذف الشركة.
- **Accountant:** الحسابات، المبيعات، المشتريات، المخازن.
- **Sales Rep:** المبيعات + CRM فقط.
- **HR Admin:** الموظفين + الرواتب.
- **Viewer:** قراءة فقط.

### 2.4 الصلاحيات (Permissions)
- صلاحيات على مستوى الوظائف (Feature-level).
- صلاحيات على مستوى البيانات (Data-level) — مستقبلي.
- التحقق من الصلاحيات قبل كل عملية حساسة.

---

## 3. هيكل الملفات

```
src/modules/auth/
├── index.ts
├── types.ts
│
├── api/
│   ├── index.ts
│   ├── queries.ts
│   ├── mutations.ts
│   └── types.ts
│
├── components/
│   ├── LoginPage.tsx
│   ├── UserList.tsx
│   ├── UserForm.tsx
│   ├── RoleManager.tsx
│   └── index.ts
│
├── hooks/
│   ├── useAuth.ts
│   ├── useUsers.ts
│   ├── usePermissions.ts
│   └── index.ts
│
├── store/
│   └── authSlice.ts
│
└── utils/
    ├── passwordHash.ts
    ├── tokenManager.ts
    └── permissionCheck.ts
```

---

## 4. قاعدة البيانات (Schema)

```ts
// core/database/schema/auth.ts

// المستخدمين
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  username: varchar('username', { length: 100 }).notNull().unique(),
  email: varchar('email', { length: 255 }),
  passwordHash: text('password_hash').notNull(),
  fullName: varchar('full_name', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).default('accountant').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// الجلسات
export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// الأدوار المخصصة (مستقبلي)
export const customRoles = pgTable('custom_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  permissions: json('permissions').notNull(), // { module: { action: boolean } }
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

---

## 5. المكونات (Components)

### 5.1 صفحة تسجيل الدخول

```tsx
// LoginPage.tsx
export const LoginPage = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const { login, isLoading, error } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await login(username, password, rememberMe);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900">
      <div className="w-full max-w-md p-8 bg-white dark:bg-slate-800 rounded-xl shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-8">maghzaccount-pro</h1>
        <form onSubmit={handleSubmit}>
          {/* Username, Password, Remember Me, Submit */}
        </form>
      </div>
    </div>
  );
};
```

### 5.2 قائمة المستخدمين

```tsx
// UserList.tsx
export const UserList = () => {
  const { users, isLoading } = useUsers();
  const { hasPermission } = usePermissions();

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <h1>المستخدمين</h1>
        {hasPermission('users', 'create') && <Button>إضافة مستخدم</Button>}
      </div>
      <DataTable data={users} columns={columns} />
    </div>
  );
};
```

---

## 6. API / Adapters

### 6.1 Queries

```ts
// api/queries.ts
export const authQueries = {
  getUsers: async (companyId: string): Promise<User[]> => {
    return db.select().from(users).where(eq(users.companyId, companyId));
  },

  getUserById: async (id: string): Promise<User | null> => {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0] || null;
  },

  validateLogin: async (username: string, password: string): Promise<User | null> => {
    const result = await db.select().from(users).where(eq(users.username, username));
    if (result[0] && await verifyPassword(password, result[0].passwordHash)) {
      return result[0];
    }
    return null;
  },
};
```

### 6.2 Mutations

```ts
// api/mutations.ts
export const authMutations = {
  createUser: async (data: CreateUserDto): Promise<User> => {
    const hashedPassword = await hashPassword(data.password);
    return db.insert(users).values({ ...data, passwordHash: hashedPassword }).returning();
  },

  updateUser: async (id: string, data: UpdateUserDto): Promise<User> => {
    return db.update(users).set(data).where(eq(users.id, id)).returning();
  },

  deleteUser: async (id: string): Promise<void> => {
    await db.delete(users).where(eq(users.id, id));
  },

  updateLastLogin: async (userId: string): Promise<void> => {
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  },
};
```

---

## 7. نظام الصلاحيات (RBAC)

### 7.1 تعريف الصلاحيات

```ts
// types.ts
export type Permission = {
  module: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'export' | 'print';
};

export type Role = 'super_admin' | 'manager' | 'accountant' | 'sales_rep' | 'hr_admin' | 'viewer';

export const rolePermissions: Record<Role, Permission[]> = {
  super_admin: [
    { module: '*', action: '*' }, // كل شيء
  ],
  manager: [
    { module: '*', action: 'create' },
    { module: '*', action: 'read' },
    { module: '*', action: 'update' },
    { module: '*', action: 'delete' },
    { module: 'company', action: 'delete' }, // ممنوع
  ],
  accountant: [
    { module: 'accounts', action: '*' },
    { module: 'sales', action: '*' },
    { module: 'purchases', action: '*' },
    { module: 'inventory', action: '*' },
    { module: 'reports', action: 'read' },
  ],
  sales_rep: [
    { module: 'sales', action: '*' },
    { module: 'crm', action: '*' },
    { module: 'inventory', action: 'read' },
  ],
  hr_admin: [
    { module: 'hr', action: '*' },
    { module: 'reports', action: 'read' },
  ],
  viewer: [
    { module: '*', action: 'read' },
  ],
};
```

### 7.2 Hook للتحقق من الصلاحيات

```ts
// hooks/usePermissions.ts
export const usePermissions = () => {
  const user = useAppStore((state) => state.user);

  const hasPermission = (module: string, action: string): boolean => {
    if (!user) return false;
    
    const permissions = rolePermissions[user.role as Role];
    return permissions.some(
      (p) => (p.module === '*' || p.module === module) && 
             (p.action === '*' || p.action === action)
    );
  };

  const canCreate = (module: string) => hasPermission(module, 'create');
  const canRead = (module: string) => hasPermission(module, 'read');
  const canUpdate = (module: string) => hasPermission(module, 'update');
  const canDelete = (module: string) => hasPermission(module, 'delete');

  return { hasPermission, canCreate, canRead, canUpdate, canDelete };
};
```

---

## 8. تقسيم المهام

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | Schema (users, sessions) | 2 ساعة | عالية |
| 2 | صفحة تسجيل الدخول | 4 ساعات | عالية |
| 3 | API (queries, mutations) | 4 ساعات | عالية |
| 4 | نظام الأدوار والصلاحيات | 6 ساعات | عالية |
| 5 | قائمة المستخدمين | 3 ساعات | عالية |
| 6 | نموذج إضافة/تعديل مستخدم | 3 ساعات | متوسطة |
| 7 | اختبارات الوحدات | 4 ساعات | متوسطة |

---

## 9. معايير القبول

- [ ] صفحة تسجيل الدخول تعمل.
- [ ] إنشاء مستخدم جديد يعمل.
- [ ] تعديل مستخدم يعمل.
- [ ] حذف مستخدم يعمل (مع تأكيد).
- [ ] نظام الصلاحيات يتحقق من كل عملية.
- [ ] تسجيل الخروج يعمل.
- [ ] اختبارات الوحدات تمر.

---

## 10. المخرجات النهائية

1. **نظام تسجيل دخول** كامل.
2. **إدارة المستخدمين** CRUD.
3. **نظام أدوار** جاهز (6 أدوار).
4. **نظام صلاحيات** (RBAC).
5. **اختبارات** للمكونات والـ API.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Auth Module Lead*
