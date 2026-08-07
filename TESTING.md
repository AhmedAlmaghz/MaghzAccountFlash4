# استراتيجية الاختبار — maghzaccount-pro

> **الغرض:** يحدد هذا الملف استراتيجية الاختبار الشاملة للمشروع، بما في ذلك أنواع الاختبارات، الأدوات المستخدمة، هيكل الملفات، وأمثلة عملية على كتابة اختبارات للمكونات ومنطق الأعمال وطبقات البيانات والتقارير.

---

## 1. فلسفة الاختبار

**"اختبر الوحدات بعزل، واختبر التكامل بوضوح، واختبر المستخدم كما لو كان حقيقياً."**

- **الوحدة (Unit):** كل دالة منطقية، كل hook، كل adapter لقاعدة البيانات يجب أن يكون لها اختبار.
- **التكامل (Integration):** تدفق البيانات بين React → Zustand → Database Adapter يجب أن يُختبر بشكل واقعي.
- **نهاية إلى نهاية (E2E):** مسارات المستخدم الحرجة (تسجيل الدخول، إنشاء قيد، إصدار فاتورة) يجب أن تعمل كما هو متوقع.
- **التقارير:** كل تقرير يجب أن يُختبر للتأكد من صحة البيانات والرسوم البيانية والتصدير.

**قاعدة ذهبية:** الاختبار ليس اختيارياً. أي Pull Request بدون اختبارات تغطي التغييرات لن يُقبل.

---

## 2. أنواع الاختبارات والأدوات

| النوع | الأداة | الاستخدام | المدة المستهدفة |
|-------|--------|-----------|-----------------|
| **Unit Tests** | Vitest + @testing-library/react | Functions, Hooks, Stores, Adapters | < 100ms |
| **Component Tests** | Vitest + @testing-library/react | React Components, Forms, Tables | < 500ms |
| **Integration Tests** | Vitest + MSW | Components + Stores + Adapters | < 2s |
| **E2E Tests** | Playwright | مسارات كاملة في Electron + Browser | < 30s |
| **Database Tests** | Vitest + pg-mem | Schema, Queries, Migrations | < 5s |
| **Report Tests** | Vitest + @testing-library/react | Charts, Tables, Export | < 2s |
| **Visual Regression** | Playwright + argos-ci | التقاط الشاشات ومقارنتها | CI only |

---

## 3. البنية التنظيمية لملفات الاختبار

```
src/
├── core/
│   ├── ui/
│   │   ├── components/
│   │   │   ├── Button.tsx
│   │   │   └── __tests__/
│   │   │       └── Button.test.tsx
│   │   └── charts/
│   │       ├── RevenueChart.tsx
│   │       └── __tests__/
│   │           └── RevenueChart.test.tsx
│   ├── store/
│   │   ├── appStore.ts
│   │   └── __tests__/
│   │       └── appStore.test.ts
│   ├── database/
│   │   ├── adapters/
│   │   │   └── __tests__/
│   │   │       └── adapters.test.ts
│   │   └── schema/
│   │       └── __tests__/
│   │           └── schema.test.ts
│   └── reports/
│       ├── engine/
│       │   └── __tests__/
│       │       └── ReportBuilder.test.ts
│       └── export/
│           └── __tests__/
│               ├── PdfExporter.test.ts
│               └── ExcelExporter.test.ts
│
├── modules/
│   ├── accounting/
│   │   ├── components/
│   │   │   └── __tests__/
│   │   │       └── JournalEntryForm.test.tsx
│   │   ├── hooks/
│   │   │   └── __tests__/
│   │   │       └── useJournalEntries.test.ts
│   │   └── reports/
│   │       └── __tests__/
│   │           └── TrialBalanceReport.test.tsx
│   ├── sales/
│   │   └── __tests__/
│   │       ├── SalesInvoicePage.test.tsx
│   │       └── SalesAnalysisReport.test.tsx
│   └── reports/
│       └── dashboards/
│           └── __tests__/
│               └── MainDashboard.test.tsx
│
└── test/
    ├── setup.ts
    ├── mocks/
    │   ├── data.ts
    │   └── handlers.ts
    └── utils.ts
```

---

## 4. إعداد البيئة (Test Environment)

### 4.1 التبعيات (Dependencies)

```bash
npm install -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom msw playwright jspdf jspdf-autotable xlsx
```

### 4.2 إعداد Vitest (`vitest.config.ts`)

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'electron/',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/', 'dist/'],
  },
});
```

### 4.3 ملف الإعداد (`src/test/setup.ts`)

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, afterAll } from 'vitest';
import { server } from './mocks/server';

// تنظيف DOM بعد كل اختبار
afterEach(() => {
  cleanup();
});

// MSW Server
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

// Mock للمتغيرات البيئية
process.env.VITE_APP_ENV = 'test';

// Mock لـ matchMedia (للـ responsive design)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock لـ ResizeObserver (للـ Recharts)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
```

---

## 5. اختبارات الوحدات (Unit Tests)

### 5.1 اختبار دالة مساعدة

```ts
// src/core/utils/__tests__/formatCurrency.test.ts
import { describe, it, expect } from 'vitest';
import { formatCurrency } from '../formatCurrency';

describe('formatCurrency', () => {
  it('تنسيق المبلغ بالريال اليمني (YER)', () => {
    expect(formatCurrency(1500.5, 'YER', 'ar')).toBe('١٬٥٠٠٫٥٠ ر.ي');
  });

  it('تنسيق المبلغ بالدولار (USD)', () => {
    expect(formatCurrency(2500, 'USD', 'en')).toBe('$2,500.00');
  });

  it('التعامل مع القيم السالبة', () => {
    expect(formatCurrency(-500, 'YER', 'ar')).toBe('-٥٠٠٫٠٠ ر.ي');
  });

  it('التعامل مع null أو undefined', () => {
    expect(formatCurrency(null, 'YER', 'ar')).toBe('٠٫٠٠ ر.ي');
    expect(formatCurrency(undefined, 'USD', 'en')).toBe('$0.00');
  });
});
```

### 5.2 اختبار Zustand Store

```ts
// src/core/store/__tests__/appStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeView: 'dashboard',
      activeCompany: null,
      dbStatus: { layer: 'mock', connected: false },
      theme: 'light',
      language: 'ar',
    });
  });

  it('يجب أن يبدأ بـ activeView = dashboard', () => {
    expect(useAppStore.getState().activeView).toBe('dashboard');
  });

  it('setActiveCompany يجب أن يحدد الشركة النشطة', () => {
    useAppStore.getState().setActiveCompany('Test Co', 'uuid-123', 'YER');
    const state = useAppStore.getState();
    expect(state.activeCompany).toEqual({
      name: 'Test Co',
      id: 'uuid-123',
      currency: 'YER',
    });
  });

  it('toggleTheme يجب أن يبدل بين light و dark', () => {
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('dark');
    
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('light');
  });
});
```

### 5.3 اختبار Custom Hook

```ts
// src/core/i18n/__tests__/useTranslation.test.ts
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranslation } from '../useTranslation';

describe('useTranslation', () => {
  it('يجب أن يعيد النص العربي بشكل افتراضي', () => {
    const { result } = renderHook(() => useTranslation());
    expect(result.current.t('sidebar.accounts')).toBe('الحسابات');
    expect(result.current.language).toBe('ar');
  });

  it('يجب أن يتيح تغيير اللغة', () => {
    const { result } = renderHook(() => useTranslation());
    act(() => {
      result.current.setLanguage('en');
    });
    expect(result.current.language).toBe('en');
    expect(result.current.t('sidebar.accounts')).toBe('Accounts');
  });
});
```

---

## 6. اختبارات المكونات (Component Tests)

### 6.1 اختبار مكون بسيط

```tsx
// src/core/ui/components/__tests__/Button.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('يجب أن يعرض النص', () => {
    render(<Button>انقر هنا</Button>);
    expect(screen.getByText('انقر هنا')).toBeInTheDocument();
  });

  it('يجب أن يستدعي onClick عند النقر', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>انقر هنا</Button>);
    fireEvent.click(screen.getByText('انقر هنا'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('يجب أن يكون معطلاً عند disabled', () => {
    const handleClick = vi.fn();
    render(<Button disabled onClick={handleClick}>انقر هنا</Button>);
    fireEvent.click(screen.getByText('انقر هنا'));
    expect(handleClick).not.toHaveBeenCalled();
  });
});
```

### 6.2 اختبار نموذج (Form)

```tsx
// src/modules/accounting/__tests__/JournalEntryForm.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JournalEntryForm } from '../components/JournalEntryForm';

describe('JournalEntryForm', () => {
  const mockSubmit = vi.fn();

  it('يجب أن يُظهر خطأ عند عدم تطابق المبالغ', async () => {
    render(<JournalEntryForm onSubmit={mockSubmit} />);

    await userEvent.type(screen.getByLabelText('الوصف'), 'قيد تجريبي');
    await userEvent.type(screen.getByLabelText('المدين'), '1000');
    await userEvent.type(screen.getByLabelText('الدائن'), '500');
    
    fireEvent.click(screen.getByRole('button', { name: /حفظ/i }));

    await waitFor(() => {
      expect(screen.getByText('المبالغ غير متوازنة')).toBeInTheDocument();
    });

    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('يجب أن يُرسل البيانات عند صحة النموذج', async () => {
    render(<JournalEntryForm onSubmit={mockSubmit} />);

    await userEvent.type(screen.getByLabelText('الوصف'), 'قيد تجريبي');
    await userEvent.type(screen.getByLabelText('المدين'), '1000');
    await userEvent.type(screen.getByLabelText('الدائن'), '1000');
    
    fireEvent.click(screen.getByRole('button', { name: /حفظ/i }));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'قيد تجريبي',
        })
      );
    });
  });
});
```

---

## 7. اختبارات التقارير (Report Tests)

### 7.1 اختبار محرك التقارير

```ts
// src/core/reports/engine/__tests__/ReportBuilder.test.ts
import { describe, it, expect } from 'vitest';
import { ReportBuilder } from '../ReportBuilder';

describe('ReportBuilder', () => {
  it('يجب أن يبني استعلام صحيح', () => {
    const report = new ReportBuilder()
      .from('sales_invoices')
      .select(['date', 'customer_name', 'total'])
      .where({ companyId: 'uuid-123' })
      .groupBy('month')
      .build();

    expect(report.query.table).toBe('sales_invoices');
    expect(report.query.columns).toContain('date');
    expect(report.query.groupBy).toBe('month');
  });

  it('يجب أن يحسب المجاميع بشكل صحيح', () => {
    const data = [
      { month: '2026-01', total: 1000 },
      { month: '2026-01', total: 500 },
      { month: '2026-02', total: 2000 },
    ];

    const report = new ReportBuilder()
      .from(data)
      .aggregate({ total: 'sum' })
      .groupBy('month')
      .build();

    const result = report.execute();
    expect(result).toEqual([
      { month: '2026-01', total: 1500 },
      { month: '2026-02', total: 2000 },
    ]);
  });
});
```

### 7.2 اختبار مكون تقرير

```tsx
// src/modules/sales/reports/__tests__/SalesAnalysisReport.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SalesAnalysisReport } from '../SalesAnalysisReport';

// Mock للـ hook
vi.mock('../../hooks/useSalesReportData', () => ({
  useSalesReportData: () => ({
    data: {
      monthly: [
        { month: 'يناير', total: 5000 },
        { month: 'فبراير', total: 7000 },
      ],
    },
    isLoading: false,
  }),
}));

describe('SalesAnalysisReport', () => {
  it('يجب أن يعرض عنوان التقرير', () => {
    render(<SalesAnalysisReport />);
    expect(screen.getByText('تحليل المبيعات')).toBeInTheDocument();
  });

  it('يجب أن يعرض أزرار التصدير', () => {
    render(<SalesAnalysisReport />);
    expect(screen.getByRole('button', { name: /PDF/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Excel/i })).toBeInTheDocument();
  });

  it('يجب أن يعرض البيانات بعد التحميل', async () => {
    render(<SalesAnalysisReport />);
    await waitFor(() => {
      expect(screen.getByText('يناير')).toBeInTheDocument();
    });
  });
});
```

### 7.3 اختبار تصدير PDF

```ts
// src/core/reports/export/__tests__/PdfExporter.test.ts
import { describe, it, expect } from 'vitest';
import { PdfExporter } from '../PdfExporter';

describe('PdfExporter', () => {
  it('يجب أن يُنشئ PDF blob', async () => {
    const data = {
      title: 'تقرير المبيعات',
      date: '2026-05-24',
      rows: [
        { product: 'منتج 1', quantity: 10, total: 1000 },
        { product: 'منتج 2', quantity: 5, total: 500 },
      ],
    };

    const exporter = new PdfExporter();
    const blob = await exporter.generate(data, 'sales-report');

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
  });
});
```

### 7.4 اختبار تصدير Excel

```ts
// src/core/reports/export/__tests__/ExcelExporter.test.ts
import { describe, it, expect } from 'vitest';
import { ExcelExporter } from '../ExcelExporter';

describe('ExcelExporter', () => {
  it('يجب أن يُنشئ ملف Excel', async () => {
    const data = [
      { date: '2026-05-24', customer: 'أحمد', total: 1000 },
      { date: '2026-05-25', customer: 'محمد', total: 2000 },
    ];

    const exporter = new ExcelExporter();
    const buffer = await exporter.generate(data, 'sales-report');

    expect(buffer).toBeInstanceOf(ArrayBuffer);
  });

  it('يجب أن يدعم تنسيق الخلايا', async () => {
    const data = [
      { product: 'منتج 1', price: 100.5, quantity: 10 },
    ];

    const exporter = new ExcelExporter({
      columns: [
        { key: 'product', header: 'المنتج' },
        { key: 'price', header: 'السعر', format: '#,##0.00' },
        { key: 'quantity', header: 'الكمية' },
      ],
    });

    const buffer = await exporter.generate(data, 'products');
    expect(buffer.byteLength).toBeGreaterThan(0);
  });
});
```

---

## 8. اختبارات Dashboard

```tsx
// src/modules/reports/dashboards/__tests__/MainDashboard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainDashboard } from '../MainDashboard';

// Mock للـ hooks
vi.mock('../hooks/useDashboardKpis', () => ({
  useDashboardKpis: () => ({
    revenue: { total: 52300, change: 12 },
    expenses: { total: 12400, change: -5 },
    profit: { total: 39900, change: 18 },
    invoices: { count: 24, change: 3 },
    isLoading: false,
  }),
}));

describe('MainDashboard', () => {
  it('يجب أن يعرض بطاقات KPI', () => {
    render(<MainDashboard />);
    expect(screen.getByText('الإيرادات')).toBeInTheDocument();
    expect(screen.getByText('المصروفات')).toBeInTheDocument();
    expect(screen.getByText('صافي الربح')).toBeInTheDocument();
  });

  it('يجب أن يعرض قيم KPI الصحيحة', () => {
    render(<MainDashboard />);
    expect(screen.getByText('٥٢٬٣٠٠')).toBeInTheDocument();
    expect(screen.getByText('١٢٬٤٠٠')).toBeInTheDocument();
  });

  it('يجب أن يعرض التغيرات', () => {
    render(<MainDashboard />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
    expect(screen.getByText('-5%')).toBeInTheDocument();
  });
});
```

---

## 9. اختبارات قاعدة البيانات

### 9.1 اختبار Schema

```ts
// src/core/database/schema/__tests__/schema.test.ts
import { describe, it, expect } from 'vitest';
import { companies, accounts, journalEntries } from '../accounting';

describe('Database Schema', () => {
  it('جدول الشركات يجب أن يحتوي على الأعمدة الأساسية', () => {
    expect(companies).toBeDefined();
    expect(companies.name).toBeDefined();
    expect(companies.currency).toBeDefined();
  });

  it('جدول الحسابات يجب أن يكون له مفتاح أجنبي لـ company_id', () => {
    const foreignKeys = accounts.getTableForeignKeys();
    const hasCompanyFk = foreignKeys.some(
      (fk) => fk.columns().includes('company_id')
    );
    expect(hasCompanyFk).toBe(true);
  });

  it('قيود journal_entries يجب أن تمنع الحذف العشوائي للحسابات', () => {
    const foreignKeys = journalEntries.getTableForeignKeys();
    const accountFk = foreignKeys.find(
      (fk) => fk.columns().includes('account_id')
    );
    expect(accountFk?.onDelete).toBe('restrict');
  });
});
```

### 9.2 اختبار Database Adapter (mock الـ adapter)

نظراً لأن `getDbAdapter` يعتمد على `electronPgAdapter` فقط ولا يوجد mock adapter،
نستخدم `vi.mock` لحقن mock adapter في الاختبارات:

```ts
// src/core/utils/journalEntryGenerator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDbAdapter } from '@/core/database/adapters';

vi.mock('@/core/database/adapters', () => ({
  getDbAdapter: vi.fn(),
}));

function createMockAdapter() {
  const accounts = [
    { id: 'acc-cash', company_id: 'comp-1', code: '11101', name: 'Cash' },
    { id: 'acc-sales', company_id: 'comp-1', code: '41101', name: 'Sales' },
  ];

  return {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from accounts')) {
        const match = accounts.find(a => a.company_id === params[0] && a.code === params[1]);
        return { success: true, rows: match ? [{ id: match.id }] : [] };
      }
      return { success: true, rows: [] };
    }),
    createTransaction: vi.fn(async () => ({ success: true, id: 'tx-1' })),
  };
}

describe('journalEntryGenerator', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts a sales invoice successfully', async () => {
    const adapter = createMockAdapter();
    vi.mocked(getDbAdapter).mockResolvedValue(adapter as any);

    const result = await postSalesInvoice('comp-1', {
      invoiceNumber: 'INV-001',
      date: '2024-06-01',
      customerId: 'cust-1',
      subtotal: 1000,
      vatAmount: 50,
      totalAmount: 1050,
    });

    expect(result.success).toBe(true);
    expect(adapter.createTransaction).toHaveBeenCalled();
  });
});
```

---

## 10. اختبارات E2E (Playwright)

### 10.1 إعداد Playwright

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

### 10.2 مثال على اختبار E2E

```ts
// e2e/dashboard.spec.ts
import { test, expect } from '@playwright/test';

test.describe('لوحة التحكم الرئيسية', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('يجب أن تعرض بطاقات KPI', async ({ page }) => {
    await expect(page.locator('[data-testid="kpi-revenue"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-expenses"]')).toBeVisible();
    await expect(page.locator('[data-testid="kpi-profit"]')).toBeVisible();
  });

  test('يجب أن تعرض الرسوم البيانية', async ({ page }) => {
    await expect(page.locator('[data-testid="revenue-chart"]')).toBeVisible();
  });

  test('تبديل الثيم يجب أن يعمل', async ({ page }) => {
    // التحقق من الوضع الفاتح
    await expect(page.locator('html')).not.toHaveClass('dark');
    
    // النقر على زر تبديل الثيم
    await page.click('[data-testid="theme-toggle"]');
    
    // التحقق من الوضع الداكن
    await expect(page.locator('html')).toHaveClass('dark');
  });

  test('تبديل اللغة يجب أن يغير اتجاه الواجهة', async ({ page }) => {
    // التحقق من الاتجاه الافتراضي (RTL)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    // تبديل اللغة
    await page.click('[data-testid="lang-toggle"]');
    
    // التحقق من LTR
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});
```

### 10.3 اختبار مسار إنشاء فاتورة

```ts
// e2e/sales-invoice.spec.ts
import { test, expect } from '@playwright/test';

test.describe('إنشاء فاتورة مبيعات', () => {
  test('المستخدم يجب أن يتمكن من إنشاء فاتورة جديدة', async ({ page }) => {
    await page.goto('/sales');

    // النقر على زر إنشاء فاتورة
    await page.click('button:has-text("فاتورة جديدة")');

    // ملء بيانات الفاتورة
    await page.fill('[data-testid="customer-select"]', 'أحمد');
    await page.fill('[data-testid="product-code"]', 'P001');
    await page.fill('[data-testid="quantity"]', '5');
    await page.fill('[data-testid="unit-price"]', '100');

    // حفظ الفاتورة
    await page.click('button:has-text("حفظ")');

    // التحقق من ظهور رسالة النجاح
    await expect(page.locator('text=تم حفظ الفاتورة بنجاح')).toBeVisible();

    // التحقق من ظهور الفاتورة في القائمة
    await page.click('button:has-text("الفواتير")');
    await expect(page.locator('text=أحمد')).toBeVisible();
  });
});
```

---

## 11. تغطية الاختبار (Coverage)

### 11.1 الأهداف

| المجال | الهدف | الحد الأدنى |
|--------|-------|-------------|
| **Utils / Helpers** | 95% | 90% |
| **Hooks** | 90% | 80% |
| **Stores (Zustand)** | 90% | 80% |
| **Components** | 85% | 70% |
| **Database Adapters** | 85% | 70% |
| **Report Engine** | 90% | 80% |
| **Export (PDF/Excel)** | 85% | 70% |
| **E2E Critical Paths** | 100% | 100% |

### 11.2 استثناءات التغطية

- مكونات UI البسيطة التي لا تحتوي على منطق.
- ملفات التهيئة والإعداد.
- الـ Electron Main Process (يُختبر يدوياً).

---

## 12. أوامر الاختبار

```bash
# اختبارات الوحدات
npm run test:unit

# اختبارات التكامل
npm run test:integration

# اختبارات E2E
npm run test:e2e

# اختبارات E2E مع UI
npm run test:e2e:ui

# جميع الاختبارات
npm run test

# تغطية الاختبار
npm run test:coverage

# مراقبة التغييرات
npm run test:watch
```

---

## 13. CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  unit-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:unit -- --coverage
      - run: npm run test:integration

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npm run test:e2e
```

---

## 14. نصائح وأفضل الممارسات

| ✅ افعل | ❌ لا تفعل |
|---------|-----------|
| اختبر السلوك (behavior) لا التنفيذ الداخلي | لا تختبر implementation details |
| استخدم `data-testid` للعناصر الثابتة | لا تختبر class names أو inline styles |
| اجعل الاختبارات مستقلة | لا تشارك state بين الاختبارات |
| استخدم `beforeEach` لإعادة التعيين | لا تترك بيانات عالقة |
| اختبر حالات الخطأ (error cases) | لا تختبر فقط الحالات السعيدة |
| استخدم `userEvent` بدلاً من `fireEvent` | لا تستخدم `fireEvent` بشكل مفرط |
| اكتب اختبارات للـ reports | لا تهمل اختبارات التصدير |

---

*آخر تحديث: 2026-05-24 | مسؤول الجودة: QA Lead*
