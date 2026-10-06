// Cloudflare Worker Main Entry Point
// Application: Income & Expense Tracker (ระบบบันทึกรายรับ-รายจ่าย)
// Skills: 02 System Design, 03 Architecture, 05 API Design, 09 OWASP Security

import { Env } from './types';
import { handleOptions, jsonError } from './utils/response';
import { requireAuth } from './middleware/authMiddleware';
import { handleAuthRoutes } from './routes/authRoutes';
import { handleTransactionRoutes } from './routes/transactionRoutes';
import { handleAdminRoutes } from './routes/adminRoutes';
import { handleTripRoutes } from './routes/tripRoutes';
import { handleInvestmentRoutes } from './routes/investmentRoutes';
import { handleChatRoutes } from './routes/chatRoutes';
import { handleLineRoutes } from './routes/lineRoutes';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. Handle CORS Preflight requests
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    try {
      // 2. Route API Requests
      if (url.pathname.startsWith('/api/')) {
        // Public or semi-public auth routes
        if (url.pathname.startsWith('/api/auth/')) {
          let currentUser = null;
          const authHeader = request.headers.get('Authorization');
          if (authHeader && authHeader.startsWith('Bearer ')) {
            const authResult = await requireAuth(request, env);
            if ('user' in authResult) {
              currentUser = authResult.user;
            }
          }
          return await handleAuthRoutes(request, env, url, currentUser);
        }

        // LINE Bot Webhook (signature authenticated) & Web LINE linking APIs
        if (url.pathname.startsWith('/api/line/')) {
          if (url.pathname === '/api/line/webhook') {
            return await handleLineRoutes(request, env, url, null);
          }
          const authResult = await requireAuth(request, env);
          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }
          return await handleLineRoutes(request, env, url, authResult.user);
        }

        // Protected Transaction & Summary routes
        if (url.pathname.startsWith('/api/transactions') || url.pathname.startsWith('/api/summary')) {
          const authResult = await requireAuth(request, env);
          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }
          return await handleTransactionRoutes(request, env, url, authResult.user);
        }

        // Protected Trip (Travel Mode) routes
        if (url.pathname.startsWith('/api/trips')) {
          const authResult = await requireAuth(request, env);
          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }
          return await handleTripRoutes(request, env, url, authResult.user);
        }

        // Protected Investment Portfolio (Dime Tracking) routes
        if (url.pathname.startsWith('/api/investments')) {
          const authResult = await requireAuth(request, env);
          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }
          return await handleInvestmentRoutes(request, env, url, authResult.user);
        }

        // Protected Gemini Financial Chatbot route
        if (url.pathname === '/api/chat') {
          const authResult = await requireAuth(request, env);
          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }
          return await handleChatRoutes(request, env, url, authResult.user);
        }

        // Protected Admin routes
        if (url.pathname.startsWith('/api/admin/')) {
          const authResult = await requireAuth(request, env);
          if ('errorResponse' in authResult) {
            return authResult.errorResponse;
          }
          return await handleAdminRoutes(request, env, url, authResult.user);
        }

        return jsonError('Endpoint not found', 'NOT_FOUND', 404);
      }

      // 3. Serve Frontend Static Assets (via Cloudflare Workers Assets binding)
      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(request);
        if (assetResponse.status !== 404) {
          return assetResponse;
        }
        // Fallback for SPA routing if asset not directly found
        return await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }

      // Fallback message if ASSETS is not bound
      return new Response('Frontend asset binding is not active. Please access the API at /api/auth/config', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Internal Server Error';
      console.error('Unhandled Server Error:', err);
      return jsonError('An unexpected server error occurred: ' + errorMsg, 'INTERNAL_ERROR', 500);
    }
  },
};
