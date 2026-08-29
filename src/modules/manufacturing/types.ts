export interface BOM {
id: string;
companyId: string;
productId: string;
productName?: string;
version: string;
isActive: boolean;
/** How many finished-product units one BOM batch yields (default 1). */
outputQuantity?: number;
totalCost?: number;
notes?: string;
linesCount?: number;
createdBy?: string;
updatedBy?: string;
updatedAt?: string;
}

export interface BOMLine {
id: string;
bomId: string;
materialId: string;
materialName?: string;
quantity: number;
unitCost?: number;
totalCost?: number;
}

export type ProductionCostCategory = 'labor' | 'energy' | 'packaging' | 'other';

export interface ProductionCost {
  category: ProductionCostCategory;
  description?: string;
  amount: number;
}

export interface WorkOrder {
  id: string;
  companyId: string;
  orderNumber: string;
  productId: string;
  productName?: string;
  bomId?: string;
  /** Number of BOM batches to produce; expected output = quantity × BOM.outputQuantity. */
  quantity: number;
  producedQuantity?: number;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  plannedStartDate?: string;
  plannedEndDate?: string;
  actualStartDate?: string;
  actualEndDate?: string;
  totalCost?: number;
  outputWarehouseId?: string;
  batchNumber?: string;
  supervisorId?: string;
  supervisorName?: string;
  /** BOM output quantity per batch (joined for expected-output math). */
  bomOutputQuantity?: number;
  /** Labor / energy / packaging / other costs — capitalized into product cost on completion. */
  productionCosts?: ProductionCost[];
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface WorkOrderLine {
id: string;
workOrderId: string;
  materialId: string;
  materialName?: string;
  plannedQuantity: number;
  actualQuantity?: number;
  unitCost: number;
  actualUnitCost?: number;
}

export interface WorkOrderVariance {
materialName: string;
plannedQty: number;
actualQty: number;
varianceQty: number;
plannedCost: number;
actualCost: number;
varianceCost: number;
}
