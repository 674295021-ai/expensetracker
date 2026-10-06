// Transaction CRUD & Summary Routes (Skill 05 API Design & Skill 06 Code Quality)

import { Env, JWTPayload } from '../types';
import {
  createTransaction,
  getTransactions,
  getTransactionById,
  updateTransaction,
  deleteTransaction,
  getUserSummary,
} from '../db/transactions';
import { validateTransactionInput } from '../utils/validation';
import { jsonSuccess, jsonError } from '../utils/response';

export async function handleTransactionRoutes(
  request: Request,
  env: Env,
  url: URL,
  currentUser: JWTPayload
): Promise<Response> {
  const path = url.pathname;
  const method = request.method;
  const userId = currentUser.sub;

  // GET /api/summary - Get calculated income, expense, balance, and charts data
  if (path === '/api/summary' && method === 'GET') {
    const summary = await getUserSummary(env.DB, userId);
    return jsonSuccess(summary);
  }

  // Handle /api/transactions collection
  if (path === '/api/transactions') {
    // GET /api/transactions - List with query filtering
    if (method === 'GET') {
      const type = url.searchParams.get('type') || undefined;
      const category = url.searchParams.get('category') || undefined;
      const startDate = url.searchParams.get('startDate') || undefined;
      const endDate = url.searchParams.get('endDate') || undefined;
      const search = url.searchParams.get('search') || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);

      const result = await getTransactions(env.DB, userId, {
        type,
        category,
        startDate,
        endDate,
        search,
        limit,
        offset,
      });

      return jsonSuccess(result.transactions, 200, {
        total: result.total,
        limit,
        offset,
      });
    }

    // POST /api/transactions - Create new transaction
    if (method === 'POST') {
      try {
        const body = await request.json();
        const validation = validateTransactionInput(body);

        if (!validation.valid || !validation.data) {
          return jsonError(validation.error || 'Invalid input data', 'VALIDATION_ERROR', 400);
        }

        const transaction = await createTransaction(env.DB, userId, validation.data);
        return jsonSuccess(transaction, 201);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to create transaction';
        return jsonError(message, 'CREATE_ERROR', 500);
      }
    }
  }

  // Handle single item /api/transactions/:id
  const itemMatch = path.match(/^\/api\/transactions\/([a-zA-Z0-9_-]+)$/);
  if (itemMatch) {
    const transactionId = itemMatch[1];

    // GET /api/transactions/:id
    if (method === 'GET') {
      const item = await getTransactionById(env.DB, transactionId, userId);
      if (!item) {
        return jsonError('Transaction not found', 'NOT_FOUND', 404);
      }
      return jsonSuccess(item);
    }

    // PUT /api/transactions/:id
    if (method === 'PUT') {
      try {
        const body = await request.json();
        const validation = validateTransactionInput(body);

        if (!validation.valid || !validation.data) {
          return jsonError(validation.error || 'Invalid input data', 'VALIDATION_ERROR', 400);
        }

        const updated = await updateTransaction(env.DB, transactionId, userId, validation.data);
        if (!updated) {
          return jsonError('Transaction not found or unauthorized to update', 'NOT_FOUND', 404);
        }

        return jsonSuccess(updated);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to update transaction';
        return jsonError(message, 'UPDATE_ERROR', 500);
      }
    }

    // DELETE /api/transactions/:id
    if (method === 'DELETE') {
      const deleted = await deleteTransaction(env.DB, transactionId, userId);
      if (!deleted) {
        return jsonError('Transaction not found or unauthorized to delete', 'NOT_FOUND', 404);
      }
      return jsonSuccess({ message: 'Transaction deleted successfully', id: transactionId });
    }
  }

  return jsonError('Route not found', 'NOT_FOUND', 404);
}
