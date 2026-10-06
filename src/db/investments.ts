// Investments & Portfolio DAL (Feature 3 - Dime & Multi-app Portfolio Tracking)
import { Investment } from '../types';

export interface CreateInvestmentInput {
  name: string;
  institution: string;
  asset_type: string;
  principal: number;
  current_value: number;
  note?: string | null;
}

export interface InvestmentPortfolioSummary {
  investments: Investment[];
  total_principal: number;
  total_current_value: number;
  total_profit_loss: number;
  total_profit_loss_pct: number;
  by_institution: Record<string, { current_value: number; principal: number; profit_loss: number }>;
  by_asset_type: Record<string, { current_value: number; principal: number; profit_loss: number }>;
}

export async function getInvestments(db: D1Database, userId: string): Promise<InvestmentPortfolioSummary> {
  const query = `
    SELECT id, user_id, name, institution, asset_type, principal, current_value, note, updated_at, created_at
    FROM investments
    WHERE user_id = ?
    ORDER BY current_value DESC, created_at DESC;
  `;
  const { results } = await db.prepare(query).bind(userId).all<Investment>();
  const items = results || [];

  let total_principal = 0;
  let total_current_value = 0;

  const by_institution: Record<string, { current_value: number; principal: number; profit_loss: number }> = {};
  const by_asset_type: Record<string, { current_value: number; principal: number; profit_loss: number }> = {};

  const mappedInvestments = items.map((inv) => {
    const principal = Math.round(inv.principal * 100) / 100;
    const current = Math.round(inv.current_value * 100) / 100;
    const pl = Math.round((current - principal) * 100) / 100;
    const pl_pct = principal > 0 ? Math.round((pl / principal) * 10000) / 100 : 0;

    total_principal += principal;
    total_current_value += current;

    // Aggregate by institution (e.g. Dime, Streaming, Bitkub)
    if (!by_institution[inv.institution]) {
      by_institution[inv.institution] = { current_value: 0, principal: 0, profit_loss: 0 };
    }
    by_institution[inv.institution].current_value += current;
    by_institution[inv.institution].principal += principal;
    by_institution[inv.institution].profit_loss += pl;

    // Aggregate by asset type
    if (!by_asset_type[inv.asset_type]) {
      by_asset_type[inv.asset_type] = { current_value: 0, principal: 0, profit_loss: 0 };
    }
    by_asset_type[inv.asset_type].current_value += current;
    by_asset_type[inv.asset_type].principal += principal;
    by_asset_type[inv.asset_type].profit_loss += pl;

    return {
      ...inv,
      principal,
      current_value: current,
      profit_loss: pl,
      profit_loss_pct: pl_pct,
    };
  });

  total_principal = Math.round(total_principal * 100) / 100;
  total_current_value = Math.round(total_current_value * 100) / 100;
  const total_profit_loss = Math.round((total_current_value - total_principal) * 100) / 100;
  const total_profit_loss_pct = total_principal > 0
    ? Math.round((total_profit_loss / total_principal) * 10000) / 100
    : 0;

  return {
    investments: mappedInvestments,
    total_principal,
    total_current_value,
    total_profit_loss,
    total_profit_loss_pct,
    by_institution,
    by_asset_type,
  };
}

export async function createInvestment(
  db: D1Database,
  userId: string,
  data: CreateInvestmentInput
): Promise<Investment> {
  const id = crypto.randomUUID();
  const principal = Math.max(0, Math.round(data.principal * 100) / 100);
  const currentValue = Math.max(0, Math.round(data.current_value * 100) / 100);

  const query = `
    INSERT INTO investments (id, user_id, name, institution, asset_type, principal, current_value, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id, user_id, name, institution, asset_type, principal, current_value, note, updated_at, created_at;
  `;
  const result = await db
    .prepare(query)
    .bind(
      id,
      userId,
      data.name.trim(),
      data.institution.trim(),
      data.asset_type.trim(),
      principal,
      currentValue,
      data.note?.trim() || null
    )
    .first<Investment>();

  if (!result) throw new Error('Failed to create investment');

  const pl = Math.round((currentValue - principal) * 100) / 100;
  const pl_pct = principal > 0 ? Math.round((pl / principal) * 10000) / 100 : 0;

  return {
    ...result,
    profit_loss: pl,
    profit_loss_pct: pl_pct,
  };
}

export async function updateInvestment(
  db: D1Database,
  id: string,
  userId: string,
  data: Partial<CreateInvestmentInput>
): Promise<Investment | null> {
  const currentInv = await db
    .prepare('SELECT * FROM investments WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<Investment>();

  if (!currentInv) return null;

  const name = data.name !== undefined ? data.name.trim() : currentInv.name;
  const institution = data.institution !== undefined ? data.institution.trim() : currentInv.institution;
  const assetType = data.asset_type !== undefined ? data.asset_type.trim() : currentInv.asset_type;
  const principal = data.principal !== undefined ? Math.max(0, Math.round(data.principal * 100) / 100) : currentInv.principal;
  const currentValue = data.current_value !== undefined ? Math.max(0, Math.round(data.current_value * 100) / 100) : currentInv.current_value;
  const note = data.note !== undefined ? (data.note?.trim() || null) : currentInv.note;

  const query = `
    UPDATE investments
    SET name = ?, institution = ?, asset_type = ?, principal = ?, current_value = ?, note = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?
    RETURNING id, user_id, name, institution, asset_type, principal, current_value, note, updated_at, created_at;
  `;
  const result = await db
    .prepare(query)
    .bind(name, institution, assetType, principal, currentValue, note, id, userId)
    .first<Investment>();

  if (!result) return null;

  const pl = Math.round((currentValue - principal) * 100) / 100;
  const pl_pct = principal > 0 ? Math.round((pl / principal) * 10000) / 100 : 0;

  return {
    ...result,
    profit_loss: pl,
    profit_loss_pct: pl_pct,
  };
}

export async function deleteInvestment(db: D1Database, id: string, userId: string): Promise<boolean> {
  const query = `DELETE FROM investments WHERE id = ? AND user_id = ?;`;
  const result = await db.prepare(query).bind(id, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function upsertDimeInvestment(
  db: D1Database,
  userId: string,
  data: {
    name: string;
    shares?: number;
    price?: number;
    amount: number;
    note?: string;
  }
): Promise<{ investment: Investment; isNew: boolean }> {
  const ticker = data.name.trim();
  const existing = await db
    .prepare('SELECT * FROM investments WHERE user_id = ? AND institution = ? AND name = ?')
    .bind(userId, 'Dime!', ticker)
    .first<Investment>();

  if (existing) {
    const newPrincipal = Math.round((existing.principal + data.amount) * 100) / 100;
    const newCurrent = Math.round((existing.current_value + data.amount) * 100) / 100;
    const noteExtra = data.note ? ` | ${data.note}` : '';
    const updatedNote = (existing.note ? `${existing.note}${noteExtra}` : data.note || null)?.slice(0, 500);

    const updated = await updateInvestment(db, existing.id, userId, {
      principal: newPrincipal,
      current_value: newCurrent,
      note: updatedNote,
    });
    return { investment: updated || existing, isNew: false };
  } else {
    const created = await createInvestment(db, userId, {
      name: ticker,
      institution: 'Dime!',
      asset_type: 'หุ้น (Stock)',
      principal: data.amount,
      current_value: data.amount,
      note: data.note || null,
    });
    return { investment: created, isNew: true };
  }
}

