export type UserRole = 'admin' | 'user';
export type TransactionType = 'income' | 'expense';

export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
  role: UserRole;
  created_at?: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: TransactionType;
  category: string;
  amount: number;
  note: string | null;
  transaction_date: string;
  created_at?: string;
}

export interface ValidatedTransactionInput {
  type: TransactionType;
  category: string;
  amount: number;
  note: string | null;
  transaction_date: string;
}

export interface JWTPayload {
  sub: string;
  email: string;
  name: string;
  picture?: string | null;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface Env {
  DB: D1Database;
  JWT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  ENVIRONMENT?: string;
  ASSETS?: Fetcher;
  GEMINI_API_KEY?: string;
  LINE_CHANNEL_ID?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
}

export interface SummaryData {
  total_income: number;
  total_expense: number;
  general_expense: number;
  total_savings_invest: number;
  balance: number; // Net Savings = total_income - general_expense (เงินออม/เงินลงทุน ไม่ถูกนำไปหักลบ)
  net_worth: number; // Cash Balance + Total Investments Current Value
  total_investments_principal: number;
  total_investments_current: number;
  total_investments_pl: number;
  total_investments_pl_pct: number;
  category_breakdown: {
    income: Record<string, number>;
    expense: Record<string, number>;
  };
  monthly_trend: Array<{
    month: string;
    income: number;
    expense: number;
    net?: number;
  }>;
  recent_count: number;
}

export interface AdminStats {
  total_users: number;
  total_transactions: number;
  total_volume_income: number;
  total_volume_expense: number;
  net_system_balance: number;
  recent_registered_users: User[];
}

export interface Trip {
  id: string;
  user_id: string;
  name: string;
  destination: string | null;
  start_date: string;
  end_date: string;
  budget: number;
  status: 'active' | 'completed';
  total_spent?: number;
  remaining_budget?: number;
  created_at?: string;
}

export interface TripExpense {
  id: string;
  trip_id: string;
  user_id: string;
  category: string;
  amount: number;
  note: string | null;
  expense_date: string;
  created_at?: string;
}

export interface Investment {
  id: string;
  user_id: string;
  name: string;
  institution: string;
  asset_type: string;
  principal: number;
  current_value: number;
  note: string | null;
  profit_loss?: number;
  profit_loss_pct?: number;
  updated_at?: string;
  created_at?: string;
}

export interface LineUser {
  line_user_id: string;
  user_id: string;
  display_name: string | null;
  picture_url: string | null;
  created_at?: string;
}

export interface LineLinkToken {
  token: string;
  user_id: string;
  expires_at: string;
  created_at?: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}
