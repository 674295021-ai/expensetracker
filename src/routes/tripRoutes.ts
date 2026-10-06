// Trip Routes - Travel Mode (Skill 05 API Design)
import { Env, JWTPayload } from '../types';
import { jsonSuccess, jsonError } from '../utils/response';
import {
  getTrips,
  getTripById,
  createTrip,
  updateTrip,
  deleteTrip,
  createTripExpense,
  deleteTripExpense,
  CreateTripInput,
} from '../db/trips';

export async function handleTripRoutes(
  request: Request,
  env: Env,
  url: URL,
  currentUser: JWTPayload
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const userId = currentUser.sub;

  // GET /api/trips - List all trips with totals
  if (path === '/api/trips' && method === 'GET') {
    const trips = await getTrips(env.DB, userId);
    return jsonSuccess(trips);
  }

  // POST /api/trips - Create new trip
  if (path === '/api/trips' && method === 'POST') {
    try {
      const body = (await request.json()) as {
        name?: string;
        destination?: string;
        start_date?: string;
        end_date?: string;
        budget?: number;
      };

      if (!body.name || !body.start_date || !body.end_date) {
        return jsonError('กรุณากรอกชื่อทริป วันที่เริ่มต้น และวันที่สิ้นสุด', 'BAD_REQUEST', 400);
      }

      const trip = await createTrip(env.DB, userId, {
        name: body.name,
        destination: body.destination,
        start_date: body.start_date,
        end_date: body.end_date,
        budget: body.budget,
      });

      return jsonSuccess(trip, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create trip';
      return jsonError(msg, 'SERVER_ERROR', 500);
    }
  }

  // Match /api/trips/:id
  const tripIdMatch = path.match(/^\/api\/trips\/([a-zA-Z0-9_-]+)$/);
  if (tripIdMatch) {
    const tripId = tripIdMatch[1];

    if (method === 'GET') {
      const result = await getTripById(env.DB, tripId, userId);
      if (!result) return jsonError('ไม่พบข้อมูลทริป', 'NOT_FOUND', 404);
      return jsonSuccess(result);
    }

    if (method === 'PUT') {
      const body = (await request.json()) as Partial<CreateTripInput> & { status?: 'active' | 'completed' };
      const updated = await updateTrip(env.DB, tripId, userId, body);
      if (!updated) return jsonError('ไม่พบข้อมูลทริปหรือแก้ไขไม่สำเร็จ', 'NOT_FOUND', 404);
      return jsonSuccess(updated);
    }

    if (method === 'DELETE') {
      const deleted = await deleteTrip(env.DB, tripId, userId);
      if (!deleted) return jsonError('ลบทริปไม่สำเร็จ', 'NOT_FOUND', 404);
      return jsonSuccess({ message: 'ลบทริปเรียบร้อยแล้ว' });
    }
  }

  // Match POST /api/trips/:id/expenses
  const tripExpenseMatch = path.match(/^\/api\/trips\/([a-zA-Z0-9_-]+)\/expenses$/);
  if (tripExpenseMatch && method === 'POST') {
    const tripId = tripExpenseMatch[1];
    try {
      const body = (await request.json()) as {
        category?: string;
        amount?: number;
        note?: string;
        expense_date?: string;
      };

      if (!body.category || !body.amount || !body.expense_date || body.amount <= 0) {
        return jsonError('กรุณากรอกหมวดหมู่ จำนวนเงินที่มากกว่า 0 และวันที่', 'BAD_REQUEST', 400);
      }

      const expense = await createTripExpense(env.DB, tripId, userId, {
        category: body.category,
        amount: body.amount,
        note: body.note,
        expense_date: body.expense_date,
      });

      return jsonSuccess(expense, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create trip expense';
      return jsonError(msg, 'SERVER_ERROR', 500);
    }
  }

  // Match DELETE /api/trips/expenses/:id
  const deleteExpenseMatch = path.match(/^\/api\/trips\/expenses\/([a-zA-Z0-9_-]+)$/);
  if (deleteExpenseMatch && method === 'DELETE') {
    const expenseId = deleteExpenseMatch[1];
    const deleted = await deleteTripExpense(env.DB, expenseId, userId);
    if (!deleted) return jsonError('ลบรายการค่าใช้จ่ายไม่สำเร็จ', 'NOT_FOUND', 404);
    return jsonSuccess({ message: 'ลบรายการสำเร็จ' });
  }

  return jsonError('Not Found', 'NOT_FOUND', 404);
}
