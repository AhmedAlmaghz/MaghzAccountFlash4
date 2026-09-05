import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { getDbAdapter } from '@/core/database/adapters';
import { useAppStore } from '@/core/store';
import { Card, Button, Table, PageHeader } from '@/core/ui/components';
import { exportReportExcel, exportReportPdf, exportReportHtml, useReportBranding, type ReportColumnDef, type ReportSpec } from '@/core/reports';
import { Package, Layers, Warehouse, FileDown } from 'lucide-react';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import KpiCardPro from './components/KpiCardPro';

interface ProductValuation {
  id: string;
  nameAr: string;
  sku: string;
  code: string;
  costPrice: number;
  salePrice: number;
  totalQty: number;
  totalCostValue: number;
  totalSaleValue: number;
  categoryName: string;
  potentialProfit: number;
}

interface CategoryValuation {
  categoryName: string;
  productCount: number;
  totalQty: number;
  totalValue: number;
}

interface WarehouseValuation {
  warehouseName: string;
  productCount: number;
  totalQty: number;
  totalValue: number;
}

type ViewMode = 'products' | 'categories' | 'warehouses';

export const StockValuationReport = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  const activeCompany = useAppStore((state) => state.activeCompany);
  const branding = useReportBranding();
  const direction = useAppStore((s) => s.language) === 'en' ? 'ltr' : 'rtl';
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const [isLoading, setIsLoading] = useState(false);
  const [_error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductValuation[]>([]);
  const [categories, setCategories] = useState<CategoryValuation[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseValuation[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('products');

  useEffect(() => {
    if (!activeCompany?.id) return;
    const companyId = activeCompany.id;

    async function load() {
      setIsLoading(true);
      try {
        const adapter = await getDbAdapter();

      const prodResult = await adapter.query(
        `SELECT p.id, p.name_ar, p.sku, p.code, p.cost_price, p.sale_price,
                COALESCE(SUM(s.quantity), 0) as total_qty,
                COALESCE(SUM(s.quantity * p.cost_price), 0) as total_cost_value,
                COALESCE(SUM(s.quantity * p.sale_price), 0) as total_sale_value,
                COALESCE(MAX(pc.name), '') as category_name
           FROM products p
           LEFT JOIN stock s ON s.product_id = p.id
           LEFT JOIN product_product_categories ppc ON ppc.product_id = p.id
           LEFT JOIN product_categories pc ON ppc.category_id = pc.id
          WHERE p.company_id = $1 AND p.is_active = true
          GROUP BY p.id, p.name_ar, p.sku, p.code, p.cost_price, p.sale_price
          ORDER BY total_cost_value DESC`,
        [companyId],
      );

      const prodRows = (prodResult.rows || []) as Record<string, unknown>[];
      setProducts(
        prodRows.map((r) => ({
          id: String(r.id || ''),
          nameAr: String(r.name_ar || ''),
          sku: String(r.sku || ''),
          code: String(r.code || ''),
          costPrice: Number(r.cost_price || 0),
          salePrice: Number(r.sale_price || 0),
          totalQty: Number(r.total_qty || 0),
          totalCostValue: Number(r.total_cost_value || 0),
          totalSaleValue: Number(r.total_sale_value || 0),
          categoryName: String(r.category_name || ''),
          potentialProfit: Number(r.total_sale_value || 0) - Number(r.total_cost_value || 0),
        })),
      );

      const catResult = await adapter.query(
        `SELECT COALESCE(pc.name, '') as category_name,
                COUNT(DISTINCT p.id) as product_count,
                COALESCE(SUM(s.quantity), 0) as total_qty,
                COALESCE(SUM(s.quantity * p.cost_price), 0) as total_value
           FROM products p
           LEFT JOIN stock s ON s.product_id = p.id
           LEFT JOIN product_product_categories ppc ON ppc.product_id = p.id
           LEFT JOIN product_categories pc ON ppc.category_id = pc.id
          WHERE p.company_id = $1 AND p.is_active = true
          GROUP BY pc.name
          ORDER BY total_value DESC`,
        [companyId],
      );

      const catRows = (catResult.rows || []) as Record<string, unknown>[];
      setCategories(
        catRows.map((r) => ({
          categoryName: String(r.category_name || ''),
          productCount: Number(r.product_count || 0),
          totalQty: Number(r.total_qty || 0),
          totalValue: Number(r.total_value || 0),
        })),
      );

      const whResult = await adapter.query(
        `SELECT w.name as warehouse_name,
                COUNT(DISTINCT s.product_id) as product_count,
                COALESCE(SUM(s.quantity), 0) as total_qty,
                COALESCE(SUM(s.quantity * p.cost_price), 0) as total_value
           FROM warehouses w
           LEFT JOIN stock s ON s.warehouse_id = w.id
           LEFT JOIN products p ON s.product_id = p.id AND p.company_id = $1
          WHERE w.company_id = $1 AND w.is_active = true
          GROUP BY w.name
          ORDER BY total_value DESC`,
        [companyId],
      );

      const whRows = (whResult.rows || []) as Record<string, unknown>[];
      setWarehouses(
        whRows.map((r) => ({
          warehouseName: String(r.warehouse_name || ''),
          productCount: Number(r.product_count || 0),
          totalQty: Number(r.total_qty || 0),
          totalValue: Number(r.total_value || 0),
        })),
      );

      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stock valuation');
        setProducts([]);
        setCategories([]);
        setWarehouses([]);
      } finally {
        setIsLoading(false);
      }
    }

    load();
  }, [activeCompany?.id]);

  const totalCostValue = products.reduce((s, p) => s + p.totalCostValue, 0);
  const totalSaleValue = products.reduce((s, p) => s + p.totalSaleValue, 0);
  const totalQty = products.reduce((s, p) => s + p.totalQty, 0);
  const activeProductCount = products.length;

  const buildSpec = useCallback((): ReportSpec => {
    let data: Record<string, unknown>[];
    let columns: ReportColumnDef[];
    let filename: string;
    let totals: ReportSpec['totals'];

    if (viewMode === 'products') {
      data = products.map((p) => ({
        product: p.nameAr,
        sku: p.sku,
        category: p.categoryName,
        quantity: p.totalQty,
        costPrice: p.costPrice,
        salePrice: p.salePrice,
        costValue: p.totalCostValue,
        saleValue: p.totalSaleValue,
        profit: p.potentialProfit,
      }));
      columns = [
        { key: 'product', header: t('reports.product') },
        { key: 'sku', header: t('reports.sku') },
        { key: 'category', header: t('reports.category') },
        { key: 'quantity', header: t('reports.quantity'), format: 'quantity' },
        { key: 'costPrice', header: t('reports.cost'), format: 'money' },
        { key: 'salePrice', header: t('reports.revenue'), format: 'money' },
        { key: 'costValue', header: t('reports.amount'), format: 'money' },
        { key: 'saleValue', header: t('reports.revenue'), format: 'money' },
        { key: 'profit', header: t('reports.profit'), format: 'money' },
      ];
      filename = 'Stock_Valuation_Products';
      totals = {
        label: t('reports.total'),
        values: { quantity: totalQty, costValue: totalCostValue, saleValue: totalSaleValue },
      };
    } else if (viewMode === 'categories') {
      data = categories.map((c) => ({
        category: c.categoryName,
        productCount: c.productCount,
        quantity: c.totalQty,
        value: c.totalValue,
      }));
      columns = [
        { key: 'category', header: t('reports.category') },
        { key: 'productCount', header: t('reports.count'), format: 'quantity' },
        { key: 'quantity', header: t('reports.quantity'), format: 'quantity' },
        { key: 'value', header: t('reports.total'), format: 'money' },
      ];
      filename = 'Stock_Valuation_Categories';
      totals = {
        label: t('reports.total'),
        values: { value: categories.reduce((s, c) => s + c.totalValue, 0) },
      };
    } else {
      data = warehouses.map((w) => ({
        warehouse: w.warehouseName,
        productCount: w.productCount,
        quantity: w.totalQty,
        value: w.totalValue,
      }));
      columns = [
        { key: 'warehouse', header: t('reports.warehouse') },
        { key: 'productCount', header: t('reports.count'), format: 'quantity' },
        { key: 'quantity', header: t('reports.quantity'), format: 'quantity' },
        { key: 'value', header: t('reports.total'), format: 'money' },
      ];
      filename = 'Stock_Valuation_Warehouses';
      totals = {
        label: t('reports.total'),
        values: { value: warehouses.reduce((s, w) => s + w.totalValue, 0) },
      };
    }

    return {
      columns,
      rows: data,
      meta: {
        title: t('reports.stockValuation'),
        subtitle: branding.companyName,
        direction,
      },
      branding,
      filename,
      totals,
    };
  }, [viewMode, products, categories, warehouses, t, totalQty, totalCostValue, totalSaleValue, branding, direction]);

  const handleExportExcel = useCallback(async () => {
    await exportReportExcel(buildSpec());
  }, [buildSpec]);

  const handleExportPDF = useCallback(async () => {
    await exportReportPdf(buildSpec());
  }, [buildSpec]);

  const handleExportHtml = useCallback(() => exportReportHtml(buildSpec()), [buildSpec]);

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Package size={48} className="mx-auto mb-4 text-slate-400" />
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

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={<Package size={22} />}
        title={t('reports.stockValuation')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportExcel} disabled={!canExport}>
              {t('reports.exportExcel')}
            </Button>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportPDF} disabled={!canExport}>
              {t('reports.exportPdf')}
            </Button>
            <Button variant="secondary" leftIcon={<FileDown size={16} />} onClick={handleExportHtml} disabled={!canExport}>
              {t('reports.exportHtml')}
            </Button>
          </>
        }
      />

      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'products' as const, label: t('reports.product') },
          { key: 'categories' as const, label: t('reports.category') },
          { key: 'warehouses' as const, label: t('reports.warehouse') },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setViewMode(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
              viewMode === tab.key
                ? 'bg-primary-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCardPro
          title={t('reports.total')}
          value={formatCurrency(totalCostValue)}
          icon={Package}
          color="blue"
        />
        <KpiCardPro
          title={t('reports.revenue')}
          value={formatCurrency(totalSaleValue)}
          icon={Package}
          color="emerald"
        />
        <KpiCardPro
          title={t('reports.quantity')}
          value={totalQty.toLocaleString()}
          icon={Layers}
          color="purple"
        />
        <KpiCardPro
          title={t('reports.productsCount')}
          value={activeProductCount.toLocaleString()}
          icon={Warehouse}
          color="amber"
        />
      </div>

      <Card>
        <div className="p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">
            {viewMode === 'products'
              ? t('reports.product')
              : viewMode === 'categories'
              ? t('reports.category')
              : t('reports.warehouse')}
          </h3>

          {viewMode === 'products' && (
            <Table
              data={products}
              columns={[
                { key: 'nameAr', header: t('reports.product'), mobile: 'title' as const },
                { key: 'sku', header: t('reports.sku'), mobile: 'subtitle' as const },
                { key: 'categoryName', header: t('reports.category'), mobile: 'hidden' as const },
                { key: 'totalQty', header: t('reports.quantity'), align: 'right', mobile: 'meta' as const, render: (row: ProductValuation) => row.totalQty.toLocaleString() },
                { key: 'costPrice', header: t('reports.cost'), align: 'right', mobile: 'hidden' as const, render: (row: ProductValuation) => formatCurrency(row.costPrice) },
                { key: 'salePrice', header: t('reports.revenue'), align: 'right', mobile: 'hidden' as const, render: (row: ProductValuation) => formatCurrency(row.salePrice) },
                { key: 'totalCostValue', header: t('reports.total'), align: 'right', render: (row: ProductValuation) => formatCurrency(row.totalCostValue) },
                { key: 'totalSaleValue', header: t('reports.revenue'), align: 'right', mobile: 'hidden' as const, render: (row: ProductValuation) => formatCurrency(row.totalSaleValue) },
                {
                  key: 'potentialProfit',
                  header: t('reports.profit'),
                  align: 'right',
                  render: (row: ProductValuation) => (
                    <span className={row.potentialProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                      {formatCurrency(row.potentialProfit)}
                    </span>
                  ),
                },
              ]}
              keyExtractor={(row: ProductValuation) => row.id}
            />
          )}

          {viewMode === 'categories' && (
            <Table
              data={categories}
              columns={[
                { key: 'categoryName', header: t('reports.category'), mobile: 'title' as const },
                { key: 'productCount', header: t('reports.count'), align: 'right', mobile: 'hidden' as const },
                { key: 'totalQty', header: t('reports.quantity'), align: 'right', mobile: 'meta' as const, render: (row: CategoryValuation) => row.totalQty.toLocaleString() },
                { key: 'totalValue', header: t('reports.total'), align: 'right', mobile: 'subtitle' as const, render: (row: CategoryValuation) => formatCurrency(row.totalValue) },
              ]}
              keyExtractor={(_row: CategoryValuation, i: number) => `cat-${i}`}
            />
          )}

          {viewMode === 'warehouses' && (
            <Table
              data={warehouses}
              columns={[
                { key: 'warehouseName', header: t('reports.warehouse'), mobile: 'title' as const },
                { key: 'productCount', header: t('reports.count'), align: 'right', mobile: 'hidden' as const },
                { key: 'totalQty', header: t('reports.quantity'), align: 'right', mobile: 'meta' as const, render: (row: WarehouseValuation) => row.totalQty.toLocaleString() },
                { key: 'totalValue', header: t('reports.total'), align: 'right', mobile: 'subtitle' as const, render: (row: WarehouseValuation) => formatCurrency(row.totalValue) },
              ]}
              keyExtractor={(_row: WarehouseValuation, i: number) => `wh-${i}`}
            />
          )}
        </div>
      </Card>
    </div>
  );
};

export default StockValuationReport;
