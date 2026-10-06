// Trips DAL - Travel Mode (Skill 04 Database Design & Skill 05 API Design)
import { Trip, TripExpense } from '../types';

export interface CreateTripInput {
  name: string;
  destination?: string | null;
  start_date: string;
  end_date: string;
  budget?: number;
}

export interface CreateTripExpenseInput {
  category: string;
  amount: number;
  note?: string | null;
  expense_date: string;
}

export async function getTrips(db: D1Database, userId: string): Promise<Trip[]> {
  const query = `
    SELECT 
      t.id, t.user_id, t.name, t.destination, t.start_date, t.end_date, t.budget, t.status, t.created_at,
      COALESCE(SUM(te.amount), 0) as total_spent
    FROM trips t
    LEFT JOIN trip_expenses te ON t.id = te.trip_id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY t.start_date DESC;
  `;
  const { results } = await db.prepare(query).bind(userId).all<Trip & { total_spent: number }>();

  return (results || []).map((r) => ({
    ...r,
    budget: Math.round(r.budget * 100) / 100,
    total_spent: Math.round((r.total_spent || 0) * 100) / 100,
    remaining_budget: Math.round((r.budget - (r.total_spent || 0)) * 100) / 100,
  }));
}

export async function getTripById(
  db: D1Database,
  tripId: string,
  userId: string
): Promise<{ trip: Trip; expenses: TripExpense[] } | null> {
  const tripQuery = `
    SELECT 
      t.id, t.user_id, t.name, t.destination, t.start_date, t.end_date, t.budget, t.status, t.created_at,
      COALESCE(SUM(te.amount), 0) as total_spent
    FROM trips t
    LEFT JOIN trip_expenses te ON t.id = te.trip_id
    WHERE t.id = ? AND t.user_id = ?
    GROUP BY t.id;
  `;
  const trip = await db.prepare(tripQuery).bind(tripId, userId).first<Trip & { total_spent: number }>();
  if (!trip) return null;

  const expensesQuery = `
    SELECT id, trip_id, user_id, category, amount, note, expense_date, created_at
    FROM trip_expenses
    WHERE trip_id = ? AND user_id = ?
    ORDER BY expense_date DESC, created_at DESC;
  `;
  const { results: expenses } = await db.prepare(expensesQuery).bind(tripId, userId).all<TripExpense>();

  return {
    trip: {
      ...trip,
      budget: Math.round(trip.budget * 100) / 100,
      total_spent: Math.round((trip.total_spent || 0) * 100) / 100,
      remaining_budget: Math.round((trip.budget - (trip.total_spent || 0)) * 100) / 100,
    },
    expenses: expenses || [],
  };
}

export async function createTrip(
  db: D1Database,
  userId: string,
  data: CreateTripInput
): Promise<Trip> {
  const id = crypto.randomUUID();
  const budget = Math.max(0, data.budget || 0);

  const query = `
    INSERT INTO trips (id, user_id, name, destination, start_date, end_date, budget, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    RETURNING id, user_id, name, destination, start_date, end_date, budget, status, created_at;
  `;
  const result = await db
    .prepare(query)
    .bind(id, userId, data.name.trim(), data.destination?.trim() || null, data.start_date, data.end_date, budget)
    .first<Trip>();

  if (!result) throw new Error('Failed to create trip');
  return {
    ...result,
    total_spent: 0,
    remaining_budget: budget,
  };
}

export async function updateTrip(
  db: D1Database,
  tripId: string,
  userId: string,
  data: Partial<CreateTripInput> & { status?: 'active' | 'completed' }
): Promise<Trip | null> {
  const existing = await getTripById(db, tripId, userId);
  if (!existing) return null;

  const name = data.name !== undefined ? data.name.trim() : existing.trip.name;
  const destination = data.destination !== undefined ? data.destination?.trim() || null : existing.trip.destination;
  const startDate = data.start_date || existing.trip.start_date;
  const endDate = data.end_date || existing.trip.end_date;
  const budget = data.budget !== undefined ? Math.max(0, data.budget) : existing.trip.budget;
  const status = data.status || existing.trip.status;

  const query = `
    UPDATE trips
    SET name = ?, destination = ?, start_date = ?, end_date = ?, budget = ?, status = ?
    WHERE id = ? AND user_id = ?
    RETURNING id, user_id, name, destination, start_date, end_date, budget, status, created_at;
  `;
  const updated = await db
    .prepare(query)
    .bind(name, destination, startDate, endDate, budget, status, tripId, userId)
    .first<Trip>();

  if (!updated) return null;
  return {
    ...updated,
    total_spent: existing.trip.total_spent,
    remaining_budget: Math.round((budget - (existing.trip.total_spent || 0)) * 100) / 100,
  };
}

export async function deleteTrip(db: D1Database, tripId: string, userId: string): Promise<boolean> {
  const query = `DELETE FROM trips WHERE id = ? AND user_id = ?;`;
  const result = await db.prepare(query).bind(tripId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function createTripExpense(
  db: D1Database,
  tripId: string,
  userId: string,
  data: CreateTripExpenseInput
): Promise<TripExpense> {
  const id = crypto.randomUUID();
  const amount = Math.round(data.amount * 100) / 100;

  const query = `
    INSERT INTO trip_expenses (id, trip_id, user_id, category, amount, note, expense_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id, trip_id, user_id, category, amount, note, expense_date, created_at;
  `;
  const result = await db
    .prepare(query)
    .bind(id, tripId, userId, data.category.trim(), amount, data.note?.trim() || null, data.expense_date)
    .first<TripExpense>();

  if (!result) throw new Error('Failed to create trip expense');
  return result;
}

export async function deleteTripExpense(
  db: D1Database,
  expenseId: string,
  userId: string
): Promise<boolean> {
  const query = `DELETE FROM trip_expenses WHERE id = ? AND user_id = ?;`;
  const result = await db.prepare(query).bind(expenseId, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}
