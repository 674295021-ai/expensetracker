// Authentication Routes (Skill 05 API Design & 09 OWASP)

import { Env, JWTPayload } from '../types';
import { verifyGoogleIdToken } from '../auth/google';
import { signJWT } from '../auth/jwt';
import { upsertUser, getUserById } from '../db/users';
import { jsonSuccess, jsonError } from '../utils/response';

export async function handleAuthRoutes(
  request: Request,
  env: Env,
  url: URL,
  currentUser: JWTPayload | null
): Promise<Response> {
  const path = url.pathname;
  const secret = env.JWT_SECRET || 'income_expense_super_secret_jwt_key_2026_change_in_prod';

  // GET /api/auth/config - Provide frontend with public client configuration
  if (path === '/api/auth/config' && request.method === 'GET') {
    return jsonSuccess({
      googleClientId: env.GOOGLE_CLIENT_ID || '',
      environment: env.ENVIRONMENT || 'development',
    });
  }

  // GET /api/auth/me - Return current authenticated profile
  if (path === '/api/auth/me' && request.method === 'GET') {
    if (!currentUser) {
      return jsonError('Not authenticated', 'UNAUTHORIZED', 401);
    }
    const dbUser = await getUserById(env.DB, currentUser.sub);
    return jsonSuccess(dbUser || currentUser);
  }

  // POST /api/auth/google - Verify Google token & issue session
  if (path === '/api/auth/google' && request.method === 'POST') {
    try {
      const body = await request.json() as { credential?: string };
      if (!body.credential) {
        return jsonError('Credential is required', 'BAD_REQUEST', 400);
      }

      const verifyResult = await verifyGoogleIdToken(body.credential, env.GOOGLE_CLIENT_ID);
      if (!verifyResult.valid || !verifyResult.profile) {
        return jsonError(verifyResult.error || 'Google token verification failed', 'INVALID_CREDENTIALS', 401);
      }

      const { sub, email, name, picture, role } = verifyResult.profile;

      // Upsert into D1 users table
      const savedUser = await upsertUser(env.DB, {
        id: sub,
        email,
        name,
        picture,
        role,
      });

      // Sign session JWT
      const token = await signJWT(
        {
          sub: savedUser.id,
          email: savedUser.email,
          name: savedUser.name,
          picture: savedUser.picture,
          role: savedUser.role,
        },
        secret
      );

      return jsonSuccess({
        token,
        user: savedUser,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      return jsonError(message, 'AUTH_ERROR', 500);
    }
  }

  return jsonError('Not Found', 'NOT_FOUND', 404);
}
