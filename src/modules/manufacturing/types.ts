export interface BOM {
id: string;
companyId: string;
productId: string;
productName?: string;
version: string;
isActive: boolean;
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

export interface WorkOrder {
  id: string;
  companyId: string;
  orderNumber: string;
  productId: string;
  productName?: string;
  bomId?: string;
  quantity: number;
  producedQuantity?: number;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  plannedStartDate?: string;
  plannedEndDate?: string;
  actualStartDate?: string;
  actualEndDate?: string;
  totalCost?: number;
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
