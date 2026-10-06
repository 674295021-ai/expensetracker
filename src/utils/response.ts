// Standard API Response Formatter (Skill 05: API Design Contract)

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export function jsonResponse(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

export function jsonSuccess<T>(data: T, status = 200, meta?: Record<string, unknown>): Response {
  return jsonResponse(
    {
      success: true,
      data,
      ...(meta ? { meta } : {}),
    },
    status
  );
}

export function jsonError(
  message: string,
  code = 'BAD_REQUEST',
  status = 400,
  details?: unknown
): Response {
  return jsonResponse(
    {
      success: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    status
  );
}
