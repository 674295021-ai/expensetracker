// Transactions Data Access Layer (Skill 04 Database Design & 09 OWASP)

import { Transaction, SummaryData, AdminStats, ValidatedTransactionInput } from '../types';

export interface TransactionFilter {
  type?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function createTransaction(
  db: D1Database,
  userId: string,
  data: ValidatedTransactionInput
): Promise<Transaction> {
  const id = crypto.randomUUID();
  const query = `
    INSERT INTO transactions (id, user_id, type, category, amount, note, transaction_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id, user_id, type, category, amount, note, transaction_date, created_at;
  `;
  const stmt = db.prepare(query);
  const result = await stmt
    .bind(id, userId, data.type, data.category, data.amount, data.note, data.transaction_date)
    .first<Transaction>();

  if (!result) {
    throw new Error('Failed to create transaction');
  }

  return result;
}

export async function getTransactionById(
  db: D1Database,
  id: string,
  userId?: string
): Promise<Transaction | null> {
  let query = 'SELECT id, user_id, type, category, amount, note, transaction_date, created_at FROM transactions WHERE id = ?';
  const bindings: unknown[] = [id];

  if (userId) {
    query += ' AND user_id = ?';
    bindings.push(userId);
  }

  const stmt = db.prepare(query);
  const result = await stmt.bind(...bindings).first<Transaction>();
  return result || null;
}

export async function getTransactions(
  db: D1Database,
  userId: string,
  filter: TransactionFilter = {}
): Promise<{ transactions: Transaction[]; total: number }> {
  const whereClauses: string[] = ['user_id = ?'];
  const bindings: unknown[] = [userId];

  if (filter.type && (filter.type === 'income' || filter.type === 'expense')) {
    whereClauses.push('type = ?');
    bindings.push(filter.type);
  }

  if (filter.category) {
    whereClauses.push('category = ?');
    bindings.push(filter.category);
  }

  if (filter.startDate) {
    whereClauses.push('transaction_date >= ?');
    bindings.push(filter.startDate);
  }

  if (filter.endDate) {
    whereClauses.push('transaction_date <= ?');
    bindings.push(filter.endDate);
  }

  if (filter.search) {
    whereClauses.push('(category LIKE ? OR note LIKE ?)');
    const searchTerm = `%${filter.search}%`;
    bindings.push(searchTerm, searchTerm);
  }

  const whereSql = whereClauses.join(' AND ');

  // Get total count
  const countQuery = `SELECT COUNT(*) as count FROM transactions WHERE ${whereSql}`;
  const countStmt = db.prepare(countQuery);
  const countRow = await countStmt.bind(...bindings).first<{ count: number }>();
  const total = countRow ? countRow.count : 0;

  // Get paginated rows
  const limit = Math.min(Math.max(filter.limit || 50, 1), 100);
  const offset = Math.max(filter.offset || 0, 0);

  const dataQuery = `
    SELECT id, user_id, type, category, amount, note, transaction_date, created_at
    FROM transactions
    WHERE ${whereSql}
    ORDER BY transaction_date DESC, created_at DESC
    LIMIT ? OFFSET ?;
  `;
  const dataStmt = db.prepare(dataQuery);
  const { results } = await dataStmt.bind(...bindings, limit, offset).all<Transaction>();

  return {
    transactions: results || [],
    total,
  };
}

export async function updateTransaction(
  db: D1Database,
  id: string,
  userId: string,
  data: ValidatedTransactionInput
): Promise<Transaction | null> {
  const query = `
    UPDATE transactions
    SET type = ?, category = ?, amount = ?, note = ?, transaction_date = ?
    WHERE id = ? AND user_id = ?
    RETURNING id, user_id, type, category, amount, note, transaction_date, created_at;
  `;
  const stmt = db.prepare(query);
  const result = await stmt
    .bind(data.type, data.category, data.amount, data.note, data.transaction_date, id, userId)
    .first<Transaction>();

  return result || null;
}

export async function deleteTransaction(
  db: D1Database,
  id: string,
  userId: string
): Promise<boolean> {
  const query = 'DELETE FROM transactions WHERE id = ? AND user_id = ?';
  const stmt = db.prepare(query);
  const result = await stmt.bind(id, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function getUserSummary(db: D1Database, userId: string): Promise<SummaryData> {
  // Aggregate totals
  const totalQuery = `
    SELECT 
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense,
      COALESCE(SUM(CASE WHEN type = 'expense' AND (
        category LIKE '%ออม%' OR category LIKE '%ลงทุน%' OR LOWER(category) LIKE '%saving%' OR LOWER(category) LIKE '%invest%'
      ) THEN amount ELSE 0 END), 0) as total_savings_invest,
      COUNT(id) as recent_count
    FROM transactions
    WHERE user_id = ?;
  `;
  const totalRow = await db.prepare(totalQuery).bind(userId).first<{
    total_income: number;
    total_expense: number;
    total_savings_invest: number;
    recent_count: number;
  }>();

  const total_income = Math.round((totalRow?.total_income || 0) * 100) / 100;
  const total_expense = Math.round((totalRow?.total_expense || 0) * 100) / 100;
  const total_savings_invest = Math.round((totalRow?.total_savings_invest || 0) * 100) / 100;
  // Net Savings logic: general expense excludes savings/investments transfers
  const general_expense = Math.round(Math.max(0, total_expense - total_savings_invest) * 100) / 100;
  const balance = Math.round((total_income - general_expense) * 100) / 100;
  const recent_count = totalRow?.recent_count || 0;

  // Investment Portfolio aggregates
  const investQuery = `
    SELECT 
      COALESCE(SUM(principal), 0) as total_principal,
      COALESCE(SUM(current_value), 0) as total_current
    FROM investments
    WHERE user_id = ?;
  `;
  const investRow = await db.prepare(investQuery).bind(userId).first<{
    total_principal: number;
    total_current: number;
  }>();

  const total_investments_principal = Math.round((investRow?.total_principal || 0) * 100) / 100;
  const total_investments_current = Math.round((investRow?.total_current || 0) * 100) / 100;
  const total_investments_pl = Math.round((total_investments_current - total_investments_principal) * 100) / 100;
  const total_investments_pl_pct = total_investments_principal > 0
    ? Math.round((total_investments_pl / total_investments_principal) * 10000) / 100
    : 0;
  const net_worth = Math.round((balance + total_investments_current) * 100) / 100;

  // Category breakdown
  const categoryQuery = `
    SELECT type, category, SUM(amount) as sum_amount
    FROM transactions
    WHERE user_id = ?
    GROUP BY type, category
    ORDER BY sum_amount DESC;
  `;
  const { results: catResults } = await db.prepare(categoryQuery).bind(userId).all<{
    type: 'income' | 'expense';
    category: string;
    sum_amount: number;
  }>();

  const category_breakdown = {
    income: {} as Record<string, number>,
    expense: {} as Record<string, number>,
  };

  if (catResults) {
    for (const r of catResults) {
      const rounded = Math.round(r.sum_amount * 100) / 100;
      if (r.type === 'income') {
        category_breakdown.income[r.category] = rounded;
      } else {
        category_breakdown.expense[r.category] = rounded;
      }
    }
  }

  // Monthly trend (last 6 months)
  const trendQuery = `
    SELECT 
      substr(transaction_date, 1, 7) as month,
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense
    FROM transactions
    WHERE user_id = ?
    GROUP BY substr(transaction_date, 1, 7)
    ORDER BY month DESC
    LIMIT 6;
  `;
  const { results: trendResults } = await db.prepare(trendQuery).bind(userId).all<{
    month: string;
    income: number;
    expense: number;
  }>();

  const trendMap = new Map<string, { income: number; expense: number }>();
  if (trendResults) {
    for (const t of trendResults) {
      trendMap.set(t.month, {
        income: Math.round(t.income * 100) / 100,
        expense: Math.round(t.expense * 100) / 100,
      });
    }
  }

  // Generate sequence for the last 6 calendar months
  const now = new Date();
  const monthsSet = new Set<string>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    monthsSet.add(`${yyyy}-${mm}`);
  }
  for (const m of trendMap.keys()) {
    monthsSet.add(m);
  }

  const sortedMonths = Array.from(monthsSet).sort().slice(-6);

  const monthly_trend = sortedMonths.map((m) => {
    const data = trendMap.get(m) || { income: 0, expense: 0 };
    return {
      month: m,
      income: data.income,
      expense: data.expense,
      net: Math.round((data.income - data.expense) * 100) / 100,
    };
  });

  return {
    total_income,
    total_expense,
    general_expense,
    total_savings_invest,
    balance,
    net_worth,
    total_investments_principal,
    total_investments_current,
    total_investments_pl,
    total_investments_pl_pct,
    category_breakdown,
    monthly_trend,
    recent_count,
  };
}

// Admin Aggregations (Skill 03 & 04)
export async function getAdminStats(db: D1Database): Promise<AdminStats> {
  const usersCountRow = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  const total_users = usersCountRow ? usersCountRow.count : 0;

  const txStatsRow = await db.prepare(`
    SELECT 
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
      COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expense
    FROM transactions;
  `).first<{ count: number; total_income: number; total_expense: number }>();

  const total_transactions = txStatsRow ? txStatsRow.count : 0;
  const total_volume_income = Math.round((txStatsRow?.total_income || 0) * 100) / 100;
  const total_volume_expense = Math.round((txStatsRow?.total_expense || 0) * 100) / 100;
  const net_system_balance = Math.round((total_volume_income - total_volume_expense) * 100) / 100;

  const { results: recent_users } = await db.prepare(
    'SELECT id, email, name, picture, role, created_at FROM users ORDER BY created_at DESC LIMIT 10'
  ).all<any>();

  return {
    total_users,
    total_transactions,
    total_volume_income,
    total_volume_expense,
    net_system_balance,
    recent_registered_users: recent_users || [],
  };
}

export async function getAdminAllTransactions(
  db: D1Database,
  limit = 100,
  offset = 0
): Promise<Array<Transaction & { user_email: string; user_name: string }>> {
  const query = `
    SELECT 
      t.id, t.user_id, t.type, t.category, t.amount, t.note, t.transaction_date, t.created_at,
      u.email as user_email, u.name as user_name
    FROM transactions t
    JOIN users u ON t.user_id = u.id
    ORDER BY t.transaction_date DESC, t.created_at DESC
    LIMIT ? OFFSET ?;
  `;
  const { results } = await db.prepare(query).bind(limit, offset).all<any>();
  return results || [];
}

export async function getMonthlyExpense(db: D1Database, userId: string, yearMonth?: string): Promise<number> {
  const ym = yearMonth || new Date().toISOString().slice(0, 7);
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'expense' AND substr(transaction_date, 1, 7) = ?")
    .bind(userId, ym)
    .first<{ total: number }>();
  return Math.round((row?.total || 0) * 100) / 100;
}

