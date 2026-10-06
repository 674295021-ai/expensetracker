// Automated Unit & Integration Tests (Skill 07 Testing & QA)
import test from 'node:test';
import assert from 'node:assert/strict';

// 1. Role Authorization Logic
const ADMIN_EMAILS = [
  'seree999@gmail.com',
  '674295021@parichat.skru.ac.th',
];

function determineUserRole(email) {
  const normalizedEmail = email.trim().toLowerCase();
  return ADMIN_EMAILS.includes(normalizedEmail) ? 'admin' : 'user';
}

// 2. JWT Simulation Functions
function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function getCryptoKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

async function signJWT(payload, secret, expiresInSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const dataToSign = `${encodedHeader}.${encodedPayload}`;

  const key = await getCryptoKey(secret);
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(dataToSign)
  );

  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${dataToSign}.${signature}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, signature] = parts;
    const dataToSign = `${encodedHeader}.${encodedPayload}`;

    const key = await getCryptoKey(secret);
    let rawSig = signature.replace(/-/g, '+').replace(/_/g, '/');
    while (rawSig.length % 4) rawSig += '=';
    const sigBytes = Uint8Array.from(atob(rawSig), (c) => c.charCodeAt(0));

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(dataToSign)
    );

    if (!isValid) return null;

    const payloadJson = base64UrlDecode(encodedPayload);
    const payload = JSON.parse(payloadJson);

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// 3. Validation Logic
function validateTransactionInput(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a valid JSON object' };
  }

  const raw = body;
  const rawType = String(raw.type || '').trim().toLowerCase();
  if (rawType !== 'income' && rawType !== 'expense') {
    return { valid: false, error: "Type must be either 'income' or 'expense'" };
  }

  const rawCategory = typeof raw.category === 'string' ? raw.category.trim() : '';
  if (!rawCategory || rawCategory.length > 50) {
    return { valid: false, error: 'Category is required and must not exceed 50 characters' };
  }

  const rawAmount = typeof raw.amount === 'number' ? raw.amount : parseFloat(String(raw.amount));
  if (isNaN(rawAmount) || !isFinite(rawAmount) || rawAmount <= 0) {
    return { valid: false, error: 'Amount must be a positive number greater than 0' };
  }
  if (rawAmount > 1_000_000_000) {
    return { valid: false, error: 'Amount exceeds maximum allowable threshold (1,000,000,000)' };
  }
  const roundedAmount = Math.round(rawAmount * 100) / 100;

  let cleanNote = null;
  if (raw.note !== undefined && raw.note !== null) {
    const rawNoteStr = String(raw.note).trim();
    if (rawNoteStr.length > 255) {
      return { valid: false, error: 'Note must not exceed 255 characters' };
    }
    cleanNote = rawNoteStr.length > 0 ? rawNoteStr : null;
  }

  const rawDate = typeof raw.transaction_date === 'string' ? raw.transaction_date.trim() : '';
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!rawDate || !dateRegex.test(rawDate) || isNaN(Date.parse(rawDate))) {
    return { valid: false, error: 'Transaction date must be a valid date in YYYY-MM-DD format' };
  }

  return {
    valid: true,
    data: {
      type: rawType,
      category: rawCategory,
      amount: roundedAmount,
      note: cleanNote,
      transaction_date: rawDate,
    },
  };
}

// ================= TEST SUITE ================= //

test('Admin Role Assignment Rules', async (t) => {
  await t.test('assigns admin to seree999@gmail.com regardless of case', () => {
    assert.equal(determineUserRole('seree999@gmail.com'), 'admin');
    assert.equal(determineUserRole('SEREE999@GMAIL.COM'), 'admin');
    assert.equal(determineUserRole('  seree999@gmail.com  '), 'admin');
  });

  await t.test('assigns admin to 674295021@parichat.skru.ac.th regardless of case', () => {
    assert.equal(determineUserRole('674295021@parichat.skru.ac.th'), 'admin');
    assert.equal(determineUserRole('674295021@PARICHAT.SKRU.AC.TH'), 'admin');
  });

  await t.test('assigns regular user to all other emails', () => {
    assert.equal(determineUserRole('user123@gmail.com'), 'user');
    assert.equal(determineUserRole('student@parichat.skru.ac.th'), 'user');
    assert.equal(determineUserRole('admin@otherdomain.com'), 'user');
  });
});

test('JWT Signing and Verification', async (t) => {
  const secret = 'test-secret-key-1234567890';
  const payload = {
    sub: 'user_123',
    email: 'seree999@gmail.com',
    name: 'Ajarn Seree',
    role: 'admin',
  };

  await t.test('successfully signs and verifies a valid token', async () => {
    const token = await signJWT(payload, secret, 3600);
    assert.ok(token);
    assert.equal(token.split('.').length, 3);

    const verified = await verifyJWT(token, secret);
    assert.ok(verified);
    assert.equal(verified.sub, 'user_123');
    assert.equal(verified.email, 'seree999@gmail.com');
    assert.equal(verified.role, 'admin');
  });

  await t.test('fails verification with wrong secret', async () => {
    const token = await signJWT(payload, secret, 3600);
    const verified = await verifyJWT(token, 'wrong-secret-key');
    assert.equal(verified, null);
  });

  await t.test('fails verification on expired token', async () => {
    const token = await signJWT(payload, secret, -10); // Expired 10s ago
    const verified = await verifyJWT(token, secret);
    assert.equal(verified, null);
  });
});

test('Transaction Input Validation', async (t) => {
  await t.test('validates correct income transaction', () => {
    const res = validateTransactionInput({
      type: 'income',
      category: 'เงินเดือน',
      amount: 45000,
      note: 'เงินเดือนประจำเดือน',
      transaction_date: '2026-10-01',
    });
    assert.equal(res.valid, true);
    assert.equal(res.data.amount, 45000);
    assert.equal(res.data.type, 'income');
  });

  await t.test('validates correct expense transaction', () => {
    const res = validateTransactionInput({
      type: 'expense',
      category: 'อาหาร',
      amount: 120.5,
      note: null,
      transaction_date: '2026-10-01',
    });
    assert.equal(res.valid, true);
    assert.equal(res.data.amount, 120.5);
    assert.equal(res.data.type, 'expense');
  });

  await t.test('rejects negative or zero amounts', () => {
    const resZero = validateTransactionInput({
      type: 'expense',
      category: 'อาหาร',
      amount: 0,
      transaction_date: '2026-10-01',
    });
    assert.equal(resZero.valid, false);

    const resNeg = validateTransactionInput({
      type: 'expense',
      category: 'อาหาร',
      amount: -50,
      transaction_date: '2026-10-01',
    });
    assert.equal(resNeg.valid, false);
  });

  await t.test('rejects invalid transaction type', () => {
    const res = validateTransactionInput({
      type: 'transfer',
      category: 'โอนเงิน',
      amount: 100,
      transaction_date: '2026-10-01',
    });
    assert.equal(res.valid, false);
  });

  await t.test('rejects invalid date format', () => {
    const res = validateTransactionInput({
      type: 'income',
      category: 'เงินเดือน',
      amount: 100,
      transaction_date: '01/10/2026',
    });
    assert.equal(res.valid, false);
  });
});

