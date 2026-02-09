import type { AdminChatMessage, AdminChatThread, LeaderboardUser } from "./types";
import { postAdminLogin, fetchAdminChatMessages, fetchAdminChatThreads, sendAdminChatMessage } from "./api/admin";
import { fetchLeaderboard } from "./api/leaderboard";
import { renderAdminChatMessages, renderAdminChatThreads } from "./screens/adminUsers";

const API_BASE = import.meta.env.VITE_API_BASE ?? (typeof window !== "undefined" ? window.location.origin : "");
const BUILD_STAMP = import.meta.env.VITE_BUILD_STAMP ?? "";
const ADMIN_TOKEN_KEY = "admin_token";

let adminSessionToken: string | null = null;
let threads: AdminChatThread[] = [];
let messages: AdminChatMessage[] = [];
let selectedUserId: number | null = null;
let fallbackUsers: LeaderboardUser[] = [];

const loginPanel = document.querySelector<HTMLElement>("[data-login-panel]");
const messagesPanel = document.querySelector<HTMLElement>("[data-messages-panel]");
const loginForm = document.querySelector<HTMLFormElement>("[data-login-form]");
const loginError = document.querySelector<HTMLElement>("[data-login-error]");
const logoutButton = document.querySelector<HTMLButtonElement>("[data-logout]");
const buildBadge = document.querySelector<HTMLElement>("[data-admin-build]");
const threadsList = document.querySelector<HTMLElement>("[data-admin-chat-threads]");
const threadsStatus = document.querySelector<HTMLElement>("[data-admin-chat-threads-status]");
const messagesList = document.querySelector<HTMLElement>("[data-admin-chat-messages]");
const messagesStatus = document.querySelector<HTMLElement>("[data-admin-chat-form-status]");
const messagesRefresh = document.querySelector<HTMLButtonElement>("[data-admin-chat-messages-refresh]");
const threadsRefresh = document.querySelector<HTMLButtonElement>("[data-admin-chat-refresh]");
const selectedLabel = document.querySelector<HTMLElement>("[data-admin-chat-selected]");
const chatForm = document.querySelector<HTMLFormElement>("[data-admin-chat-form]");
const chatInput = document.querySelector<HTMLTextAreaElement>("[data-admin-chat-input]");

function showLogin(): void {
  loginPanel?.classList.remove("is-hidden");
  messagesPanel?.classList.add("is-hidden");
}

function showMessages(): void {
  loginPanel?.classList.add("is-hidden");
  messagesPanel?.classList.remove("is-hidden");
}

function updateBuildBadge(): void {
  if (!buildBadge) {
    return;
  }
  buildBadge.textContent = BUILD_STAMP ? `build ${BUILD_STAMP}` : `build ${import.meta.env.MODE ?? "local"}`;
}

function setStatus(el: HTMLElement | null, text: string): void {
  if (el) {
    el.textContent = text;
  }
}

function renderThreads(): void {
  if (!threadsList) {
    return;
  }
  const activeThreads = threads.length > 0 ? threads : fallbackUsers.map((user) => ({
    user_id: user.id,
    chat_id: user.id,
    direction: null,
    sender: null,
    message_type: null,
    last_text: null,
    last_message_at: user.last_seen_at ?? null,
    username: user.username ?? null,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    nickname: user.nickname ?? null,
    photo_url: user.photo_url ?? null,
    last_seen_at: user.last_seen_at ?? null
  }));
  if (activeThreads.length === 0) {
    threadsList.innerHTML = "";
    setStatus(threadsStatus, "Поки що немає чатів.");
  } else {
    threadsList.innerHTML = renderAdminChatThreads(activeThreads, selectedUserId);
    setStatus(threadsStatus, "");
  }
  if (selectedLabel) {
    selectedLabel.textContent = selectedUserId ? `Чат з id:${selectedUserId}` : "Оберіть користувача";
  }
}

function renderMessages(): void {
  if (messagesList) {
    messagesList.innerHTML = renderAdminChatMessages(messages);
    messagesList.scrollTop = messagesList.scrollHeight;
  }
}

async function loadThreads(selectFirst = false): Promise<void> {
  if (!API_BASE) {
    return;
  }
  const token = adminSessionToken ?? "";
  if (!token) {
    setStatus(threadsStatus, "Потрібна авторизація.");
    return;
  }
  setStatus(threadsStatus, "Завантаження...");
  try {
    const { response, data } = await fetchAdminChatThreads(API_BASE, token, { limit: 60 });
    if (!response.ok || !data.ok) {
      setStatus(threadsStatus, "Не вдалося завантажити чати.");
      return;
    }
    threads = data.threads ?? [];
    fallbackUsers = [];
    if (threads.length === 0) {
      const { response: usersResponse, data: usersData } = await fetchLeaderboard(API_BASE, "", 200, token);
      if (usersResponse.ok && usersData.ok) {
        fallbackUsers = usersData.users ?? [];
      }
    }
    if (selectFirst && !selectedUserId && threads.length > 0) {
      const first = threads[0]?.user_id ?? null;
      if (typeof first === "number") {
        selectedUserId = first;
      }
    } else if (selectFirst && !selectedUserId && threads.length === 0 && fallbackUsers.length > 0) {
      selectedUserId = fallbackUsers[0]?.id ?? null;
    }
    renderThreads();
  } catch {
    setStatus(threadsStatus, "Не вдалося завантажити чати.");
  }
}

async function loadMessages(): Promise<void> {
  if (!API_BASE || !selectedUserId) {
    return;
  }
  const token = adminSessionToken ?? "";
  if (!token) {
    setStatus(messagesStatus, "Потрібна авторизація.");
    return;
  }
  setStatus(messagesStatus, "Завантаження...");
  try {
    const { response, data } = await fetchAdminChatMessages(API_BASE, token, {
      userId: selectedUserId,
      limit: 120
    });
    if (!response.ok || !data.ok) {
      setStatus(messagesStatus, "Не вдалося завантажити повідомлення.");
      return;
    }
    messages = data.messages ?? [];
    setStatus(messagesStatus, "");
    renderMessages();
  } catch {
    setStatus(messagesStatus, "Не вдалося завантажити повідомлення.");
  }
}

async function handleLogin(event: Event): Promise<void> {
  event.preventDefault();
  if (!loginForm || !API_BASE) {
    return;
  }
  const formData = new FormData(loginForm);
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    setStatus(loginError, "Введіть логін і пароль.");
    return;
  }
  const submitButton = loginForm.querySelector<HTMLButtonElement>("button[type=submit]");
  submitButton?.setAttribute("disabled", "true");
  try {
    const { response, data } = await postAdminLogin(API_BASE, { username, password });
    if (!response.ok || !data.ok || !data.token) {
      setStatus(loginError, "Невірний логін або пароль.");
      return;
    }
    adminSessionToken = data.token;
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    }
    setStatus(loginError, "");
    showMessages();
    await loadThreads(true);
    await loadMessages();
  } catch {
    setStatus(loginError, "Не вдалося виконати вхід.");
  } finally {
    submitButton?.removeAttribute("disabled");
  }
}

function handleLogout(): void {
  adminSessionToken = null;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }
  threads = [];
  messages = [];
  selectedUserId = null;
  if (threadsList) {
    threadsList.innerHTML = "";
  }
  if (messagesList) {
    messagesList.innerHTML = "";
  }
  showLogin();
}

async function handleSend(event: Event): Promise<void> {
  event.preventDefault();
  if (!API_BASE || !selectedUserId || !chatInput) {
    return;
  }
  const token = adminSessionToken ?? "";
  if (!token) {
    setStatus(messagesStatus, "Потрібна авторизація.");
    return;
  }
  const text = chatInput.value.trim();
  if (!text) {
    return;
  }
  const submitButton = chatForm?.querySelector<HTMLButtonElement>("button[type=submit]");
  submitButton?.setAttribute("disabled", "true");
  setStatus(messagesStatus, "Відправка...");
  try {
    const { response, data } = await sendAdminChatMessage(API_BASE, token, { user_id: selectedUserId, text });
    if (!response.ok || !data.ok) {
      setStatus(messagesStatus, "Не вдалося надіслати повідомлення.");
      return;
    }
    chatInput.value = "";
    setStatus(messagesStatus, "");
    await loadMessages();
    await loadThreads();
  } catch {
    setStatus(messagesStatus, "Не вдалося надіслати повідомлення.");
  } finally {
    submitButton?.removeAttribute("disabled");
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", handleLogin);
}
logoutButton?.addEventListener("click", handleLogout);
threadsRefresh?.addEventListener("click", () => {
  void loadThreads(true);
});
messagesRefresh?.addEventListener("click", () => {
  void loadMessages();
});
threadsList?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-admin-chat-thread]");
  if (!button) {
    return;
  }
  const userIdRaw = button.dataset.adminChatThread || "";
  const userId = Number.parseInt(userIdRaw, 10);
  if (!Number.isFinite(userId)) {
    return;
  }
  selectedUserId = userId;
  renderThreads();
  void loadMessages();
});
chatForm?.addEventListener("submit", handleSend);

updateBuildBadge();

if (typeof sessionStorage !== "undefined") {
  const storedToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
  if (storedToken) {
    adminSessionToken = storedToken;
    showMessages();
    void loadThreads(true).then(loadMessages);
  } else {
    showLogin();
  }
} else {
  showLogin();
}
