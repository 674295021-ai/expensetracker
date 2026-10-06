// Admin Routes & System Oversight (Skill 03 Architecture, 05 API & 09 OWASP)

import { Env, JWTPayload } from '../types';
import { requireAdmin } from '../middleware/roleMiddleware';
import { getAllUsers } from '../db/users';
import { getAdminStats, getAdminAllTransactions } from '../db/transactions';
import { jsonSuccess, jsonError } from '../utils/response';

export async function handleAdminRoutes(
  request: Request,
  env: Env,
  url: URL,
  currentUser: JWTPayload
): Promise<Response> {
  // Check admin authorization
  const roleError = requireAdmin(currentUser);
  if (roleError) {
    return roleError;
  }

  const path = url.pathname;
  const method = request.method;

  // GET /api/admin/stats - System-wide overview
  if (path === '/api/admin/stats' && method === 'GET') {
    const stats = await getAdminStats(env.DB);
    return jsonSuccess(stats);
  }

  // GET /api/admin/users - All registered users with statistics
  if (path === '/api/admin/users' && method === 'GET') {
    const users = await getAllUsers(env.DB);
    return jsonSuccess(users);
  }

  // GET /api/admin/transactions - System-wide transactions with user info
  if (path === '/api/admin/transactions' && method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const list = await getAdminAllTransactions(env.DB, limit, offset);
    return jsonSuccess(list, 200, { limit, offset });
  }

  return jsonError('Admin endpoint not found', 'NOT_FOUND', 404);
}
