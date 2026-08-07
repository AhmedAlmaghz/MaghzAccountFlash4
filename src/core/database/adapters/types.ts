/**
 * Database Adapter Interface
 * All database operations go through this abstraction
 *
 * Note: `any` is used for SQL parameters and arbitrary data shapes because
 * the adapter is a generic abstraction. Callers should use generics when
 * they know the row shape (e.g. `adapter.query<{ id: string }>(...)`).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface DbAdapter {
  // Connection
  ping(): Promise<{ success: boolean; message?: string; db?: string; }>;

  // Generic CRUD
  query<T = any>(sql: string, params?: any[]): Promise<{ success: boolean; rows?: T[]; error?: string }>;
  transaction(queries: { sql: string; params?: any[] }[]): Promise<{ success: boolean; results?: any[]; error?: string }>;

  // Company
  getCompany(): Promise<{ success: boolean; data?: any; error?: string }>;

  // Accounts
  getAccounts(companyId: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  createAccount(data: any): Promise<{ success: boolean; id?: string; error?: string }>;
  // Transactions
  getTransactions(companyId: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  createTransaction(data: any): Promise<{ success: boolean; id?: string; error?: string }>;

  // Products
  getProducts(companyId: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  createProduct(data: any): Promise<{ success: boolean; id?: string; error?: string }>;

  // Contacts (Customers/Suppliers)
  getContacts(companyId: string, type?: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  createContact(data: any): Promise<{ success: boolean; id?: string; error?: string }>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
