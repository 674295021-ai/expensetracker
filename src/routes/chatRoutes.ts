// Chatbot Routes - Gemini Financial Advisor (Skill 05 API Design & Feature 1)
import { Env, JWTPayload } from '../types';
import { jsonSuccess, jsonError } from '../utils/response';
import { getUserSummary, getTransactions } from '../db/transactions';
import { getInvestments } from '../db/investments';
import { getTrips } from '../db/trips';
import { askGeminiFinancialAdvisor } from '../services/gemini';

export async function handleChatRoutes(
  request: Request,
  env: Env,
  url: URL,
  currentUser: JWTPayload
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const userId = currentUser.sub;

  if (path === '/api/chat' && method === 'POST') {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonError('Gemini API Key is not configured', 'CONFIG_ERROR', 500);
    }

    try {
      const body = (await request.json()) as {
        message?: string;
        history?: Array<{ role: 'user' | 'model'; content: string }>;
      };

      if (!body.message || !body.message.trim()) {
        return jsonError('กรุณากรอกข้อความคำถาม', 'BAD_REQUEST', 400);
      }

      // Fetch financial context from D1
      const [summary, investments, trips, txResult] = await Promise.all([
        getUserSummary(env.DB, userId),
        getInvestments(env.DB, userId).catch(() => undefined),
        getTrips(env.DB, userId).catch(() => undefined),
        getTransactions(env.DB, userId, { limit: 10 }).catch(() => ({ transactions: [] })),
      ]);

      const answer = await askGeminiFinancialAdvisor(
        apiKey,
        body.message.trim(),
        body.history || [],
        {
          summary,
          investments,
          trips,
          recentTransactions: txResult.transactions,
        }
      );

      return jsonSuccess({ answer });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Chat processing failed';
      console.error('Chat error:', e);
      return jsonError(msg, 'CHAT_ERROR', 500);
    }
  }

  return jsonError('Not Found', 'NOT_FOUND', 404);
}
