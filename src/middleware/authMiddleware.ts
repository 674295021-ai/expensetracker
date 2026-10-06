// Authentication Middleware (Skill 05 API & Skill 09 OWASP)

import { Env, JWTPayload } from '../types';
import { verifyJWT } from '../auth/jwt';
import { jsonError } from '../utils/response';

export interface AuthContext {
  user: JWTPayload;
}

export async function requireAuth(
  request: Request,
  env: Env
): Promise<{ user: JWTPayload } | { errorResponse: Response }> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      errorResponse: jsonError('Authentication required. Missing Bearer token.', 'UNAUTHORIZED', 401),
    };
  }

  const token = authHeader.substring(7).trim();
  const secret = env.JWT_SECRET || 'income_expense_super_secret_jwt_key_2026_change_in_prod';
  const payload = await verifyJWT(token, secret);

  if (!payload) {
    return {
      errorResponse: jsonError('Invalid or expired authentication token.', 'UNAUTHORIZED', 401),
    };
  }

  return { user: payload };
}
