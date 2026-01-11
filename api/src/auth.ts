import type { TelegramUser } from "./types";

export function getInitDataFromHeaders(request: Request): string | null {
  return request.headers.get("X-Telegram-InitData")?.trim() || null;
}

export async function authenticateInitData(
  initData: string | null,
  botToken: string
): Promise<{ ok: boolean; user?: TelegramUser }> {
  if (!initData) {
    return { ok: false };
  }

  return validateInitData(initData, botToken);
}

export async function validateInitData(initData: string, botToken: string): Promise<{ ok: boolean; user?: TelegramUser }> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return { ok: false };
  }

  const pairs: Array<[string, string]> = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") {
      continue;
    }
    pairs.push([key, value]);
  }

  pairs.sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = pairs.map(([key, value]) => `${key}=${value}`).join("\n");

  const computedHash = await computeTelegramHash(dataCheckString, botToken);
  if (!timingSafeEqual(hash.toLowerCase(), computedHash)) {
    return { ok: false };
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: true };
  }

  let userParsed: TelegramUser | null = null;
  try {
    userParsed = JSON.parse(userRaw) as TelegramUser;
  } catch {
    return { ok: true };
  }

  if (!userParsed) {
    return { ok: true };
  }

  const safeUser: TelegramUser = {
    id: userParsed.id,
    username: userParsed.username,
    first_name: userParsed.first_name,
    last_name: userParsed.last_name,
    photo_url: userParsed.photo_url
  };

  return { ok: true, user: safeUser };
}

async function computeTelegramHash(dataCheckString: string, botToken: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const secret = await crypto.subtle.sign("HMAC", key, encoder.encode(botToken));
  const secretKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", secretKey, encoder.encode(dataCheckString));
  return bufferToHex(signature);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
