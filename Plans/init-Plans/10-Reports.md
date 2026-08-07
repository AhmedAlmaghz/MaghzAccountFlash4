# خطة الوحدة: التقارير والتحليلات (Reports)

> **الهدف:** بناء لوحة تحكم رئيسية (Dashboard) متكاملة وتقارير مركزية متقدمة تجمع بيانات من جميع الوحدات.

---

## 1. نظرة عامة

| البند | التفاصيل |
|-------|---------|
| **الاسم** | Reports & Analytics |
| **المجلد** | `src/modules/reports/` |
| **التبعيات** | Core, جميع الوحدات |
| **المدة** | أسبوع واحد (المرحلة 9) |
| **الأولوية** | عالية |

---

## 2. المتطلبات الوظيفية

### 2.1 لوحة التحكم الرئيسية (Main Dashboard)
- KPI Cards من كل الوحدات.
- الإيرادات اليومية/الشهرية.
- المصروفات.
- صافي الربح.
- عدد الفواتير.
- رصيد المخزون.
- التنبيهات الذكية.

### 2.2 الرسوم البيانية (Charts)
- مبيعات شهرية (Line Chart).
- أعلى المنتجات (Bar Chart).
- توزيع العملاء (Pie Chart).
- عمر الديون (Donut Chart).
- التدفقات النقدية (Area Chart).

### 2.3 التقارير المركزية
- التقرير المالي المتكامل.
- لوحة التحليلات المتقدمة.
- مقارنة الفترات.
- التوقعات (Forecasting).

### 2.4 التنبيهات الذكية
- مخزون منخفض.
- فواتير مستحقة.
- شيكات مستحقة.
- رواتب مستحقة.

### 2.5 التصدير
- PDF للتقارير.
- Excel للبيانات.
- CSV للتحليلات.

---

## 3. هيكل الملفات

```
src/modules/reports/
├── index.ts
├── types.ts
│
├── dashboards/
│   ├── MainDashboard.tsx
│   ├── components/
│   │   ├── KpiGrid.tsx
│   │   ├── KpiCard.tsx
│   │   ├── ChartSection.tsx
│   │   ├── AlertFeed.tsx
│   │   ├── QuickActions.tsx
│   │   └── index.ts
│   └── index.ts
│
├── analytics/
│   ├── FinancialDashboard.tsx
│   ├── ComparativeAnalysis.tsx
│   ├── Forecasting.tsx
│   └── index.ts
│
├── components/
│   ├── ReportFilter.tsx
│   ├── ExportButton.tsx
│   ├── ChartContainer.tsx
│   └── index.ts
│
├── hooks/
│   ├── useDashboardKpis.ts
│   ├── useFinancialReports.ts
│   ├── useSmartAlerts.ts
│   └── index.ts
│
├── reports/
│   ├── IntegratedFinancialReport.tsx
│   ├── PeriodComparison.tsx
│   └── index.ts
│
└── utils/
    ├── kpiCalculations.ts
    └── alertEngine.ts
```

---

## 4. المكونات (Components)

### 4.1 لوحة التحكم الرئيسية

```tsx
// dashboards/MainDashboard.tsx
export const MainDashboard = () => {
  const { kpis, isLoading } = useDashboardKpis();
  const { alerts } = useSmartAlerts();
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* الترحيب */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.welcome')}, {kpis.userName}</h1>
          <p className="text-slate-500">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button>+ فاتورة جديدة</Button>
          <Button variant="outline">+ قيد يومي</Button>
        </div>
      </div>

      {/* KPI Cards */}
      <KpiGrid>
        <KpiCard 
          title="الإيرادات اليومية" 
          value={kpis.revenue.today} 
          change={kpis.revenue.change}
          trend={kpis.revenue.trend}
          icon={TrendingUp}
        />
        <KpiCard 
          title="المصروفات" 
          value={kpis.expenses.total} 
          change={kpis.expenses.change}
          trend={kpis.expenses.trend}
          icon={TrendingDown}
        />
        <KpiCard 
          title="صافي الربح" 
          value={kpis.profit.total} 
          change={kpis.profit.change}
          trend={kpis.profit.trend}
          icon={DollarSign}
        />
        <KpiCard 
          title="الفواتير" 
          value={kpis.invoices.count} 
          change={kpis.invoices.change}
          icon={FileText}
        />
      </KpiGrid>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartSection title="المبيعات الشهرية">
          <MonthlyRevenueChart data={kpis.monthlyRevenue} />
        </ChartSection>
        
        <ChartSection title="أعلى المنتجات">
          <TopProductsChart data={kpis.topProducts} />
        </ChartSection>
      </div>

      {/* Alerts & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <ChartSection title="عمر الديون (A/R)">
            <ArAgingChart data={kpis.arAging} />
          </ChartSection>
        </div>
        
        <div className="space-y-4">
          <AlertFeed alerts={alerts} />
          <QuickActions />
        </div>
      </div>
    </div>
  );
};
```

### 4.2 KPI Card

```tsx
// dashboards/components/KpiCard.tsx
interface KpiCardProps {
  title: string;
  value: number | string;
  change?: number;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ComponentType<any>;
}

export const KpiCard = ({ title, value, change, trend, icon: Icon }: KpiCardProps) => {
  const trendColors = {
    up: 'text-emerald-500',
    down: 'text-rose-500',
    neutral: 'text-slate-500',
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
          <p className="text-3xl font-bold mt-1 tabular-nums">{value}</p>
          {change !== undefined && (
            <p className={cn('text-sm mt-1', trendColors[trend || 'neutral'])}>
              {trend === 'up' ? '+' : ''}{change}%
            </p>
          )}
        </div>
        {Icon && (
          <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
            <Icon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
        )}
      </div>
    </div>
  );
};
```

### 4.3 Alert Feed

```tsx
// dashboards/components/AlertFeed.tsx
export const AlertFeed = ({ alerts }: AlertFeedProps) => {
  const alertIcons = {
    low_stock: Package,
    invoice_due: Calendar,
    check_due: FileCheck,
    salary_due: Users,
  };

  const alertColors = {
    low_stock: 'bg-amber-500',
    invoice_due: 'bg-blue-500',
    check_due: 'bg-purple-500',
    salary_due: 'bg-rose-500',
  };

  return (
    <div className="card">
      <h3 className="font-semibold mb-4">التنبيهات الذكية</h3>
      <div className="space-y-2">
        {alerts.map((alert, idx) => {
          const Icon = alertIcons[alert.type];
          return (
            <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-white', alertColors[alert.type])}>
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">{alert.title}</p>
                <p className="text-xs text-slate-500">{alert.description}</p>
              </div>
              <span className="text-xs text-slate-400">{alert.time}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
```

---

## 5. Hooks

### 5.1 useDashboardKpis

```ts
// hooks/useDashboardKpis.ts
export const useDashboardKpis = () => {
  const { data: revenue } = useRevenueKpi();
  const { data: expenses } = useExpensesKpi();
  const { data: invoices } = useInvoicesCountKpi();
  const { data: monthlyRevenue } = useMonthlyRevenueChart();
  const { data: topProducts } = useTopProductsChart();
  const { data: arAging } = useArAgingChart();

  const kpis = useMemo(() => ({
    revenue: {
      today: revenue?.today || 0,
      monthly: revenue?.monthly || 0,
      change: revenue?.change || 0,
      trend: revenue?.change >= 0 ? 'up' : 'down',
    },
    expenses: {
      total: expenses?.total || 0,
      change: expenses?.change || 0,
      trend: expenses?.change <= 0 ? 'up' : 'down',
    },
    profit: {
      total: (revenue?.monthly || 0) - (expenses?.total || 0),
      change: calculateProfitChange(revenue, expenses),
      trend: calculateProfitTrend(revenue, expenses),
    },
    invoices: {
      count: invoices?.count || 0,
      change: invoices?.change || 0,
    },
    monthlyRevenue: monthlyRevenue || [],
    topProducts: topProducts || [],
    arAging: arAging || [],
    userName: 'مدير النظام',
  }), [revenue, expenses, invoices, monthlyRevenue, topProducts, arAging]);

  return { kpis, isLoading: !revenue || !expenses };
};
```

---

## 6. تقسيم المهام

| # | المهمة | المدة | الأولوية |
|---|--------|-------|---------|
| 1 | هيكل Dashboard | 2 ساعة | عالية |
| 2 | KPI Cards (4 بطاقات) | 4 ساعات | عالية |
| 3 | Charts (5 رسوم بيانية) | 6 ساعات | عالية |
| 4 | Alert Feed | 2 ساعة | متوسطة |
| 5 | Quick Actions | 1 ساعة | منخفضة |
| 6 | Hooks للـ KPIs | 4 ساعات | عالية |
| 7 | التنبيهات الذكية | 3 ساعات | متوسطة |
| 8 | اختبارات الوحدات | 2 ساعة | منخفضة |

---

## 7. معايير القبول

- [ ] Dashboard يعرض كـ الصفحة الرئيسية.
- [ ] KPI Cards تعرض بيانات صحيحة.
- [ ] Charts تعمل بشكل صحيح.
- [ ] Dark Mode يعمل.
- [ ] RTL يعمل.
- [ ] التنبيهات الذكية تظهر.
- [ ] Quick Actions تعمل.
- [ ] اختبارات الوحدات تمر.

---

## 8. المخرجات النهائية

1. **لوحة تحكم رئيسية** (Main Dashboard).
2. **4 KPI Cards**.
3. **5 Charts** متقدمة.
4. **نظام تنبيهات ذكية**.
5. **Quick Actions**.
6. **اختبارات** شاملة.

---

*تاريخ الإنشاء: 2026-05-24 | المسؤول: Reports Module Lead*
