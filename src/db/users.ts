// Users Data Access Layer (Skill 04: Prepared Statements & SQL Injection Prevention)

import { User, UserRole } from '../types';

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const stmt = db.prepare('SELECT id, email, name, picture, role, created_at FROM users WHERE id = ?');
  const result = await stmt.bind(id).first<User>();
  return result || null;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const stmt = db.prepare('SELECT id, email, name, picture, role, created_at FROM users WHERE email = ?');
  const result = await stmt.bind(email.toLowerCase()).first<User>();
  return result || null;
}

export async function upsertUser(
  db: D1Database,
  user: { id: string; email: string; name: string; picture: string | null; role: UserRole }
): Promise<User> {
  const normalizedEmail = user.email.toLowerCase();

  // UPSERT query in SQLite/Cloudflare D1:
  const query = `
    INSERT INTO users (id, email, name, picture, role)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      picture = excluded.picture,
      role = excluded.role
    RETURNING id, email, name, picture, role, created_at;
  `;

  const stmt = db.prepare(query);
  const result = await stmt
    .bind(user.id, normalizedEmail, user.name, user.picture, user.role)
    .first<User>();

  if (!result) {
    throw new Error('Failed to upsert user record');
  }

  return result;
}

export async function getAllUsers(db: D1Database): Promise<Array<User & { transaction_count: number; total_amount: number }>> {
  const query = `
    SELECT 
      u.id, 
      u.email, 
      u.name, 
      u.picture, 
      u.role, 
      u.created_at,
      COUNT(t.id) as transaction_count,
      COALESCE(SUM(t.amount), 0) as total_amount
    FROM users u
    LEFT JOIN transactions t ON u.id = t.user_id
    GROUP BY u.id
    ORDER BY u.created_at DESC;
  `;
  const stmt = db.prepare(query);
  const { results } = await stmt.all<User & { transaction_count: number; total_amount: number }>();
  return results || [];
}
