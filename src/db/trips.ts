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

type TripRow = Omit<Trip, 'is_active_trip'> & { total_spent: number; is_active_trip?: number };

export async function getTrips(db: D1Database, userId: string): Promise<Trip[]> {
  const query = `
    SELECT 
      t.id, t.user_id, t.name, t.destination, t.start_date, t.end_date, t.budget, t.status, t.created_at,
      (CASE WHEN uat.trip_id IS NOT NULL THEN 1 ELSE 0 END) as is_active_trip,
      COALESCE(SUM(te.amount), 0) as total_spent
    FROM trips t
    LEFT JOIN user_active_trips uat ON t.id = uat.trip_id AND t.user_id = uat.user_id
    LEFT JOIN trip_expenses te ON t.id = te.trip_id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY is_active_trip DESC, t.start_date DESC;
  `;
  const { results } = await db.prepare(query).bind(userId).all<TripRow>();

  return (results || []).map((r) => ({
    ...r,
    is_active_trip: Boolean(r.is_active_trip),
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
      (CASE WHEN uat.trip_id IS NOT NULL THEN 1 ELSE 0 END) as is_active_trip,
      COALESCE(SUM(te.amount), 0) as total_spent
    FROM trips t
    LEFT JOIN user_active_trips uat ON t.id = uat.trip_id AND t.user_id = uat.user_id
    LEFT JOIN trip_expenses te ON t.id = te.trip_id
    WHERE t.id = ? AND t.user_id = ?
    GROUP BY t.id;
  `;
  const trip = await db.prepare(tripQuery).bind(tripId, userId).first<TripRow>();
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
      is_active_trip: Boolean(trip.is_active_trip),
      budget: Math.round(trip.budget * 100) / 100,
      total_spent: Math.round((trip.total_spent || 0) * 100) / 100,
      remaining_budget: Math.round((trip.budget - (trip.total_spent || 0)) * 100) / 100,
    },
    expenses: expenses || [],
  };
}

export async function getUserActiveTrip(
  db: D1Database,
  userId: string
): Promise<Trip | null> {
  const query = `
    SELECT 
      t.id, t.user_id, t.name, t.destination, t.start_date, t.end_date, t.budget, t.status, t.created_at,
      1 as is_active_trip,
      COALESCE(SUM(te.amount), 0) as total_spent
    FROM user_active_trips uat
    JOIN trips t ON uat.trip_id = t.id
    LEFT JOIN trip_expenses te ON t.id = te.trip_id
    WHERE uat.user_id = ?
    GROUP BY t.id;
  `;
  const trip = await db.prepare(query).bind(userId).first<TripRow>();
  if (!trip) return null;
  return {
    ...trip,
    is_active_trip: true,
    budget: Math.round(trip.budget * 100) / 100,
    total_spent: Math.round((trip.total_spent || 0) * 100) / 100,
    remaining_budget: Math.round((trip.budget - (trip.total_spent || 0)) * 100) / 100,
  };
}

export async function setActiveTrip(
  db: D1Database,
  userId: string,
  tripId: string
): Promise<Trip | null> {
  const detail = await getTripById(db, tripId, userId);
  if (!detail) return null;

  await db.prepare(`
    INSERT INTO user_active_trips (user_id, trip_id, activated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET trip_id = excluded.trip_id, activated_at = CURRENT_TIMESTAMP;
  `).bind(userId, tripId).run();

  await db.prepare(`
    UPDATE trips SET status = 'active' WHERE id = ? AND user_id = ?;
  `).bind(tripId, userId).run();

  const refreshed = await getUserActiveTrip(db, userId);
  return refreshed;
}

export async function deactivateActiveTrip(
  db: D1Database,
  userId: string
): Promise<Trip | null> {
  const current = await getUserActiveTrip(db, userId);
  await db.prepare(`DELETE FROM user_active_trips WHERE user_id = ?;`).bind(userId).run();
  if (current) {
    await db.prepare(`UPDATE trips SET status = 'completed' WHERE id = ? AND user_id = ?;`)
      .bind(current.id, userId).run();
    return {
      ...current,
      status: 'completed',
      is_active_trip: false,
    };
  }
  return null;
}

export async function getLatestTrip(
  db: D1Database,
  userId: string
): Promise<Trip | null> {
  const query = `
    SELECT id, user_id, name, destination, start_date, end_date, budget, status, created_at
    FROM trips
    WHERE user_id = ? AND status = 'active'
    ORDER BY start_date DESC, created_at DESC
    LIMIT 1;
  `;
  return await db.prepare(query).bind(userId).first<Trip>();
}

export async function startTripByNameOrKeyword(
  db: D1Database,
  userId: string,
  tripName: string
): Promise<Trip> {
  const cleanName = tripName.trim();
  let matchedTrip: Trip | null = null;

  if (cleanName) {
    matchedTrip = await findTripByKeyword(db, userId, cleanName);

    if (!matchedTrip) {
      const { results } = await db.prepare(`
        SELECT id, user_id, name, destination, start_date, end_date, budget, status, created_at
        FROM trips
        WHERE user_id = ? AND LOWER(name) LIKE ?
        ORDER BY created_at DESC LIMIT 1
      `).bind(userId, `%${cleanName.toLowerCase()}%`).all<Trip>();

      if (results && results.length > 0) {
        matchedTrip = results[0];
      }
    }
  } else {
    // If no trip name provided, pick latest active trip
    matchedTrip = await getLatestTrip(db, userId);
  }

  const today = new Date().toISOString().split('T')[0];
  const nextWeekDate = new Date();
  nextWeekDate.setDate(nextWeekDate.getDate() + 7);
  const nextWeek = nextWeekDate.toISOString().split('T')[0];

  if (!matchedTrip) {
    // Auto-create new trip
    matchedTrip = await createTrip(db, userId, {
      name: cleanName || 'ทริปเดินทางใหม่',
      destination: cleanName || null,
      start_date: today,
      end_date: nextWeek,
      budget: 0,
    });
  }

  await setActiveTrip(db, userId, matchedTrip.id);
  const refreshed = await getUserActiveTrip(db, userId);
  return refreshed || matchedTrip;
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
    is_active_trip: false,
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

  if (status === 'completed') {
    await db.prepare(`DELETE FROM user_active_trips WHERE trip_id = ? AND user_id = ?;`)
      .bind(tripId, userId).run();
  }

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
    is_active_trip: status === 'completed' ? false : existing.trip.is_active_trip,
    total_spent: existing.trip.total_spent,
    remaining_budget: Math.round((budget - (existing.trip.total_spent || 0)) * 100) / 100,
  };
}

export async function deleteTrip(db: D1Database, tripId: string, userId: string): Promise<boolean> {
  await db.prepare(`DELETE FROM user_active_trips WHERE trip_id = ? AND user_id = ?;`).bind(tripId, userId).run();
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

export async function findActiveTripForDate(
  db: D1Database,
  userId: string,
  date: string
): Promise<Trip | null> {
  const query = `
    SELECT id, user_id, name, destination, start_date, end_date, budget, status
    FROM trips
    WHERE user_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ?
    ORDER BY start_date DESC
    LIMIT 1;
  `;
  return await db.prepare(query).bind(userId, date, date).first<Trip>();
}

export async function findTripByKeyword(
  db: D1Database,
  userId: string,
  keywordText: string
): Promise<Trip | null> {
  if (!keywordText) return null;
  const query = `
    SELECT id, user_id, name, destination, start_date, end_date, budget, status
    FROM trips
    WHERE user_id = ? AND status = 'active'
    ORDER BY created_at DESC;
  `;
  const { results } = await db.prepare(query).bind(userId).all<Trip>();
  const trips = results || [];
  const text = keywordText.toLowerCase();

  for (const t of trips) {
    const cleanName = t.name.toLowerCase().replace(/#/g, '').trim();
    const cleanDest = (t.destination || '').toLowerCase().replace(/#/g, '').trim();

    if (cleanName && text.includes(cleanName)) return t;
    if (cleanDest && text.includes(cleanDest)) return t;

    // Check words in trip name (e.g. "เชียงใหม่" from "เที่ยวเชียงใหม่ 2026")
    const words = cleanName.split(/\s+/);
    for (const w of words) {
      if (w.length >= 3 && text.includes(w)) return t;
    }
  }
  return null;
}
