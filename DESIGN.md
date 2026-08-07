# وثائق التصميم UI/UX — maghzaccount-pro

> **الغرض:** يحدد هذا الملف فلسفة التصميم، ونظام الألوان، والطباعة، ومكونات الواجهة، والتفاعلات، وقواعد تجربة المستخدم (UX) التي يجب اتباعها عند بناء أي شاشة أو مكون جديد.

---

## 1. الفلسفة التصميمية

**"وضوح المحاسبة، ببساطة البرمجيات، بجمال التصميم"**

- **الوضوح:** يجب أن يكون المحتوى المحاسبي والمالي واضحاً وقابلاً للقراءة فوراً.
- **البساطة:** تجنب الزخرفة غير الضرورية. كل عنصر له وظيفة.
- **الثقة:** استخدم ألواناً هادئة (blue-slate) تعطي إحساساً بالاستقرار المالي والموثوقية.
- **الانسيابية:** انتقالات سلسة (smooth animations) تعكس احترافية النظام.
- **الراحة البصرية:** نظام ألوان مريح للعين مع دعم الوضع الفاتح والداكن.

---

## 2. الخطوط (Typography)

### 2.1 الخطوط المعتمدة (Google Fonts)

| اللغة | الخط | الأوزان | المصدر |
|-------|------|---------|--------|
| **العربية** | Cairo | 300, 400, 500, 600, 700 | fonts.google.com/spec/Cairo |
| **الإنجليزية** | Inter | 300, 400, 500, 600, 700 | fonts.google.com/spec/Inter |
| **الأرقام المالية** | Inter (tabular-nums) | 500, 600 | — |

### 2.2 تحميل الخطوط

```html
<!-- في index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
```

### 2.3 إعداد Tailwind CSS

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        'cairo': ['Cairo', 'sans-serif'],
        'inter': ['Inter', 'sans-serif'],
        'mono': ['"SF Mono"', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
}
```

### 2.4 نظام الطباعة

| العنصر | الخط | الحجم | الوزن | الارتفاع | الاستخدام |
|--------|------|-------|-------|----------|-----------|
| **H1** | Cairo / Inter | `2rem` (32px) | 700 | 1.2 | عناوين الصفحات الرئيسية |
| **H2** | Cairo / Inter | `1.5rem` (24px) | 600 | 1.3 | عناوين الأقسام |
| **H3** | Cairo / Inter | `1.25rem` (20px) | 600 | 1.4 | عناوين البطاقات |
| **Body** | Cairo / Inter | `0.875rem` (14px) | 400 | 1.6 | النصوص العادية |
| **Caption** | Cairo / Inter | `0.75rem` (12px) | 400 | 1.5 | التلميحات والتفاصيل |
| **Numbers** | Inter (tabular-nums) | `0.875rem` | 500 | 1.4 | الأرقام المالية |
| **KPI Value** | Inter (tabular-nums) | `2.5rem` (40px) | 700 | 1 | قيم Dashboard |

**قاعدة:** الأرقام المالية دائماً تستخدم `font-variant-numeric: tabular-nums` لتجنب اهتزاز الأرقام.

---

## 3. نظام الألوان (Color System)

### 3.1 الألوان الأساسية — Blue-Slate Theme

**الوضع الفاتح (Light Mode):**

| المتغير | القيمة | Tailwind | الاستخدام |
|---------|--------|----------|-----------|
| `--background` | `#ffffff` | `bg-white` | خلفية التطبيق |
| `--foreground` | `#0f172a` | `text-slate-900` | النصوص الرئيسية |
| `--foreground-muted` | `#64748b` | `text-slate-500` | النصوص الثانوية |
| `--primary` | `#2563eb` | `bg-blue-600` | الأزرار الرئيسية |
| `--primary-foreground` | `#ffffff` | `text-white` | النص فوق Primary |
| `--secondary` | `#f1f5f9` | `bg-slate-100` | الخلفيات الثانوية |
| `--accent` | `#3b82f6` | `bg-blue-500` | التحديدات |
| `--destructive` | `#ef4444` | `bg-rose-500` | الأخطاء والحذف |
| `--success` | `#10b981` | `bg-emerald-500` | النجاح والتأكيد |
| `--warning` | `#f59e0b` | `bg-amber-500` | التحذيرات |
| `--border` | `#e2e8f0` | `border-slate-200` | الحدود |
| `--ring` | `#2563eb` | `ring-blue-600` | حلقة التركيز |

**الوضع الداكن (Dark Mode):**

| المتغير | القيمة | Tailwind | الاستخدام |
|---------|--------|----------|-----------|
| `--background` | `#020617` | `bg-slate-950` | خلفية التطبيق |
| `--foreground` | `#f8fafc` | `text-slate-50` | النصوص الرئيسية |
| `--foreground-muted` | `#94a3b8` | `text-slate-400` | النصوص الثانوية |
| `--primary` | `#3b82f6` | `bg-blue-500` | الأزرار الرئيسية |
| `--secondary` | `#1e293b` | `bg-slate-800` | الخلفيات الثانوية |
| `--border` | `#334155` | `border-slate-700` | الحدود |

### 3.2 ألوان البيانات (Data Colors)

| النوع | اللون | Tailwind | الاستخدام |
|-------|-------|----------|-----------|
| **إيرادات/أصول** | `#10b981` | `text-emerald-500` | الأرباح، المبيعات |
| **مصروفات/التزامات** | `#ef4444` | `text-rose-500` | الخسائر، المصروفات |
| **محايد** | `#64748b` | `text-slate-500` | التوازن، التعادل |
| **معلومات** | `#3b82f6` | `text-blue-500` | التفاصيل، الملاحظات |

### 3.3 تفعيل Dark Mode

```tsx
// في App.tsx أو layout.tsx
useEffect(() => {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    document.documentElement.classList.add('dark');
  }
}, []);
```

```html
<!-- Tailwind dark mode -->
<html class="dark">
  <!-- المحتوى -->
</html>
```

---

## 4. مكونات التصميم (UI Components)

### 4.1 البطاقة (Card)

```tsx
// Tailwind classes
<div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
  {/* المحتوى */}
</div>
```

### 4.2 الزر (Button)

| النوع | Classes |
|-------|---------|
| **Primary** | `bg-blue-600 hover:bg-blue-700 text-white` |
| **Secondary** | `bg-slate-100 hover:bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100` |
| **Outline** | `border border-slate-300 hover:bg-slate-100 text-slate-700` |
| **Ghost** | `hover:bg-slate-100 text-slate-700` |
| **Destructive** | `bg-rose-500 hover:bg-rose-600 text-white` |
| **Success** | `bg-emerald-500 hover:bg-emerald-600 text-white` |

```tsx
// مثال
<button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
  حفظ
</button>
```

### 4.3 حقل الإدخال (Input)

```tsx
<input 
  className="h-10 px-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
  placeholder="أدخل القيمة"
/>
```

### 4.4 الجدول (Data Table)

```tsx
<table className="w-full">
  <thead className="bg-slate-100 dark:bg-slate-800">
    <tr>
      <th className="px-4 py-3 text-right font-semibold text-slate-700 dark:text-slate-200">العمود</th>
    </tr>
  </thead>
  <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">القيمة</td>
    </tr>
  </tbody>
</table>
```

### 4.5 KPI Card (Dashboard)

```tsx
<div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm text-slate-500 dark:text-slate-400">الإيرادات اليومية</p>
      <p className="text-4xl font-bold text-slate-900 dark:text-slate-50 mt-1 tabular-nums">
        ١٢٬٥٠٠
      </p>
      <p className="text-sm text-emerald-500 mt-1">+12% من أمس</p>
    </div>
    <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
      <TrendingUp className="w-6 h-6 text-blue-600 dark:text-blue-400" />
    </div>
  </div>
</div>
```

---

## 5. مكونات الرسوم البيانية (Charts)

### 5.1 المكتبات المستخدمة

| المكتبة | الاستخدام |
|---------|----------|
| **Recharts** | الرسوم البيانية الأساسية (Bar, Line, Pie, Area) |
| **@tremor/react** | مكونات Dashboard جاهزة (KpiCard, Chart components) |

### 5.2 ألوان الرسوم البيانية

```ts
// src/core/ui/tokens/chartColors.ts
export const chartColors = {
  primary: '#2563eb',    // blue-600
  secondary: '#64748b', // slate-500
  success: '#10b981',   // emerald-500
  danger: '#ef4444',    // rose-500
  warning: '#f59e0b',   // amber-500
  info: '#3b82f6',      // blue-500
};

export const chartPalette = [
  '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
];
```

### 5.3 أمثلة على المخططات

**مخطط أعمدة (Bar Chart):**
```tsx
<ResponsiveContainer width="100%" height={300}>
  <BarChart data={salesData}>
    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
    <XAxis dataKey="month" stroke="#64748b" />
    <YAxis stroke="#64748b" />
    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e2e8f0' }} />
    <Bar dataKey="revenue" fill="#2563eb" radius={[4, 4, 0, 0]} />
  </BarChart>
</ResponsiveContainer>
```

**مخطط خطي (Line Chart):**
```tsx
<ResponsiveContainer width="100%" height={300}>
  <LineChart data={revenueData}>
    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
    <XAxis dataKey="date" stroke="#64748b" />
    <YAxis stroke="#64748b" />
    <Tooltip />
    <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={false} />
  </LineChart>
</ResponsiveContainer>
```

**مخطط دائري (Pie Chart):**
```tsx
<ResponsiveContainer width="100%" height={300}>
  <PieChart>
    <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100}>
      {categoryData.map((_, index) => (
        <Cell key={index} fill={chartPalette[index % chartPalette.length]} />
      ))}
    </Pie>
    <Tooltip />
    <Legend />
  </PieChart>
</ResponsiveContainer>
```

---

## 6. التخطيط العام (Layout)

### 6.1 الهيكل الأساسي

```
┌─────────────────────────────────────────────────────────────┐
│  Sidebar (240px)  │  Header (64px)                          │
│                   ├─────────────────────────────────────────┤
│                   │  Breadcrumb (optional)                  │
│                   ├─────────────────────────────────────────┤
│                   │                                         │
│                   │    Content Viewport (flex-1)            │
│                   │    (scrollable, p-6)                    │
│                   │                                         │
└───────────────────┴─────────────────────────────────────────┘
```

### 6.2 Sidebar

```tsx
<aside className="w-60 bg-slate-900 dark:bg-slate-950 text-white flex flex-col">
  {/* Logo */}
  <div className="h-16 flex items-center px-4 border-b border-slate-700">
    <span className="text-xl font-bold">maghzaccount</span>
  </div>
  
  {/* Navigation */}
  <nav className="flex-1 p-4 space-y-1">
    {menuItems.map(item => (
      <button className="w-full flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors">
        <item.icon className="w-5 h-5" />
        <span>{item.label}</span>
      </button>
    ))}
  </nav>
  
  {/* User */}
  <div className="p-4 border-t border-slate-700">
    {/* معلومات المستخدم */}
  </div>
</aside>
```

### 6.3 Header

```tsx
<header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center px-6">
  <div className="flex items-center gap-4">
    <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
      {pageTitle}
    </h1>
  </div>
  
  <div className="mr-auto flex items-center gap-4">
    {/* البحث */}
    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
      <Search className="w-5 h-5 text-slate-500" />
    </button>
    
    {/* تبديل اللغة */}
    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
      <Globe className="w-5 h-5 text-slate-500" />
    </button>
    
    {/* تبديل الثيم */}
    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
      {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
    
    {/* الإشعارات */}
    <button className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg relative">
      <Bell className="w-5 h-5 text-slate-500" />
      <span className="absolute top-1 right-1 w-2 h-2 bg-rose-500 rounded-full" />
    </button>
  </div>
</header>
```

---

## 7. Dashboard Design

### 7.1 هيكل Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  مرحباً، مدير النظام                    [إضافة فاتورة] [قيد] │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ الإيرادات │  │ المصروفات │  │ صافي الربح │  │ الفواتير │    │
│  │  ٥٢٬٣٠٠  │  │  ١٢٬٤٠٠  │  │  ٣٩٬٩٠٠  │  │   ٢٤    │    │
│  │  +12%    │  │  -5%     │  │  +18%    │  │  +3     │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐  ┌─────────────────────┐  │
│  │     المبيعات الشهرية        │  │   أفضل المنتجات     │  │
│  │     (LineChart)             │  │   (BarChart)        │  │
│  │                             │  │                     │  │
│  └─────────────────────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐  ┌─────────────────────┐  │
│  │     عمر الديون (A/R Aging)  │  │   التنبيهات الذكية  │  │
│  │     (DonutChart)            │  │   (AlertFeed)       │  │
│  └─────────────────────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 KPI Grid

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  <KpiCard title="الإيرادات" value="٥٢٬٣٠٠" change="+12%" trend="up" />
  <KpiCard title="المصروفات" value="١٢٬٤٠٠" change="-5%" trend="down" />
  <KpiCard title="صافي الربح" value="٣٩٬٩٠٠" change="+18%" trend="up" />
  <KpiCard title="الفواتير" value="٢٤" change="+3" trend="up" />
</div>
```

---

## 8. RTL/LTR Support

### 8.1 Tailwind RTL Plugin

```js
// tailwind.config.js
module.exports = {
  plugins: [
    require('tailwindcss-rtl'),
  ],
}
```

### 8.2 استخدام Logical Properties

```css
/* بدلاً من */
margin-left: 1rem;
padding-right: 2rem;

/* استخدم */
margin-inline-start: 1rem;
padding-inline-end: 2rem;
```

### 8.3 تبديل الخطوط

```tsx
// في layout.tsx
const { language } = useTranslation();

<div className={cn(
  language === 'ar' ? 'font-cairo' : 'font-inter',
  language === 'ar' && 'rtl'
)}>
  {/* المحتوى */}
</div>
```

### 8.4 أيقونات الاتجاه

```tsx
// لا تعكس الأيقونات تلقائياً
// استخدم أيقونات محايدة أو وفر نسخ RTL

const ArrowIcon = ({ direction }) => {
  const { language } = useTranslation();
  const isRTL = language === 'ar';
  
  if (direction === 'back') {
    return isRTL ? <ChevronRight /> : <ChevronLeft />;
  }
  return isRTL ? <ChevronLeft /> : <ChevronRight />;
};
```

---

## 9. التفاعلات والرسوم المتحركة

### 9.1 المدة القياسية

| التفاعل | المدة | الدالة |
|---------|-------|--------|
| hover | 150ms | ease-out |
| focus | 100ms | linear |
| fade-in | 300ms | ease-out |
| modal | 200ms | cubic-bezier(0.16, 1, 0.3, 1) |
| toast | 400ms | cubic-bezier(0.23, 1, 0.32, 1) |
| skeleton | 2000ms | linear (infinite) |

### 9.2 Tailwind Animations

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
    },
  },
}
```

---

## 10. تجربة المستخدم (UX Patterns)

### 10.1 النماذج (Forms)

- **التسميات:** فوق الحقل دائماً (Top-aligned).
- **التحقق:** inline validation بعد `blur`.
- **الأخطاء:** رسالة واضحة مع لون `rose-500`.
- **الأزرار:** "حفظ" (Primary) على اليمين في RTL، "إلغاء" (Ghost) على اليسار.

### 10.2 الجداول (Tables)

- **الترتيب:** كل عمود قابل للترتيب.
- **البحث:** filter bar فوق الجدول.
- **Pagination:** إذا تجاوز 50 صفاً.
- **Actions:** زر "…" لكل صف.

### 10.3 التأكيدات (Confirmations)

- **الحذف:** Modal تأكيدي مع توضيح "لا يمكن التراجع".
- **الإلغاء:** Warning إذا كان هناك بيانات غير محفوظة.

---

## 11. الأيقونات والأصول

### 11.1 الأيقونات

**المكتبة:** [Lucide React](https://lucide.dev) — `lucide-react`

```tsx
import { 
  LayoutDashboard,    // Dashboard
  BookOpen,           // Accounts
  Warehouse,          // Inventory
  DollarSign,         // Sales
  ShoppingBag,        // Purchases
  Factory,            // Manufacturing
  UserCheck,          // HR
  HeartHandshake,     // CRM
  BarChart3,          // Reports
  Settings,           // Settings
  Menu,               // Menu toggle
  Sun, Moon,          // Theme toggle
  Bell,               // Notifications
  Search,             // Search
  Globe,              // Language
} from 'lucide-react';
```

### 11.2 الأصول

| الأصل | الموقع | الاستخدام |
|-------|--------|----------|
| `favicon.svg` | `public/` | أيقونة المتصفح |
| `logo.svg` | `src/assets/` | شعار التطبيق |
| `hero.png` | `src/assets/` | صورة البطل (اختياري) |

---

## 12. التجاوب (Responsiveness)

| نقطة التوقف | Tailwind | السلوك |
|-------------|----------|--------|
| **Desktop** | `lg:` (≥1024px) | Sidebar موسع (240px) |
| **Tablet** | `md:` (≥768px) | Sidebar مضغوط (أيقونات فقط) |
| **Mobile** | `< 768px` | Sidebar في drawer |

**ملاحظة:** التطبيق موجه أساساً لسطح المكتب، لكن يجب أن يعمل على الشاشات الأصغر.

---

## 13. قائمة مكونات UI

| المكون | الموقع | الاستخدام |
|--------|--------|----------|
| `Button` | `core/ui/components/` | الأزرار |
| `Input` | `core/ui/components/` | حقول الإدخال |
| `Select` | `core/ui/components/` | القوائم المنسدلة |
| `Modal` | `core/ui/components/` | النوافذ المنبثقة |
| `Card` | `core/ui/components/` | البطاقات |
| `Table` | `core/ui/components/` | الجداول |
| `KpiCard` | `core/ui/components/` | بطاقات KPI |
| `ChartContainer` | `core/ui/charts/` | حاوية الرسوم البيانية |
| `DataTable` | `core/ui/components/` | جداول TanStack |
| `Toast` | `core/ui/components/` | رسائل التنبيه |
| `Skeleton` | `core/ui/components/` | حالة التحميل |

---

*آخر تحديث: 2026-05-24 | المصمم: Lead UX Engineer*
