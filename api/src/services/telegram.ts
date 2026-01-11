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
    await sendMessage(env, message.chat.id, "Готово ✅ Натисни кнопку, щоб відкрити WebApp", {
      inline_keyboard: [[{ text: "Open WebApp", web_app: { url: env.WEBAPP_URL } }]]
    });
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
