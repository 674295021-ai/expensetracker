// LINE Bot & User Linking DAL (Feature 4 - LINE Integration)
import { LineUser } from '../types';

export async function getLineUser(db: D1Database, lineUserId: string): Promise<LineUser | null> {
  const query = `
    SELECT line_user_id, user_id, display_name, picture_url, created_at
    FROM line_users
    WHERE line_user_id = ?;
  `;
  return await db.prepare(query).bind(lineUserId).first<LineUser>();
}

export async function getLineUserByUserId(db: D1Database, userId: string): Promise<LineUser | null> {
  const query = `
    SELECT line_user_id, user_id, display_name, picture_url, created_at
    FROM line_users
    WHERE user_id = ?;
  `;
  return await db.prepare(query).bind(userId).first<LineUser>();
}

export async function generateLineLinkToken(db: D1Database, userId: string): Promise<string> {
  // Generate a friendly 6-digit alphanumeric code
  const chars = '0123456789';
  let token = '';
  for (let i = 0; i < 6; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Expires in 15 minutes
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // Delete previous tokens for this user
  await db.prepare('DELETE FROM line_link_tokens WHERE user_id = ?').bind(userId).run();

  const query = `
    INSERT INTO line_link_tokens (token, user_id, expires_at)
    VALUES (?, ?, ?)
    RETURNING token;
  `;
  await db.prepare(query).bind(token, userId, expiresAt).run();

  return token;
}

export async function verifyAndLinkLineUser(
  db: D1Database,
  token: string,
  lineUserId: string,
  displayName?: string | null,
  pictureUrl?: string | null
): Promise<{ success: boolean; userId?: string; error?: string }> {
  const cleanedToken = token.trim();
  const tokenRecord = await db
    .prepare('SELECT user_id, expires_at FROM line_link_tokens WHERE token = ?')
    .bind(cleanedToken)
    .first<{ user_id: string; expires_at: string }>();

  if (!tokenRecord) {
    return { success: false, error: 'รหัสเชื่อมต่อไม่ถูกต้อง กรุณาขอรหัสใหม่จากหน้าเว็บ' };
  }

  if (new Date(tokenRecord.expires_at).getTime() < Date.now()) {
    await db.prepare('DELETE FROM line_link_tokens WHERE token = ?').bind(cleanedToken).run();
    return { success: false, error: 'รหัสเชื่อมต่อหมดอายุแล้ว กรุณาขอรหัสใหม่จากหน้าเว็บ' };
  }

  // Upsert line_users
  const upsertQuery = `
    INSERT INTO line_users (line_user_id, user_id, display_name, picture_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(line_user_id) DO UPDATE SET
      user_id = excluded.user_id,
      display_name = COALESCE(excluded.display_name, line_users.display_name),
      picture_url = COALESCE(excluded.picture_url, line_users.picture_url);
  `;
  await db.prepare(upsertQuery).bind(lineUserId, tokenRecord.user_id, displayName || null, pictureUrl || null).run();

  // Consume token
  await db.prepare('DELETE FROM line_link_tokens WHERE token = ?').bind(cleanedToken).run();

  return { success: true, userId: tokenRecord.user_id };
}

export async function unlinkLineUser(db: D1Database, userId: string): Promise<boolean> {
  const query = 'DELETE FROM line_users WHERE user_id = ?;';
  const res = await db.prepare(query).bind(userId).run();
  return (res.meta?.changes ?? 0) > 0;
}
