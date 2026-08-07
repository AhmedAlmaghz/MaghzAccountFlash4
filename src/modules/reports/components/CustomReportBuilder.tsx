import React, { useState } from 'react';
import { useFormatters } from '@/core/utils/useFormatters';
import { Settings, FileDown, RotateCcw, ChevronRight, ChevronLeft } from 'lucide-react';
import { Card, Button, Table } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import { usePermission } from '@/modules/auth/hooks/usePermission';

interface TableMeta {
  name: string;
  label: string;
  columns: { key: string; label: string; type: 'string' | 'number' | 'date' }[];
}

const AVAILABLE_TABLES: TableMeta[] = [
  {
    name: 'sales_invoices',
    label: 'reports.customBuilder.table.salesInvoices',
    columns: [
      { key: 'id', label: 'reports.customBuilder.col.id', type: 'string' },
      { key: 'invoice_number', label: 'reports.customBuilder.col.invoiceNumber', type: 'string' },
      { key: 'customer_id', label: 'reports.customBuilder.col.customerId', type: 'string' },
      { key: 'date', label: 'reports.customBuilder.col.date', type: 'date' },
      { key: 'total_amount', label: 'reports.customBuilder.col.totalAmount', type: 'number' },
      { key: 'status', label: 'reports.customBuilder.col.status', type: 'string' },
    ],
  },
  {
    name: 'purchase_invoices',
    label: 'reports.customBuilder.table.purchaseInvoices',
    columns: [
      { key: 'id', label: 'reports.customBuilder.col.id', type: 'string' },
      { key: 'invoice_number', label: 'reports.customBuilder.col.invoiceNumber', type: 'string' },
      { key: 'supplier_id', label: 'reports.customBuilder.col.supplierId', type: 'string' },
      { key: 'date', label: 'reports.customBuilder.col.date', type: 'date' },
      { key: 'total_amount', label: 'reports.customBuilder.col.totalAmount', type: 'number' },
      { key: 'status', label: 'reports.customBuilder.col.status', type: 'string' },
    ],
  },
  {
    name: 'products',
    label: 'reports.customBuilder.table.products',
    columns: [
      { key: 'id', label: 'reports.customBuilder.col.id', type: 'string' },
      { key: 'name_ar', label: 'reports.customBuilder.col.name', type: 'string' },
      { key: 'sku', label: 'reports.customBuilder.col.sku', type: 'string' },
      { key: 'cost_price', label: 'reports.customBuilder.col.costPrice', type: 'number' },
      { key: 'sale_price', label: 'reports.customBuilder.col.salePrice', type: 'number' },
      { key: 'is_active', label: 'reports.customBuilder.col.isActive', type: 'string' },
    ],
  },
  {
    name: 'customers',
    label: 'reports.customBuilder.table.customers',
    columns: [
      { key: 'id', label: 'reports.customBuilder.col.id', type: 'string' },
      { key: 'code', label: 'reports.customBuilder.col.code', type: 'string' },
      { key: 'name', label: 'reports.customBuilder.col.name', type: 'string' },
      { key: 'phone', label: 'reports.customBuilder.col.phone', type: 'string' },
      { key: 'balance', label: 'reports.customBuilder.col.balance', type: 'number' },
    ],
  },
  {
    name: 'suppliers',
    label: 'reports.customBuilder.table.suppliers',
    columns: [
      { key: 'id', label: 'reports.customBuilder.col.id', type: 'string' },
      { key: 'code', label: 'reports.customBuilder.col.code', type: 'string' },
      { key: 'name', label: 'reports.customBuilder.col.name', type: 'string' },
      { key: 'phone', label: 'reports.customBuilder.col.phone', type: 'string' },
      { key: 'balance', label: 'reports.customBuilder.col.balance', type: 'number' },
    ],
  },
  {
    name: 'accounts',
    label: 'reports.customBuilder.table.accounts',
    columns: [
      { key: 'id', label: 'reports.customBuilder.col.id', type: 'string' },
      { key: 'code', label: 'reports.customBuilder.col.code', type: 'string' },
      { key: 'name_ar', label: 'reports.customBuilder.col.name', type: 'string' },
      { key: 'type', label: 'reports.customBuilder.col.type', type: 'string' },
      { key: 'balance', label: 'reports.customBuilder.col.balance', type: 'number' },
    ],
  },
];

interface SelectedColumn {
  key: string;
  label: string;
  aggregate?: 'sum' | 'avg' | 'count' | 'none';
}

interface FilterRule {
  column: string;
  operator: 'equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte';
  value: string;
}

type Step = 'table' | 'columns' | 'filters' | 'preview';

export const CustomReportBuilder: React.FC = () => {
  const { t } = useTranslation();
  const canCustom = usePermission('reports.custom');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const [step, setStep] = useState<Step>('table');
  const [selectedTable, setSelectedTable] = useState<TableMeta | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<SelectedColumn[]>([]);
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [previewData, setPreviewData] = useState<Record<string, unknown>[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [reportName, setReportName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const steps: { key: Step; label: string }[] = [
    { key: 'table', label: t('reports.selectTable') },
    { key: 'columns', label: t('reports.selectColumns') },
    { key: 'filters', label: t('reports.selectFilters') },
    { key: 'preview', label: t('reports.preview') },
  ];

  const toggleColumn = (col: TableMeta['columns'][0]) => {
    setSelectedColumns((prev) => {
      const exists = prev.find((c) => c.key === col.key);
      if (exists) return prev.filter((c) => c.key !== col.key);
      return [...prev, { key: col.key, label: col.label }];
    });
  };

  const addFilter = () => {
    if (!selectedTable) return;
    setFilters((prev) => [...prev, { column: selectedTable.columns[0].key, operator: 'contains', value: '' }]);
  };

  const updateFilter = (index: number, field: keyof FilterRule, value: string) => {
    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, [field]: value } : f)));
  };

  const removeFilter = (index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const runPreview = async () => {
    if (!selectedTable || !activeCompany?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const adapter = await getDbAdapter();
      // Validate table name against whitelist to prevent SQL injection.
      // selectedTable.name comes from AVAILABLE_TABLES (hardcoded) but we re-validate.
      const allowedTable = AVAILABLE_TABLES.find((t) => t.name === selectedTable.name);
      if (!allowedTable) {
        setError('Invalid table selection');
        setIsLoading(false);
        return;
      }
      const result = await adapter.query(`SELECT * FROM ${allowedTable.name} WHERE company_id = $1 LIMIT 500`, [activeCompany.id]);
      let rows = (result.rows || []) as Record<string, unknown>[];

      if (!result.success) {
        setError(result.error || 'Query failed');
        setPreviewData([]);
        setStep('preview');
        return;
      }

      for (const f of filters) {
        rows = rows.filter((r) => {
          const val = String(r[f.column] ?? '').toLowerCase();
          const comp = f.value.toLowerCase();
          switch (f.operator) {
            case 'equals': return val === comp;
            case 'contains': return val.includes(comp);
            case 'gt': return Number(r[f.column]) > Number(f.value);
            case 'lt': return Number(r[f.column]) < Number(f.value);
            case 'gte': return Number(r[f.column]) >= Number(f.value);
            case 'lte': return Number(r[f.column]) <= Number(f.value);
            default: return true;
          }
        });
      }

      const projected = rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (const col of selectedColumns.length ? selectedColumns : selectedTable.columns.map((c) => ({ key: c.key, label: c.label }))) {
          obj[col.key] = row[col.key];
        }
        return obj;
      });

      setPreviewData(projected);
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreviewData([]);
      setStep('preview');
    }
    setIsLoading(false);
  };

  const handleExportExcel = async () => {
    const cols = (selectedColumns.length ? selectedColumns : selectedTable!.columns.map((c) => ({ key: c.key, label: c.label }))).map((c) => ({
      key: c.key,
      header: c.label,
    }));
    await exportToExcel(previewData, cols, reportName || 'Custom_Report');
  };

  const handleExportPDF = async () => {
    const cols = (selectedColumns.length ? selectedColumns : selectedTable!.columns.map((c) => ({ key: c.key, label: c.label }))).map((c) => ({
      key: c.key,
      header: c.label,
      width: 18,
    }));
    await exportToPDF(previewData, cols, reportName || 'Custom_Report', {
      title: reportName || t('reports.customReportBuilder'),
      subtitle: activeCompany?.name,
      rtl: true,
    });
  };

  const canNext = () => {
    if (step === 'table') return !!selectedTable;
    if (step === 'columns') return selectedColumns.length > 0;
    return true;
  };

  const nextStep = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx < steps.length - 1) setStep(steps[idx + 1].key);
  };

  const prevStep = () => {
    const idx = steps.findIndex((s) => s.key === step);
    if (idx > 0) setStep(steps[idx - 1].key);
  };

  if (!canCustom) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Settings size={48} className="mx-auto mb-4 text-slate-400" />
          <p className="text-lg font-medium text-slate-700 dark:text-slate-200">{t('reports.noPermission')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Settings size={28} className="text-primary-600 dark:text-primary-400" />
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('reports.customReportBuilder')}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">{t('reports.customReportBuilder.subtitle')}</p>
        </div>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            <button
              onClick={() => setStep(s.key)}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                step === s.key
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              )}
            >
              {i + 1}. {s.label}
            </button>
            {i < steps.length - 1 && <ChevronRight size={16} className="text-slate-300 shrink-0" />}
          </React.Fragment>
        ))}
      </div>

      {/* Step Content */}
      <Card>
        <div className="p-6">
          {step === 'table' && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('reports.selectTable')}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {AVAILABLE_TABLES.map((table) => (
                  <button
                    key={table.name}
                    onClick={() => { setSelectedTable(table); setSelectedColumns([]); setFilters([]); }}
                    className={cn(
                      'p-4 rounded-xl border text-left transition-all',
                      selectedTable?.name === table.name
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 ring-1 ring-primary-500'
                        : 'border-slate-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-700'
                    )}
                  >
                    <p className="font-medium text-slate-900 dark:text-slate-50">{t(table.label)}</p>
                    <p className="text-xs text-slate-500 mt-1">{table.columns.length} {t('reports.selectColumns')}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'columns' && selectedTable && (
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('reports.selectColumns')}</h3>
              <div className="flex flex-wrap gap-3">
                {selectedTable.columns.map((col) => {
                  const isSelected = selectedColumns.some((c) => c.key === col.key);
                  return (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col)}
                      className={cn(
                        'px-3 py-2 rounded-lg text-sm border transition-colors',
                        isSelected
                          ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'
                      )}
                    >
                      {t(col.label)}
                    </button>
                  );
                })}
              </div>
              {selectedColumns.length > 0 && (
                <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-sm text-slate-600 dark:text-slate-300">
                  {selectedColumns.length} {t('reports.selectColumns')} {t('reports.customBuilder.selected')}
                </div>
              )}
            </div>
          )}

          {step === 'filters' && selectedTable && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('reports.selectFilters')}</h3>
                <Button variant="secondary" size="sm" onClick={addFilter}>
                  + {t('reports.filter')}
                </Button>
              </div>
              <div className="space-y-3">
                {filters.map((f, i) => (
                  <div key={i} className="flex flex-wrap gap-2 items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    <select
                      className="px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
                      value={f.column}
                      onChange={(e) => updateFilter(i, 'column', e.target.value)}
                    >
                      {selectedTable.columns.map((c) => (
                        <option key={c.key} value={c.key}>{t(c.label)}</option>
                      ))}
                    </select>
                    <select
                      className="px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
                      value={f.operator}
                      onChange={(e) => updateFilter(i, 'operator', e.target.value)}
                    >
                      <option value="equals">=</option>
                      <option value="contains">{t('reports.customBuilder.contains')}</option>
                      <option value="gt">&gt;</option>
                      <option value="lt">&lt;</option>
                      <option value="gte">&gt;=</option>
                      <option value="lte">&lt;=</option>
                    </select>
                    <input
                      type="text"
                      className="flex-1 min-w-[120px] px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
                      placeholder={t('reports.customBuilder.valuePlaceholder')}
                      value={f.value}
                      onChange={(e) => updateFilter(i, 'value', e.target.value)}
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeFilter(i)}>
                      {t('settings.common.delete')}
                    </Button>
                  </div>
                ))}
                {filters.length === 0 && (
                  <p className="text-sm text-slate-400">{t('reports.customBuilder.noFilters')}</p>
                )}
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('reports.preview')}</h3>
                  <p className="text-sm text-slate-500">{previewData.length} {t('reports.customBuilder.records')}</p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="px-3 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
                    placeholder={t('reports.reportName')}
                    value={reportName}
                    onChange={(e) => setReportName(e.target.value)}
                  />
                  <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel} disabled={isLoading || !canExport}>
                    Excel
                  </Button>
                  <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportPDF} disabled={isLoading || !canExport}>
                    PDF
                  </Button>
                </div>
              </div>
              {isLoading && (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                </div>
              )}
              {!isLoading && error && (
                <div className="p-4 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 text-sm">
                  {error}
                </div>
              )}
              {!isLoading && !error && previewData.length > 0 && (
                <div className="overflow-x-auto">
                  <Table
                    data={previewData.slice(0, 100)}
                    columns={(selectedColumns.length ? selectedColumns : selectedTable!.columns.map((c) => ({ key: c.key, label: c.label }))).map((c) => {
                      const colDef = selectedTable!.columns.find((tc) => tc.key === c.key);
                      const isCurrency = colDef?.type === 'number';
                      return {
                        key: c.key,
                        header: c.label,
                        align: isCurrency ? 'right' : 'left',
                        render: (row: Record<string, unknown>) => {
                          const val = row[c.key];
                          if (val === null || val === undefined) return '-';
                          if (isCurrency && typeof val === 'number') return formatCurrency(val);
                          return String(val);
                        },
                      };
                    })}
                    keyExtractor={(row, i) => `${row.id || i}-${i}`}
                  />
                </div>
              )}
              {!isLoading && !error && previewData.length === 0 && (
                <EmptyState icon="search" title={t('reports.emptyResults.title')} description={t('reports.customBuilder.tryDifferent')} />
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" leftIcon={<ChevronRight size={16} />} onClick={prevStep} disabled={step === 'table'}>
          {t('previous')}
        </Button>
        {step !== 'preview' ? (
          <Button variant="primary" rightIcon={<ChevronLeft size={16} />} onClick={step === 'filters' ? runPreview : nextStep} disabled={!canNext()}>
            {step === 'filters' ? t('reports.preview') : t('next')}
          </Button>
        ) : (
          <Button variant="secondary" leftIcon={<RotateCcw size={16} />} onClick={() => setStep('table')}>
            {t('reports.clearFilter')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default CustomReportBuilder;
