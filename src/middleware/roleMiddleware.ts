// Authorization & RBAC Middleware (Skill 03 Architecture, 09 OWASP)

import { JWTPayload } from '../types';
import { jsonError } from '../utils/response';

export function requireAdmin(user: JWTPayload): Response | null {
  if (user.role !== 'admin') {
    return jsonError(
      'Access denied. Administrator privileges required.',
      'FORBIDDEN',
      403
    );
  }
  return null;
}
