interface Env {
  BOT_TOKEN: string;
  WEBAPP_URL: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthcheck") {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === "/api/auth") {
      if (request.method === "OPTIONS") {
        return corsResponse();
      }
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, corsHeaders());
      }

      let body: { initData?: string } | null = null;
      try {
        body = (await request.json()) as { initData?: string };
      } catch {
        return jsonResponse({ ok: false, error: "bad_json" }, 400, corsHeaders());
      }

      const initData = body?.initData?.trim();
      if (!initData) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      const valid = await validateInitData(initData, env.BOT_TOKEN);
      if (!valid.ok) {
        return jsonResponse({ ok: false, error: "bad_initData" }, 401, corsHeaders());
      }

      return jsonResponse({ ok: true, user: valid.user }, 200, corsHeaders());
    }

    if (url.pathname === "/tg/webhook") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      let update: TelegramUpdate | null = null;
      try {
        update = (await request.json()) as TelegramUpdate;
      } catch {
        return new Response("Bad Request", { status: 400 });
      }

      await handleUpdate(update, env);
      return new Response("ok");
    }

    return new Response("Not Found", { status: 404 });
  }
};

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function corsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function jsonResponse(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers
  };
  return new Response(JSON.stringify(data), { status, headers: baseHeaders });
}

async function validateInitData(initData: string, botToken: string): Promise<{ ok: boolean; user?: TelegramUser }>{
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

async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = update.message;
  if (!message || !message.chat?.id) {
    return;
  }

  const text = message.text || "";
  if (!text) {
    return;
  }

  if (text.startsWith("/start")) {
    await sendMessage(env, message.chat.id, "Готово ✅ Натисни кнопку, щоб відкрити WebApp", {
      inline_keyboard: [[{ text: "Open WebApp", web_app: { url: env.WEBAPP_URL } }]]
    });
    return;
  }

  await sendMessage(env, message.chat.id, "ok");
}

async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id?: number;
  text?: string;
  chat?: { id?: number };
}

interface TelegramInlineKeyboardMarkup {
  inline_keyboard: Array<Array<{ text: string; web_app: { url: string } }>>;
}

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}
