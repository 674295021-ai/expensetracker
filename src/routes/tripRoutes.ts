// Trip Routes - Travel Mode (Skill 05 API Design)
import { Env, JWTPayload, Transaction } from '../types';
import { jsonSuccess, jsonError } from '../utils/response';
import {
  getTrips,
  getTripById,
  createTrip,
  updateTrip,
  deleteTrip,
  createTripExpense,
  deleteTripExpense,
  getUserActiveTrip,
  setActiveTrip,
  deactivateActiveTrip,
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

  // GET /api/trips - List all trips with totals & active trip status
  if (path === '/api/trips' && method === 'GET') {
    const trips = await getTrips(env.DB, userId);
    return jsonSuccess(trips);
  }

  // GET /api/trips/active - Get current active trip for user
  if (path === '/api/trips/active' && method === 'GET') {
    const activeTrip = await getUserActiveTrip(env.DB, userId);
    return jsonSuccess({ active_trip: activeTrip });
  }

  // POST /api/trips/deactivate - Deactivate current active trip
  if ((path === '/api/trips/deactivate' || path === '/api/trips/active/deactivate') && method === 'POST') {
    const deactivated = await deactivateActiveTrip(env.DB, userId);
    return jsonSuccess({ message: 'ปิดโหมด Active Trip เรียบร้อยแล้ว', trip: deactivated });
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

  // Match POST /api/trips/:id/activate
  const activateMatch = path.match(/^\/api\/trips\/([a-zA-Z0-9_-]+)\/activate$/);
  if (activateMatch && method === 'POST') {
    const tripId = activateMatch[1];
    const activated = await setActiveTrip(env.DB, userId, tripId);
    if (!activated) return jsonError('ไม่พบข้อมูลทริปหรือไม่สามารถเปิดโหมดทริปได้', 'NOT_FOUND', 404);
    return jsonSuccess({ message: 'เปิดโหมด Active Trip เรียบร้อยแล้ว ✈️', trip: activated });
  }

  // Match POST /api/trips/:id/deactivate
  const deactivateMatch = path.match(/^\/api\/trips\/([a-zA-Z0-9_-]+)\/deactivate$/);
  if (deactivateMatch && method === 'POST') {
    const deactivated = await deactivateActiveTrip(env.DB, userId);
    return jsonSuccess({ message: 'ปิดโหมด Active Trip เรียบร้อยแล้ว', trip: deactivated });
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

  // Match POST /api/trips/:id/link-transaction - Move transaction from main account into trip
  const linkTxMatch = path.match(/^\/api\/trips\/([a-zA-Z0-9_-]+)\/link-transaction$/);
  if (linkTxMatch && method === 'POST') {
    const tripId = linkTxMatch[1];
    try {
      const body = (await request.json()) as { transaction_id?: string };
      if (!body.transaction_id) {
        return jsonError('กรุณาระบุ transaction_id', 'BAD_REQUEST', 400);
      }

      const tx = await env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
        .bind(body.transaction_id, userId)
        .first<Transaction>();

      if (!tx) {
        return jsonError('ไม่พบรายการรายจ่ายนี้ในระบบ', 'NOT_FOUND', 404);
      }

      const expense = await createTripExpense(env.DB, tripId, userId, {
        category: tx.category,
        amount: tx.amount,
        note: tx.note || `ผูกจากรายการ ${tx.category}`,
        expense_date: tx.transaction_date,
      });

      // ลบออกจากตาราง transactions หลักให้อัตโนมัติ (แยกงบเด็ดขาด)
      await env.DB.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
        .bind(body.transaction_id, userId)
        .run();

      return jsonSuccess({ message: 'ย้ายรายการเข้าทริปและนำออกจากบัญชีหลักเรียบร้อยแล้ว', expense }, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to link transaction';
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
