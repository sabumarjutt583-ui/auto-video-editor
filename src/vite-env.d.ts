/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" only in the Admin Edition build. */
  readonly VITE_ADMIN?: string;
}
