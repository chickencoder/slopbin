// Minimal auth: GitHub OAuth for identity, session tokens in D1.
// No password storage. Deliberately boring.

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function newToken(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)).buffer);
}

// ---- signed values (for the pending-signup cookie during OAuth) ----

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

export async function signValue(secret: string, payload: object): Promise<string> {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${body}.${await hmacHex(secret, body)}`;
}

export async function verifyValue<T>(secret: string, signed: string): Promise<T | null> {
  const dot = signed.lastIndexOf(".");
  if (dot < 0) return null;
  const body = signed.slice(0, dot);
  const sig = signed.slice(dot + 1);
  const expected = await hmacHex(secret, body);
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64)) as T;
  } catch {
    return null;
  }
}

// ---- sessions ----

export interface SessionUser {
  id: number;
  username: string;
  github_id: number;
  merged_prs: number;
}

export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = newToken();
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await db
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expires)
    .run();
  return token;
}

export async function getSessionUser(
  db: D1Database,
  token: string | undefined
): Promise<SessionUser | null> {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const now = Math.floor(Date.now() / 1000);
  return db
    .prepare(
      `SELECT u.id, u.username, u.github_id, u.merged_prs
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .bind(token, now)
    .first<SessionUser>();
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS): string {
  return cookie("session", token, maxAge);
}
