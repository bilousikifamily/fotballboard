import type { Env } from "../env";
import type { TelegramInlineKeyboardMarkup, TelegramMessage, TelegramUpdate } from "../types";

export async function handleUpdate(update: TelegramUpdate, env: Env): Promise<void> {
  const message = getUpdateMessage(update);
  if (!message || !message.chat?.id) {
    return;
  }

  const text = message.text?.trim();
  if (!text) {
    return;
  }

  const command = extractCommand(text, message.entities);
  if (!command) {
    return;
  }

  if (command === "start" || command === "app" || command === "webapp") {
    const webappBaseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
    const imageUrl = `${webappBaseUrl}/images/beginig.png`;
    await sendPhoto(
      env,
      message.chat.id,
      imageUrl,
      "Кожен депутат Футбольної Ради представляє певні фракції.\n\nБез фракції:\n— нема голосу\n— нема впливу\n— нема комунікації",
      {
        inline_keyboard: [[{ text: "ОБРАТИ ФРАКЦІЮ", web_app: { url: env.WEBAPP_URL } }]]
      },
      undefined,
      message.message_thread_id
    );
  }
}

export function getUpdateMessage(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
}

export function extractCommand(
  text: string,
  entities?: Array<{ type?: string; offset?: number; length?: number }>
): string | null {
  const commandFromStart = extractCommandToken(text);
  if (commandFromStart) {
    return commandFromStart;
  }
  if (!entities || entities.length === 0) {
    return null;
  }
  for (const entity of entities) {
    if (entity.type !== "bot_command") {
      continue;
    }
    const offset = entity.offset ?? 0;
    const length = entity.length ?? 0;
    if (length <= 1) {
      continue;
    }
    const token = text.slice(offset, offset + length);
    const parsed = extractCommandToken(token);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export function extractCommandToken(token: string): string | null {
  if (!token.startsWith("/")) {
    return null;
  }
  const raw = token.split(/\s+/)[0]?.slice(1).split("@")[0]?.trim().toLowerCase();
  return raw || null;
}

export async function sendMessage(
  env: Env,
  chatId: number | string,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
  parseMode?: "HTML" | "MarkdownV2",
  messageThreadId?: number
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  if (parseMode) {
    payload.parse_mode = parseMode;
  }
  if (typeof messageThreadId === "number") {
    payload.message_thread_id = messageThreadId;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function sendPhoto(
  env: Env,
  chatId: number | string,
  photoUrl: string,
  caption?: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
  parseMode?: "HTML" | "MarkdownV2",
  messageThreadId?: number
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    photo: photoUrl
  };
  if (caption) {
    payload.caption = caption;
  }
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  if (parseMode) {
    payload.parse_mode = parseMode;
  }
  if (typeof messageThreadId === "number") {
    payload.message_thread_id = messageThreadId;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function deleteMessage(env: Env, chatId: number | string, messageId: number): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/deleteMessage`;
  const payload = {
    chat_id: chatId,
    message_id: messageId
  };

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
