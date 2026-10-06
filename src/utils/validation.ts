// Input Validation & Boundary Checks (Skill 06 & Skill 09 OWASP)

import { TransactionType, ValidatedTransactionInput } from '../types';

export function validateTransactionInput(body: unknown): {
  valid: boolean;
  error?: string;
  data?: ValidatedTransactionInput;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a valid JSON object' };
  }

  const raw = body as Record<string, unknown>;

  // Validate type
  const rawType = String(raw.type || '').trim().toLowerCase();
  if (rawType !== 'income' && rawType !== 'expense') {
    return { valid: false, error: "Type must be either 'income' or 'expense'" };
  }

  // Validate category
  const rawCategory = typeof raw.category === 'string' ? raw.category.trim() : '';
  if (!rawCategory || rawCategory.length > 50) {
    return { valid: false, error: 'Category is required and must not exceed 50 characters' };
  }

  // Validate amount
  const rawAmount = typeof raw.amount === 'number' ? raw.amount : parseFloat(String(raw.amount));
  if (isNaN(rawAmount) || !isFinite(rawAmount) || rawAmount <= 0) {
    return { valid: false, error: 'Amount must be a positive number greater than 0' };
  }
  // Max transaction amount sanity check (e.g. 1 billion)
  if (rawAmount > 1_000_000_000) {
    return { valid: false, error: 'Amount exceeds maximum allowable threshold (1,000,000,000)' };
  }
  const roundedAmount = Math.round(rawAmount * 100) / 100;

  // Validate note
  let cleanNote: string | null = null;
  if (raw.note !== undefined && raw.note !== null) {
    const rawNoteStr = String(raw.note).trim();
    if (rawNoteStr.length > 255) {
      return { valid: false, error: 'Note must not exceed 255 characters' };
    }
    cleanNote = rawNoteStr.length > 0 ? rawNoteStr : null;
  }

  // Validate transaction_date (YYYY-MM-DD)
  const rawDate = typeof raw.transaction_date === 'string' ? raw.transaction_date.trim() : '';
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!rawDate || !dateRegex.test(rawDate) || isNaN(Date.parse(rawDate))) {
    return { valid: false, error: 'Transaction date must be a valid date in YYYY-MM-DD format' };
  }

  return {
    valid: true,
    data: {
      type: rawType as TransactionType,
      category: rawCategory,
      amount: roundedAmount,
      note: cleanNote,
      transaction_date: rawDate,
    },
  };
}

export function sanitizeText(str: string): string {
  return str.replace(/[<>'"&]/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case "'": return '&#39;';
      case '"': return '&quot;';
      case '&': return '&amp;';
      default: return char;
    }
  });
}
