// Investment Routes - Portfolio & Dime Tracking (Skill 05 API Design)
import { Env, JWTPayload } from '../types';
import { jsonSuccess, jsonError } from '../utils/response';
import {
  getInvestments,
  createInvestment,
  updateInvestment,
  deleteInvestment,
  CreateInvestmentInput,
} from '../db/investments';

export async function handleInvestmentRoutes(
  request: Request,
  env: Env,
  url: URL,
  currentUser: JWTPayload
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const userId = currentUser.sub;

  // GET /api/investments - Get portfolio list and analytics breakdown
  if (path === '/api/investments' && method === 'GET') {
    const portfolio = await getInvestments(env.DB, userId);
    return jsonSuccess(portfolio);
  }

  // POST /api/investments - Add new asset
  if (path === '/api/investments' && method === 'POST') {
    try {
      const body = (await request.json()) as {
        name?: string;
        institution?: string;
        asset_type?: string;
        principal?: number;
        current_value?: number;
        note?: string;
      };

      if (!body.name || !body.institution || !body.asset_type) {
        return jsonError('กรุณากรอกชื่อสินทรัพย์ สถาบัน/แอป และประเภทสินทรัพย์', 'BAD_REQUEST', 400);
      }
      if (body.principal === undefined || body.current_value === undefined) {
        return jsonError('กรุณาระบุเงินต้นและมูลค่าปัจจุบัน', 'BAD_REQUEST', 400);
      }

      const created = await createInvestment(env.DB, userId, {
        name: body.name,
        institution: body.institution,
        asset_type: body.asset_type,
        principal: body.principal,
        current_value: body.current_value,
        note: body.note,
      });

      return jsonSuccess(created, 201);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to create investment';
      return jsonError(msg, 'SERVER_ERROR', 500);
    }
  }

  // Match /api/investments/:id
  const matchId = path.match(/^\/api\/investments\/([a-zA-Z0-9_-]+)$/);
  if (matchId) {
    const id = matchId[1];

    if (method === 'PUT') {
      try {
        const body = (await request.json()) as Partial<CreateInvestmentInput>;
        const updated = await updateInvestment(env.DB, id, userId, body);
        if (!updated) return jsonError('ไม่พบข้อมูลสินทรัพย์หรือแก้ไขไม่สำเร็จ', 'NOT_FOUND', 404);
        return jsonSuccess(updated);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to update investment';
        return jsonError(msg, 'SERVER_ERROR', 500);
      }
    }

    if (method === 'DELETE') {
      const deleted = await deleteInvestment(env.DB, id, userId);
      if (!deleted) return jsonError('ลบรายการไม่สำเร็จ', 'NOT_FOUND', 404);
      return jsonSuccess({ message: 'ลบรายการสินทรัพย์เรียบร้อยแล้ว' });
    }
  }

  return jsonError('Not Found', 'NOT_FOUND', 404);
}
