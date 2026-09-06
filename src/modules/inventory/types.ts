export interface Product {
  id: string;
  companyId: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  barcode?: string;
  sku?: string;
  unit: string;
  unitName?: string;
  categoryId?: string;
  categoryIds?: string[];
  categoryNames?: Array<{ id: string; name: string }>;
  productTypeId?: string;
  productTypeName?: string;
  costPrice: number;
  salePrice: number;
  isActive: boolean;
  image?: string;
  quantity?: number;
  minStock?: number;
  maxStock?: number;
  reorderPoint?: number;
  /** Opening stock quantity - posted as movement + Dr Inventory / Cr Opening Equity at cost. */
  openingStockQty?: number;
  openingWarehouseId?: string | null;
  openingStockPosted?: boolean;
  createdBy?: string;
  updatedBy?: string;
}

export interface Warehouse {
id: string;
companyId: string;
name: string;
code?: string;
branchId?: string;
isActive: boolean;
createdBy?: string;
updatedBy?: string;
}

export interface Stock {
id: string;
companyId: string;
productId: string;
warehouseId: string;
quantity: number;
minStockAlert?: number;
}

export interface StockItem extends Stock {
productName?: string;
productCode?: string;
warehouseName?: string;
unit?: string;
costPrice?: number;
}

export interface StockMovement {
id: string;
companyId: string;
productId: string;
warehouseId: string;
type: 'in' | 'out' | 'transfer';
quantity: number;
reference?: string;
notes?: string;
createdAt?: string;
createdBy?: string;
updatedBy?: string;
}

export interface StockTransfer {
  id: string;
  companyId: string;
  productId?: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity?: number;
  date: string;
  transferNumber: string;
  reference?: string;
  notes?: string;
  status: 'draft' | 'pending' | 'completed' | 'cancelled';
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
  fromWarehouseName?: string;
  toWarehouseName?: string;
  linesCount?: number;
  totalQuantity?: number;
}

export interface StockTransferLine {
  id: string;
  transferId: string;
  productId: string;
  productName?: string;
  productCode?: string;
  quantity: number;
}

export interface InventoryTransaction {
  id: string;
  companyId: string;
  date: string;
  type: 'in' | 'out' | 'adjustment' | 'transfer';
  productId: string;
  warehouseId: string;
  quantity: number;
  reference: string;
  notes?: string;
  productName?: string;
  productCode?: string;
  warehouseName?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface StockAdjustment {
  id: string;
  companyId: string;
  date: string;
  adjustmentNumber: string;
  productId: string;
  warehouseId: string;
  systemQty: number;
  actualQty: number;
  difference: number;
  reason: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'posted';
  unitCost?: number;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  postedAt?: string;
  productName?: string;
  productCode?: string;
  warehouseName?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface ProductCategory {
id: string;
companyId: string;
name: string;
parentId?: string;
createdBy?: string;
updatedBy?: string;
}

/**
 * One row of a product's units (multi-unit).
 * factor = how many BASE units equal 1 of this unit (carton of 12 → 12).
 * Stock is always stored in the base unit; documents snapshot the factor.
 */
export interface ProductUnit {
  id: string;
  companyId: string;
  productId: string;
  /** Global catalog unit id (units.id). */
  unitId: string;
  /** Resolved display name (units.name_ar → name_en → code). */
  unitName?: string;
  unitCode?: string;
  factor: number;
  salePrice: number;
  purchasePrice: number;
  barcode?: string;
  isBase: boolean;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
  createdBy?: string;
  updatedBy?: string;
}
