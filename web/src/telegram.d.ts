export {};

declare global {
  interface TelegramWebAppUser {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    photo_url?: string;
  }

  interface TelegramWebApp {
    initData: string;
    ready(): void;
  }

  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}
