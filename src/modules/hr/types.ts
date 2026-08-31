export interface Employee {
id: string;
companyId: string;
employeeNumber: string;
fullName: string;
nationalId?: string;
phone?: string;
email?: string;
address?: string;
departmentId?: string;
departmentName?: string;
position?: string;
grade?: string;
hireDate?: string;
terminationDate?: string;
baseSalary?: number;
/** Opening balance = advances/loans receivable from the employee - posted via Opening Balance Equity. */
openingBalance?: number;
openingBalancePosted?: boolean;
isActive: boolean;
photoUrl?: string;
attachments?: string[];
createdBy?: string;
updatedBy?: string;
}

export interface AttendanceRecord {
id: string;
companyId: string;
employeeId: string;
employeeName?: string;
date: string;
checkIn?: string;
checkOut?: string;
overtimeHours?: number;
status: 'present' | 'absent' | 'late' | 'on_leave';
notes?: string;
createdBy?: string;
updatedBy?: string;
}

export interface PayrollLine {
id: string;
payrollRunId: string;
employeeId: string;
employeeName: string;
baseSalary: number;
allowances: number;
deductions: number;
overtime: number;
netSalary: number;
}

export interface PayrollRun {
id: string;
companyId: string;
month: number;
year: number;
totalAmount: number;
status: 'draft' | 'posted';
runNumber?: string;
lines: PayrollLine[];
notes?: string;
createdBy?: string;
updatedBy?: string;
}

export interface Leave {
id: string;
companyId: string;
employeeId: string;
employeeName?: string;
leaveType: 'annual' | 'sick' | 'emergency' | 'unpaid';
startDate: string;
endDate: string;
days: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
approvedBy?: string;
approvedAt?: string;
reason?: string;
createdBy?: string;
updatedBy?: string;
}

export interface EndOfService {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName?: string;
  terminationDate: string;
  serviceYears: number;
  lastSalary: number;
  eosAmount: number;
  reason: 'resignation' | 'termination' | 'contract_end' | 'retirement';
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
  /** Cash box used to settle the payment (set at payEndOfService). */
  cashBoxId?: string;
  paidAt?: string;
  notes?: string;
  createdBy?: string;
  updatedBy?: string;
}
