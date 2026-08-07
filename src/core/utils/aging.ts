import type { DbAdapter } from '@/core/database/adapters/types';

export interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
}

export const AGING_BUCKETS: AgingBucket[] = [
  { label: '0-30', minDays: 0, maxDays: 30 },
  { label: '31-60', minDays: 31, maxDays: 60 },
  { label: '61-90', minDays: 61, maxDays: 90 },
  { label: '90+', minDays: 91, maxDays: null },
];

export interface CustomerAging {
  customerId: string;
  customer: string;
  phone: string;
  totalOutstanding: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket90plus: number;
  invoiceCount: number;
  lastInvoice: string | null;
}

export interface SupplierAging {
  supplierId: string;
  supplier: string;
  phone: string;
  totalOutstanding: number;
  bucket0to30: number;
  bucket31to60: number;
  bucket61to90: number;
  bucket90plus: number;
  invoiceCount: number;
  lastInvoice: string | null;
}

interface OutstandingRow {
  customer_id?: string;
  supplier_id?: string;
  date: string;
  due_date: string | null;
  outstanding: number;
  invoice_number: string;
}

function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function bucketFor(daysPast: number): number {
  if (daysPast <= 30) return 0;
  if (daysPast <= 60) return 1;
  if (daysPast <= 90) return 2;
  return 3;
}

export interface AgingTotals {
  total0to30: number;
  total31to60: number;
  total61to90: number;
  total90plus: number;
  totalOutstanding: number;
  count0to30: number;
  count31to60: number;
  count61to90: number;
  count90plus: number;
}

export function computeAgingTotals<T extends { totalOutstanding: number; bucket0to30: number; bucket31to60: number; bucket61to90: number; bucket90plus: number }>(rows: T[]): AgingTotals {
  const totals: AgingTotals = {
    total0to30: 0,
    total31to60: 0,
    total61to90: 0,
    total90plus: 0,
    totalOutstanding: 0,
    count0to30: 0,
    count31to60: 0,
    count61to90: 0,
    count90plus: 0,
  };
  for (const r of rows) {
    totals.total0to30 += r.bucket0to30;
    totals.total31to60 += r.bucket31to60;
    totals.total61to90 += r.bucket61to90;
    totals.total90plus += r.bucket90plus;
    totals.totalOutstanding += r.totalOutstanding;
    if (r.bucket0to30 > 0) totals.count0to30++;
    if (r.bucket31to60 > 0) totals.count31to60++;
    if (r.bucket61to90 > 0) totals.count61to90++;
    if (r.bucket90plus > 0) totals.count90plus++;
  }
  return totals;
}

export function aggregateCustomerAging(
  rows: OutstandingRow[],
  asOfDate: string,
  customers: Array<{ id: string; name: string; phone: string; balance: number }>,
): CustomerAging[] {
  const byCustomer = new Map<string, CustomerAging>();
  for (const c of customers) {
    byCustomer.set(String(c.id), {
      customerId: String(c.id),
      customer: c.name,
      phone: c.phone || '',
      totalOutstanding: 0,
      bucket0to30: 0,
      bucket31to60: 0,
      bucket61to90: 0,
      bucket90plus: 0,
      invoiceCount: 0,
      lastInvoice: null,
    });
  }
  for (const r of rows) {
    const cid = String(r.customer_id || '');
    if (!cid) continue;
    let entry = byCustomer.get(cid);
    if (!entry) {
      entry = {
        customerId: cid,
        customer: '',
        phone: '',
        totalOutstanding: 0,
        bucket0to30: 0,
        bucket31to60: 0,
        bucket61to90: 0,
        bucket90plus: 0,
        invoiceCount: 0,
        lastInvoice: null,
      };
      byCustomer.set(cid, entry);
    }
    const outstanding = Number(r.outstanding);
    if (outstanding <= 0) continue;
    entry.totalOutstanding += outstanding;
    entry.invoiceCount++;
    const dueDate = r.due_date || r.date;
    const daysPast = Math.max(0, daysBetween(dueDate, asOfDate));
    const idx = bucketFor(daysPast);
    if (idx === 0) entry.bucket0to30 += outstanding;
    else if (idx === 1) entry.bucket31to60 += outstanding;
    else if (idx === 2) entry.bucket61to90 += outstanding;
    else entry.bucket90plus += outstanding;
    if (!entry.lastInvoice || r.date > entry.lastInvoice) {
      entry.lastInvoice = r.date;
    }
  }
  return Array.from(byCustomer.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}

export function aggregateSupplierAging(
  rows: OutstandingRow[],
  asOfDate: string,
  suppliers: Array<{ id: string; name: string; phone: string; balance: number }>,
): SupplierAging[] {
  const bySupplier = new Map<string, SupplierAging>();
  for (const s of suppliers) {
    bySupplier.set(String(s.id), {
      supplierId: String(s.id),
      supplier: s.name,
      phone: s.phone || '',
      totalOutstanding: 0,
      bucket0to30: 0,
      bucket31to60: 0,
      bucket61to90: 0,
      bucket90plus: 0,
      invoiceCount: 0,
      lastInvoice: null,
    });
  }
  for (const r of rows) {
    const sid = String(r.supplier_id || '');
    if (!sid) continue;
    let entry = bySupplier.get(sid);
    if (!entry) {
      entry = {
        supplierId: sid,
        supplier: '',
        phone: '',
        totalOutstanding: 0,
        bucket0to30: 0,
        bucket31to60: 0,
        bucket61to90: 0,
        bucket90plus: 0,
        invoiceCount: 0,
        lastInvoice: null,
      };
      bySupplier.set(sid, entry);
    }
    const outstanding = Number(r.outstanding);
    if (outstanding <= 0) continue;
    entry.totalOutstanding += outstanding;
    entry.invoiceCount++;
    const dueDate = r.due_date || r.date;
    const daysPast = Math.max(0, daysBetween(dueDate, asOfDate));
    const idx = bucketFor(daysPast);
    if (idx === 0) entry.bucket0to30 += outstanding;
    else if (idx === 1) entry.bucket31to60 += outstanding;
    else if (idx === 2) entry.bucket61to90 += outstanding;
    else entry.bucket90plus += outstanding;
    if (!entry.lastInvoice || r.date > entry.lastInvoice) {
      entry.lastInvoice = r.date;
    }
  }
  return Array.from(bySupplier.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
}

export function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

export function parseOutstandingRows(result: { rows?: unknown[] } | Awaited<ReturnType<DbAdapter['query']>>): OutstandingRow[] {
  return ((result.rows || []) as OutstandingRow[]);
}
