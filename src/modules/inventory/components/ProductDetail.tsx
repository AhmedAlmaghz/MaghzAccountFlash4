import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Package, ArrowLeft, Pencil, Barcode, Tag, Box, DollarSign, AlertTriangle, ImageIcon } from 'lucide-react';
import { Card, Button, Badge } from '@/core/ui/components';
import { StatusBadge } from '@/core/ui/components/StatusBadge';
import { useProducts } from '../hooks/useInventory';
import { useProductCategories } from '../hooks/useInventory';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { Product } from '../types';

export interface ProductDetailProps {
  product?: Product;
  onBack?: () => void;
  onEdit?: (product: Product) => void;
}

export const ProductDetail: React.FC<ProductDetailProps> = ({ product: propProduct, onBack, onEdit }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const activeCompany = useAppStore(state => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { products } = useProducts(activeCompany?.id || '');
  const { categories } = useProductCategories(activeCompany?.id || '');

  const product = propProduct || products.find(p => p.id === id);

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Package size={48} className="text-slate-300 mb-4" />
        <h3 className="text-lg font-medium text-slate-500">{t('inventory.productDetails')}</h3>
        <Button variant="secondary" className="mt-4" leftIcon={<ArrowLeft size={16} />} onClick={() => onBack ? onBack() : navigate('/inventory/products')}>
          {t('back')}
        </Button>
      </div>
    );
  }

  const getCategoryName = (catId: string) => {
    const cat = categories.find(c => c.id === catId);
    return cat?.name || catId;
  };

  const stockLevel = product.minStock !== undefined && product.reorderPoint !== undefined
    ? product.quantity !== undefined && product.quantity < product.minStock
      ? 'critical'
      : product.quantity !== undefined && product.quantity < (product.reorderPoint || 0)
      ? 'warning'
      : 'normal'
    : 'normal';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => onBack ? onBack() : navigate('/inventory/products')}>
            <ArrowLeft size={18} />
          </Button>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('inventory.productDetails')}</h1>
        </div>
        <Button variant="primary" size="sm" leftIcon={<Pencil size={16} />} onClick={() => onEdit ? onEdit(product) : navigate(`/inventory/products/edit/${product.id}`)}>
          {t('edit')}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Image & Basic Info */}
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center text-center p-4">
            {product.image ? (
              <img src={product.image} alt={product.nameAr} className="w-40 h-40 rounded-xl object-cover border border-slate-200 dark:border-slate-700 mb-4" />
            ) : (
              <div className="w-40 h-40 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                <ImageIcon size={48} className="text-slate-300" />
              </div>
            )}
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{product.nameAr}</h2>
            <p className="text-slate-500 text-sm">{product.nameEn}</p>
            <div className="mt-3">
              <StatusBadge status={product.isActive ? 'active' : 'inactive'} />
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 mt-4 pt-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 flex items-center gap-2"><Tag size={14} /> {t('inventory.productCode')}</span>
              <span className="font-medium font-mono">{product.code}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 flex items-center gap-2"><Barcode size={14} /> {t('inventory.barcode')}</span>
              <span className="font-medium font-mono">{product.barcode || '-'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500 flex items-center gap-2"><Box size={14} /> {t('inventory.sku')}</span>
              <span className="font-medium">{product.sku || '-'}</span>
            </div>
          </div>
        </Card>

        {/* Right: Details */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('inventory.stockByWarehouse')}</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl">
                <span className="text-slate-500 text-sm block">{t('inventory.costPrice')}</span>
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                  <DollarSign size={20} className="text-emerald-500" />
                  {formatCurrency(product.costPrice)}
                </span>
              </div>
              <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl">
                <span className="text-slate-500 text-sm block">{t('inventory.salePrice')}</span>
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-50 flex items-center gap-2">
                  <DollarSign size={20} className="text-primary-500" />
                  {formatCurrency(product.salePrice)}
                </span>
              </div>
              <div className={`p-4 rounded-xl ${stockLevel === 'critical' ? 'bg-rose-50 dark:bg-rose-900/20' : stockLevel === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-slate-50 dark:bg-slate-800/50'}`}>
                <span className="text-slate-500 text-sm block flex items-center gap-1">
                  {t('inventory.minStock')}
                  {stockLevel === 'critical' && <AlertTriangle size={14} className="text-rose-500" />}
                </span>
                <span className={`text-2xl font-bold ${stockLevel === 'critical' ? 'text-rose-600' : stockLevel === 'warning' ? 'text-amber-600' : 'text-slate-900 dark:text-slate-50'}`}>
                  {product.minStock ?? 0}
                </span>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50 mb-4">{t('inventory.categories')}</h3>
            <div className="flex flex-wrap gap-2">
              {product.categoryIds && product.categoryIds.length > 0 ? (
                product.categoryIds.map(catId => (
                  <Badge key={catId} className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{getCategoryName(catId)}</Badge>
                ))
              ) : (
                <span className="text-slate-400 text-sm">-</span>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ProductDetail;
