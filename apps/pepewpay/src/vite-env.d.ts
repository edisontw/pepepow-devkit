/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PEPEW_WEB_WALLET_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
