export interface Lead {
  id: string;
  companyId: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  source?: string;
  status: 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';
  rating: 'hot' | 'warm' | 'cold';
  estimatedValue?: number;
  assignedTo?: string;
  assignedName?: string;
  notes?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface Opportunity {
  id: string;
  companyId: string;
  leadId?: string;
  customerId?: string;
  name: string;
  value: number;
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  probability?: number;
  expectedCloseDate?: string;
  assignedTo?: string;
  assignedName?: string;
  notes?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface Task {
  id: string;
  companyId: string;
  opportunityId?: string;
  leadId?: string;
  customerId?: string;
  title: string;
  description?: string;
  dueDate?: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed' | 'cancelled';
  assignedTo?: string;
  assignedName?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}

export interface Activity {
  id: string;
  companyId: string;
  leadId?: string;
  opportunityId?: string;
  customerId?: string;
  type: 'call' | 'meeting' | 'email' | 'visit' | 'note';
  subject: string;
  description?: string;
  activityDate: string;
  durationMinutes?: number;
  assignedTo?: string;
  assignedName?: string;
  createdAt?: string;
  createdBy?: string;
  updatedBy?: string;
}
