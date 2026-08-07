import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AlertTriangle, Package, FileDown, Search, ShoppingCart } from 'lucide-react';
import { Card, Button, Table } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { exportToExcel } from '@/core/utils/exportEngine';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import KpiCardPro from './components/KpiCardPro';

interface LowStockItem {
  id: string;
  productName: string;
  productNameEn: string;
  sku: string;
  code: string;
  warehouseName: string;
  warehouseId: string;
  quantity: number;
  minStockAlert: number;
  deficit: number;
  stockStatus: 'out' | 'low';
  costPrice: number;
  salePrice: number;
  valueAtRisk: number;
}

interface WarehouseOption {
  id: string;
  name: string;
}

export const LowStockAlertReport: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);

  const [items, setItems] = useState<LowStockItem[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warehouseFilter, setWarehouseFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!activeCompany?.id) return;
    const cid = activeCompany.id;
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const adapter = await getDbAdapter();

        const [dataResult, whResult] = await Promise.all([
          adapter.query(
            `SELECT p.id, p.name_ar, p.name_en, p.sku, p.code, p.cost_price, p.sale_price,
                    s.product_id, s.warehouse_id, s.quantity, s.min_stock_alert,
                    w.name AS warehouse_name,
                    (s.quantity - COALESCE(s.min_stock_alert, 0)) AS deficit,
                    CASE WHEN s.quantity = 0 THEN 'out'
                         WHEN s.quantity <= COALESCE(s.min_stock_alert, 0) THEN 'low'
                         ELSE 'good' END AS stock_status
               FROM stock s
               JOIN products p ON s.product_id = p.id AND p.company_id = $1 AND p.is_active = true
               LEFT JOIN warehouses w ON s.warehouse_id = w.id
              WHERE s.quantity <= COALESCE(s.min_stock_alert, 0)
              ORDER BY (CASE WHEN s.min_stock_alert > 0 THEN s.quantity::numeric / s.min_stock_alert ELSE 0 END) ASC`,
            [cid],
          ),
          adapter.query(
            'SELECT id, name FROM warehouses WHERE company_id = $1 AND is_active = true ORDER BY name',
            [cid],
          ),
        ]);

        const rows: LowStockItem[] = (dataResult.rows || []).map((r: Record<string, unknown>) => {
          const qty = Number(r.quantity || 0);
          const min = Number(r.min_stock_alert || 0);
          const deficit = Number(r.deficit || 0);
          const cost = Number(r.cost_price || 0);
          return {
            id: String(r.id || ''),
            productName: String(r.name_ar || ''),
            productNameEn: String(r.name_en || ''),
            sku: String(r.sku || ''),
            code: String(r.code || ''),
            warehouseName: String(r.warehouse_name || ''),
            warehouseId: String(r.warehouse_id || ''),
            quantity: qty,
            minStockAlert: min,
            deficit,
            stockStatus: qty === 0 ? 'out' : 'low',
            costPrice: cost,
            salePrice: Number(r.sale_price || 0),
            valueAtRisk: Math.abs(deficit) * cost,
          };
        });
        setItems(rows);
        setWarehouses((whResult.rows || []).map((r: Record<string, unknown>) => ({
          id: String(r.id),
          name: String(r.name),
        })));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [activeCompany?.id]);

  const filteredItems = useMemo(() => {
    let data = [...items];
    if (warehouseFilter) {
      data = data.filter((i) => i.warehouseId === warehouseFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      data = data.filter(
        (i) =>
          i.productName.toLowerCase().includes(q) ||
          i.productNameEn.toLowerCase().includes(q) ||
          i.sku.toLowerCase().includes(q) ||
          i.code.toLowerCase().includes(q),
      );
    }
    return data;
  }, [items, warehouseFilter, searchQuery]);

  const lowStockCount = items.filter((i) => i.stockStatus === 'low').length;
  const outOfStockCount = items.filter((i) => i.stockStatus === 'out').length;
  const totalDeficit = items.reduce((s, i) => s + i.deficit, 0);
  const atRiskCount = items.filter((i) => {
    if (i.minStockAlert <= 0) return false;
    const ratio = i.quantity / i.minStockAlert;
    return ratio > 0.9 && ratio <= 1;
  }).length;

  const handleExportExcel = useCallback(async () => {
    const cols = [
      { key: 'productName', header: t('reports.product') },
      { key: 'sku', header: t('reports.sku') },
      { key: 'warehouseName', header: t('reports.warehouse') },
      { key: 'quantity', header: t('reports.quantity') },
      { key: 'minStockAlert', header: t('reports.minStock') },
      { key: 'deficit', header: t('reports.deficit') },
      { key: 'stockStatus', header: t('reports.status') },
      { key: 'costPrice', header: t('reports.costPrice') },
      { key: 'valueAtRisk', header: t('reports.valueAtRisk') },
    ];
    await exportToExcel(filteredItems, cols, 'Low_Stock_Alert');
  }, [filteredItems, t]);

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertTriangle size={48} className="mx-auto mb-4 text-slate-400" />
          <p className="text-lg font-medium text-slate-700 dark:text-slate-200">{t('reports.noPermission')}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center text-danger-600 dark:text-danger-400">
          <AlertTriangle size={48} className="mx-auto mb-4" />
          <p className="text-lg font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Package size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">
              {t('reports.lowStockAlert')}
            </h1>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="secondary"
            leftIcon={<ShoppingCart size={16} />}
            onClick={() => window.location.href = '/purchases/orders'}
          >
            {t('reports.purchaseOrder')}
          </Button>
          <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel} disabled={!canExport}>
            {t('reports.exportExcel')}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCardPro
          title={t('reports.lowStockItems')}
          value={lowStockCount}
          icon={AlertTriangle}
          color="amber"
        />
        <KpiCardPro
          title={t('reports.outOfStock')}
          value={outOfStockCount}
          icon={Package}
          color="rose"
        />
        <KpiCardPro
          title={t('reports.totalDeficit')}
          value={totalDeficit.toLocaleString()}
          icon={Package}
          color="blue"
        />
        <KpiCardPro
          title={t('reports.atRisk')}
          value={atRiskCount}
          icon={AlertTriangle}
          color="emerald"
        />
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              {t('reports.search')}
            </label>
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('reports.searchProduct')}
                className="w-full px-3 py-2 pr-9 text-sm border rounded-lg dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
              />
            </div>
          </div>
          <div className="min-w-[180px]">
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              {t('reports.warehouse')}
            </label>
            <select
              value={warehouseFilter}
              onChange={(e) => setWarehouseFilter(e.target.value)}
              className="w-full px-3 py-2 text-sm border rounded-lg dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 outline-none"
            >
              <option value="">{t('reports.allWarehouses')}</option>
              {warehouses.map((wh) => (
                <option key={wh.id} value={wh.id}>{wh.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card>
        <div className="p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">
            {t('reports.lowStockDetails')} ({filteredItems.length})
          </h3>
          <Table
            data={filteredItems}
            columns={[
              { key: 'productName', header: t('reports.product') },
              { key: 'sku', header: t('reports.sku') },
              { key: 'warehouseName', header: t('reports.warehouse') },
              { key: 'quantity', header: t('reports.quantity'), align: 'right' },
              { key: 'minStockAlert', header: t('reports.minStock'), align: 'right' },
              { key: 'deficit', header: t('reports.deficit'), align: 'right' },
              {
                key: 'stockStatus',
                header: t('reports.status'),
                render: (row: LowStockItem) => (
                  <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${
                    row.stockStatus === 'out'
                      ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                      : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                  }`}>
                    {row.stockStatus === 'out' ? t('reports.out') : t('reports.low')}
                  </span>
                ),
              },
              {
                key: 'costPrice',
                header: t('reports.costPrice'),
                align: 'right',
                render: (row: LowStockItem) => formatCurrency(row.costPrice),
              },
              {
                key: 'valueAtRisk',
                header: t('reports.valueAtRisk'),
                align: 'right',
                render: (row: LowStockItem) => formatCurrency(row.valueAtRisk),
              },
            ]}
            keyExtractor={(row, i) => `${row.id}-${i}`}
          />
        </div>
      </Card>
    </div>
  );
};

export default LowStockAlertReport;
