import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";
import type {
  TelegramCallbackQuery,
  TelegramInlineKeyboardMarkup,
  TelegramLabeledPrice,
  TelegramMessage,
  TelegramPreCheckoutQuery,
  TelegramSuccessfulPayment,
  TelegramUpdate,
  TelegramUser
} from "../types";

const SUBSCRIPTION_TITLE = "Доступ до бота на 1 місяць";
const SUBSCRIPTION_DESCRIPTION = "Перший місяць безкоштовний, далі 100⭐.";
const SUBSCRIPTION_CURRENCY = "XTR";
const FREE_MONTH_PRICE = 0;
const REGULAR_MONTH_PRICE = 100;
const KYIV_TIMEZONE = "Europe/Kyiv";
const SUBSCRIPTION_CARD_CALLBACK = "subscription_pay";
const SUBSCRIPTION_CARD_IMAGE = "/subscription.png";

export async function handleUpdate(
  update: TelegramUpdate,
  env: Env,
  supabase?: SupabaseClient | null
): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env, supabase);
    return;
  }

  if (update.pre_checkout_query) {
    await handlePreCheckout(update.pre_checkout_query, env, supabase);
    return;
  }

  const message = getUpdateMessage(update);
  if (!message || !message.chat?.id) {
    return;
  }

  if (message.successful_payment) {
    await handleSuccessfulPayment(message, env, supabase);
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

  if (command === "pay" || command === "subscribe") {
    await showSubscriptionCard(env, supabase, message);
    return;
  }

  if (command === "status") {
    await handleSubscriptionStatus(env, supabase, message);
    return;
  }

  if (command === "start" || command === "app" || command === "webapp") {
    if (supabase) {
      const subscription = await loadSubscriptionInfo(supabase, message.from);
      if (!subscription) {
        await sendMessage(env, message.chat.id, "Не вдалося перевірити підписку. Спробуйте пізніше.");
        return;
      }
      if (!subscription.isActive) {
        await sendMessage(
          env,
          message.chat.id,
          buildSubscriptionPrompt(subscription.price),
          undefined,
          undefined,
          message.message_thread_id
        );
        return;
      }
    }
    const webappBaseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
    const imageUrl = `${webappBaseUrl}/images/beginig_fraction1.png`;
    await sendPhoto(
      env,
      message.chat.id,
      imageUrl,
      "Кожен депутат Футбольної Ради\nмає долучитись до ФРАКЦІЇ.\n\nБез фракції:\n— нема голосу\n— нема комунікації\n— нема впливу",
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

async function handleSubscriptionInvoice(
  env: Env,
  supabase: SupabaseClient | null | undefined,
  message: TelegramMessage
): Promise<void> {
  if (!message.chat?.id) {
    return;
  }
  if (!supabase || !message.from) {
    await sendMessage(env, message.chat.id, "Оплата тимчасово недоступна, спробуйте пізніше.");
    return;
  }

  await upsertTelegramUser(supabase, message.from);
  const subscription = await loadSubscriptionInfo(supabase, message.from);
  if (!subscription) {
    await sendMessage(env, message.chat.id, "Не вдалося перевірити підписку. Спробуйте пізніше.");
    return;
  }

  if (subscription.isActive) {
    const label = subscription.expiresAt ? formatDate(subscription.expiresAt) : "невідомий";
    await sendMessage(env, message.chat.id, `Підписка активна до ${label}.`);
    return;
  }

  if (!subscription.freeMonthUsed) {
    await grantFreeMonth(env, supabase, message.from, message.chat.id);
    return;
  }

  const payload = buildInvoicePayload(message.from.id, subscription.price);
  const prices: TelegramLabeledPrice[] = [{ label: "Підписка на 1 місяць", amount: subscription.price }];
  await sendInvoice(env, message.chat.id, {
    title: SUBSCRIPTION_TITLE,
    description: SUBSCRIPTION_DESCRIPTION,
    payload,
    currency: SUBSCRIPTION_CURRENCY,
    prices
  });
}

async function handleSubscriptionStatus(
  env: Env,
  supabase: SupabaseClient | null | undefined,
  message: TelegramMessage
): Promise<void> {
  if (!message.chat?.id) {
    return;
  }
  const subscription = await loadSubscriptionInfo(supabase, message.from);
  if (!subscription) {
    await sendMessage(env, message.chat.id, "Не вдалося перевірити підписку. Спробуйте пізніше.");
    return;
  }

  if (!subscription.expiresAt) {
    await sendMessage(env, message.chat.id, "Підписка відсутня. Для доступу використайте /pay.");
    return;
  }

  const expiresLabel = formatDate(subscription.expiresAt);
  const statusLabel = subscription.isActive ? "активна" : "прострочена";
  await sendMessage(env, message.chat.id, `Підписка ${statusLabel} до ${expiresLabel}.`);
}

async function showSubscriptionCard(
  env: Env,
  supabase: SupabaseClient | null | undefined,
  message: TelegramMessage
): Promise<void> {
  if (!message.chat?.id) {
    return;
  }
  if (!supabase || !message.from) {
    await sendMessage(env, message.chat.id, "Оплата тимчасово недоступна, спробуйте пізніше.");
    return;
  }

  await upsertTelegramUser(supabase, message.from);
  const subscription = await loadSubscriptionInfo(supabase, message.from);
  if (!subscription) {
    await sendMessage(env, message.chat.id, "Не вдалося перевірити підписку. Спробуйте пізніше.");
    return;
  }

  const expiresLine = subscription.expiresAt
    ? `Поточна підписка дійсна до ${formatDate(subscription.expiresAt)}.`
    : "Підписка відсутня.";
  const renewalLine = subscription.freeMonthUsed
    ? "Щоб продовжити, оплатіть 100 ⭐ за наступний місяць."
    : "Перший місяць безкоштовний, далі 100 ⭐ на місяць.";
  const buttonText = subscription.freeMonthUsed
    ? "Продовжити 100 ⭐ /pay"
    : "Отримати перший місяць /pay";
  const caption = [
    "Підписка «Секретар Ради»",
    expiresLine,
    renewalLine,
    "Натисни кнопку нижче — команда /pay запускає оплату."
  ].join("\n");
  const webappBaseUrl = env.WEBAPP_URL.replace(/\/+$/, "");
  const imageUrl = `${webappBaseUrl}${SUBSCRIPTION_CARD_IMAGE}`;
  await sendPhoto(env, message.chat.id, imageUrl, caption, {
    inline_keyboard: [[{ text: buttonText, callback_data: SUBSCRIPTION_CARD_CALLBACK }]]
  });
}

async function handleCallbackQuery(
  callback: TelegramCallbackQuery,
  env: Env,
  supabase?: SupabaseClient | null
): Promise<void> {
  if (!callback.message || !callback.message.chat?.id) {
    await answerCallbackQuery(env, callback.id, "Не вдалося виконати дію.");
    return;
  }

  if (callback.data === SUBSCRIPTION_CARD_CALLBACK) {
    const proxyMessage: TelegramMessage = {
      ...callback.message,
      from: callback.from
    };
    await handleSubscriptionInvoice(env, supabase, proxyMessage);
    await answerCallbackQuery(env, callback.id);
    return;
  }

  await answerCallbackQuery(env, callback.id);
}

async function handlePreCheckout(
  query: TelegramPreCheckoutQuery,
  env: Env,
  supabase?: SupabaseClient | null
): Promise<void> {
  if (!supabase || !query.from) {
    await answerPreCheckoutQuery(env, query.id, false, "Оплата тимчасово недоступна.");
    return;
  }

  const payload = parseInvoicePayload(query.invoice_payload);
  if (!payload || payload.userId !== query.from.id) {
    await answerPreCheckoutQuery(env, query.id, false, "Невірний платіжний запит.");
    return;
  }

  const subscription = await loadSubscriptionInfo(supabase, query.from);
  if (!subscription) {
    await answerPreCheckoutQuery(env, query.id, false, "Не вдалося перевірити підписку.");
    return;
  }

  const expectedAmount = subscription.price;
  if (query.currency !== SUBSCRIPTION_CURRENCY || query.total_amount !== expectedAmount) {
    await answerPreCheckoutQuery(env, query.id, false, "Невірна сума платежу.");
    return;
  }

  await answerPreCheckoutQuery(env, query.id, true);
}

async function handleSuccessfulPayment(
  message: TelegramMessage,
  env: Env,
  supabase?: SupabaseClient | null
): Promise<void> {
  const payment: TelegramSuccessfulPayment | undefined = message.successful_payment;
  const user = message.from;
  if (!payment || !user || !message.chat?.id) {
    return;
  }
  if (!supabase) {
    await sendMessage(env, message.chat.id, "Платіж отримано, але підтвердити підписку не вдалося.");
    return;
  }

  const payload = parseInvoicePayload(payment.invoice_payload);
  if (!payload || payload.userId !== user.id) {
    await sendMessage(env, message.chat.id, "Платіж отримано, але дані не співпали. Напишіть в підтримку.");
    return;
  }

  const subscription = await loadSubscriptionInfo(supabase, user);
  if (!subscription) {
    await sendMessage(env, message.chat.id, "Платіж отримано, але підтвердити підписку не вдалося.");
    return;
  }

  if (payment.currency !== SUBSCRIPTION_CURRENCY || payment.total_amount !== subscription.price) {
    await sendMessage(env, message.chat.id, "Платіж отримано, але сума не співпала. Напишіть в підтримку.");
    return;
  }

  const nextExpiry = computeNextExpiry(subscription.expiresAt);
  const nextPaidMonths = subscription.paidMonths + 1;
  await upsertTelegramUser(supabase, user, {
    subscription_expires_at: nextExpiry.toISOString(),
    subscription_paid_months: nextPaidMonths,
    subscription_free_month_used: true
  });

  const expiresLabel = formatDate(nextExpiry);
  await sendMessage(env, message.chat.id, `Оплату отримано ✅ Доступ активний до ${expiresLabel}.`);
}

function buildSubscriptionPrompt(price: number): string {
  const priceLabel =
    price === FREE_MONTH_PRICE ? "Перший місяць безкоштовний, далі 100 ⭐." : `Вартість місяця: ${price} ⭐.`;
  return [
    "Доступ до бота доступний за підпискою.",
    priceLabel,
    "Для оплати використайте команду /pay."
  ].join("\n");
}

type SubscriptionInfo = {
  expiresAt: Date | null;
  isActive: boolean;
  paidMonths: number;
  price: number;
  freeMonthUsed: boolean;
};

async function loadSubscriptionInfo(
  supabase: SupabaseClient | null | undefined,
  user?: TelegramUser
): Promise<SubscriptionInfo | null> {
  if (!supabase || !user?.id) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("subscription_expires_at, subscription_paid_months, subscription_free_month_used")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.error("Failed to load subscription info", error);
      return null;
    }

    const expiresAtValue = data?.subscription_expires_at ?? null;
    const expiresAt = expiresAtValue ? new Date(expiresAtValue) : null;
    const paidMonths = Number.isFinite(data?.subscription_paid_months)
      ? Number(data?.subscription_paid_months)
      : 0;
    const freeMonthRaw = data?.subscription_free_month_used;
    const freeMonthUsed =
      typeof freeMonthRaw === "boolean" ? freeMonthRaw : paidMonths > 0;
    const now = new Date();
    const isActive = Boolean(expiresAt && expiresAt.getTime() > now.getTime());
    const price = freeMonthUsed ? REGULAR_MONTH_PRICE : FREE_MONTH_PRICE;

    return { expiresAt, isActive, paidMonths, price, freeMonthUsed };
  } catch (error) {
    console.error("Failed to load subscription info", error);
    return null;
  }
}

async function grantFreeMonth(
  env: Env,
  supabase: SupabaseClient,
  user: TelegramUser,
  chatId: number | string
): Promise<void> {
  const nextExpiry = computeNextExpiry(null);
  await upsertTelegramUser(supabase, user, {
    subscription_expires_at: nextExpiry.toISOString(),
    subscription_free_month_used: true
  });
  const expiresLabel = formatDate(nextExpiry);
  await sendMessage(
    env,
    chatId,
    `Перший місяць безкоштовний ✅ Доступ до ${expiresLabel}. Наступного місяця — ${REGULAR_MONTH_PRICE} ⭐.`
  );
}

async function upsertTelegramUser(
  supabase: SupabaseClient,
  user: TelegramUser,
  extra?: {
    subscription_expires_at?: string;
    subscription_paid_months?: number;
    subscription_free_month_used?: boolean;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    id: user.id,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    updated_at: now
  };
  if (extra?.subscription_expires_at) {
    payload.subscription_expires_at = extra.subscription_expires_at;
  }
  if (typeof extra?.subscription_paid_months === "number") {
    payload.subscription_paid_months = extra.subscription_paid_months;
  }
  if (typeof extra?.subscription_free_month_used === "boolean") {
    payload.subscription_free_month_used = extra.subscription_free_month_used;
  }

  const { error } = await supabase.from("users").upsert(payload, { onConflict: "id" });
  if (error) {
    console.error("Failed to upsert telegram user", error);
  }
}

function computeNextExpiry(current?: Date | null): Date {
  const now = new Date();
  const base = current && current.getTime() > now.getTime() ? current : now;
  return endOfNextMonthInKyiv(base);
}

function endOfNextMonthInKyiv(base: Date): Date {
  const { year, month } = getKyivYearMonth(base);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const lastDay = daysInMonth(nextYear, nextMonth);
  return zonedTimeToUtc(nextYear, nextMonth, lastDay, 23, 59, 59, KYIV_TIMEZONE);
}

function getKyivYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KYIV_TIMEZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value ?? "0");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  return { year, month };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const guessDate = new Date(utcGuess);
  const offsetMinutes = getTimeZoneOffsetMinutes(guessDate, timeZone);
  const utc = utcGuess - offsetMinutes * 60_000;
  const adjustedDate = new Date(utc);
  const adjustedOffset = getTimeZoneOffsetMinutes(adjustedDate, timeZone);
  if (adjustedOffset !== offsetMinutes) {
    return new Date(utcGuess - adjustedOffset * 60_000);
  }
  return adjustedDate;
}

function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const lookup = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.get("year") ?? "0");
  const month = Number(lookup.get("month") ?? "1");
  const day = Number(lookup.get("day") ?? "1");
  const hour = Number(lookup.get("hour") ?? "0");
  const minute = Number(lookup.get("minute") ?? "0");
  const second = Number(lookup.get("second") ?? "0");
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return (asUtc - date.getTime()) / 60_000;
}

function formatDate(value: Date): string {
  const iso = value.toISOString();
  return iso.slice(0, 10);
}

function buildInvoicePayload(userId: number, price: number): string {
  return `sub:v1:u${userId}:p${price}`;
}

function parseInvoicePayload(payload?: string | null): { userId: number; price: number } | null {
  if (!payload) {
    return null;
  }
  const match = /^sub:v1:u(\d+):p(\d+)$/.exec(payload.trim());
  if (!match) {
    return null;
  }
  return { userId: Number(match[1]), price: Number(match[2]) };
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

export async function sendInvoice(
  env: Env,
  chatId: number | string,
  payload: {
    title: string;
    description: string;
    payload: string;
    currency: string;
    prices: TelegramLabeledPrice[];
  }
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/sendInvoice`;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    title: payload.title,
    description: payload.description,
    payload: payload.payload,
    provider_token: "",
    currency: payload.currency,
    prices: payload.prices
  };

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export async function answerPreCheckoutQuery(
  env: Env,
  queryId: string,
  ok: boolean,
  errorMessage?: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerPreCheckoutQuery`;
  const payload: Record<string, unknown> = {
    pre_checkout_query_id: queryId,
    ok
  };
  if (!ok && errorMessage) {
    payload.error_message = errorMessage;
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function answerCallbackQuery(env: Env, queryId: string, text?: string): Promise<void> {
  const url = `https://api.telegram.org/bot${env.BOT_TOKEN}/answerCallbackQuery`;
  const payload: Record<string, unknown> = {
    callback_query_id: queryId
  };
  if (text) {
    payload.text = text;
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
