// Google Authentication & Role Authorization (Skill 03 Architecture, 05 API, 09 OWASP)

import { UserRole } from '../types';

export const ADMIN_EMAILS: ReadonlyArray<string> = [
  'seree999@gmail.com',
  '674295021@parichat.skru.ac.th',
];

export function determineUserRole(email: string): UserRole {
  const normalizedEmail = email.trim().toLowerCase();
  return ADMIN_EMAILS.includes(normalizedEmail) ? 'admin' : 'user';
}

export interface GoogleUserProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  role: UserRole;
}

export async function verifyGoogleIdToken(
  credential: string,
  expectedClientId?: string
): Promise<{ valid: boolean; profile?: GoogleUserProfile; error?: string }> {
  try {
    if (!credential) {
      return { valid: false, error: 'Google credential token is missing' };
    }

    // Verify token with Google's OAuth2 tokeninfo endpoint
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!response.ok) {
      const errText = await response.text();
      return { valid: false, error: `Invalid Google token: ${errText}` };
    }

    const data = (await response.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      picture?: string;
      aud?: string;
      email_verified?: boolean | string;
    };

    if (!data.email || !data.sub) {
      return { valid: false, error: 'Google token payload is missing email or subject' };
    }

    // Verify audience if configured
    if (expectedClientId && expectedClientId !== 'YOUR_GOOGLE_CLIENT_ID_HERE.apps.googleusercontent.com') {
      if (data.aud !== expectedClientId) {
        return { valid: false, error: 'Google token audience does not match configured Client ID' };
      }
    }

    const email = data.email.toLowerCase();
    const role = determineUserRole(email);

    return {
      valid: true,
      profile: {
        sub: data.sub,
        email,
        name: data.name || email.split('@')[0],
        picture: data.picture || null,
        role,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Verification failed: ${errorMsg}` };
  }
}
