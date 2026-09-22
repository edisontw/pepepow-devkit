/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PEPEW_WEB_WALLET_URL?: string;
  readonly VITE_PAYMENT_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
