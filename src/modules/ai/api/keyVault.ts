/**
 * Device key vault for the browser/PGlite AI bridge (P1-1).
 *
 * Threat model (honest scoping):
 * - Electron keeps the key in OS-encrypted safeStorage — untouched here.
 * - In pure browser mode there is no OS keychain, so the key used to sit as
 *   PLAINTEXT in the `settings` table: every SQL dump, backup export, debug
 *   log or table read leaked it.
 * - This vault encrypts the key with AES-GCM-256 under a NON-EXTRACTABLE
 *   device CryptoKey persisted in a dedicated IndexedDB (`maghz-ai-vault`).
 *   The app DB then holds ciphertext only — dumps/backups/exports no longer
 *   leak the secret, and ordinary `settings` reads never see plaintext.
 * - It does NOT stop a local attacker with DevTools on the live page (they
 *   share the execution context). That is what the server-only mode
 *   (`ai.browser_disabled`) is for — see browserBridge.ts.
 *
 * Envelope: `enc:v1:<base64url-iv>:<base64url-ct>`. Anything else is treated
 * as a legacy plaintext row (backward compatible, upgraded on next save).
 */

const ENVELOPE_PREFIX = 'enc:v1:';
const VAULT_DB = 'maghz-ai-vault';
const VAULT_STORE = 'keys';
const DEVICE_KEY_NAME = 'device-key-v1';

export interface KeyStore {
  load(): Promise<CryptoKey | null>;
  save(key: CryptoKey): Promise<void>;
}

function getSubtle(override?: SubtleCrypto): SubtleCrypto {
  if (override) return override;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto غير متوفر في هذه البيئة — لا يمكن تشفير المفتاح');
  return subtle;
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** In-memory store (tests / non-browser runtimes without IndexedDB). */
export function memoryKeyStore(): KeyStore {
  let key: CryptoKey | null = null;
  return {
    load: async () => key,
    save: async (k: CryptoKey) => { key = k; },
  };
}

/**
 * Shared default store: ONE instance per process. This matters because the
 * memory fallback (non-browser runtimes without IndexedDB) would otherwise
 * be a fresh empty store on every call — encrypt would succeed and decrypt
 * would honestly report "no key" forever. In real browsers this resolves to
 * the persistent IndexedDB vault.
 */
const DEFAULT_STORE_KEY = '__maghzaccount_ai_key_store__';
type GlobalWithAiKeyStore = typeof globalThis & {
  __maghzaccount_ai_key_store__?: KeyStore;
};

export function getDefaultStore(): KeyStore {
  const globalState = globalThis as GlobalWithAiKeyStore;
  if (!globalState[DEFAULT_STORE_KEY]) globalState[DEFAULT_STORE_KEY] = indexedDbKeyStore();
  return globalState[DEFAULT_STORE_KEY];
}

function indexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/**
 * Device key persisted in its OWN IndexedDB (never in the app DB).
 * Non-extractable: page JS can USE it via subtle.* but can never read
 * its raw bytes — the strongest isolation the web platform offers.
 */
export function indexedDbKeyStore(): KeyStore {
  const memory = memoryKeyStore();
  if (!indexedDbAvailable()) return memory;
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(VAULT_DB, 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(VAULT_STORE)) {
            req.result.createObjectStore(VAULT_STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
        req.onblocked = () => reject(new Error('IndexedDB blocked'));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  const tx = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
    const db = await open();
    return db.transaction(VAULT_STORE, mode).objectStore(VAULT_STORE);
  };
  return {
    load: async () => {
      try {
        const store = await tx('readonly');
        const val = await new Promise<CryptoKey | null>((resolve, reject) => {
          const req = store.get(DEVICE_KEY_NAME);
          req.onsuccess = () => resolve((req.result as CryptoKey | undefined) ?? null);
          req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
        });
        return val ?? memory.load();
      } catch {
        return memory.load();
      }
    },
    save: async (key: CryptoKey) => {
      try {
        const store = await tx('readwrite');
        await new Promise<void>((resolve, reject) => {
          const req = store.put(key, DEVICE_KEY_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error ?? new Error('IndexedDB write failed'));
        });
      } catch {
        await memory.save(key);
      }
    },
  };
}

async function getOrCreateDeviceKey(store: KeyStore, subtle: SubtleCrypto): Promise<CryptoKey> {
  const existing = await store.load();
  if (existing) return existing;
  const fresh = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await store.save(fresh);
  return fresh;
}

export interface VaultOptions {
  store?: KeyStore;
  subtle?: SubtleCrypto;
}

export function isEncryptedEnvelope(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt a plaintext API key into the `enc:v1:` envelope. */
export async function encryptApiKey(plaintext: string, opts: VaultOptions = {}): Promise<string> {
  const subtle = getSubtle(opts.subtle);
  const store = opts.store ?? getDefaultStore();
  const key = await getOrCreateDeviceKey(store, subtle);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENVELOPE_PREFIX}${bytesToB64Url(iv)}:${bytesToB64Url(new Uint8Array(ct))}`;
}

/**
 * Decrypt an `enc:v1:` envelope. Returns null when the value is absent or
 * undecryptable (device key lost/rotated) — callers treat that as "no key"
 * and ask the user to re-enter it, never as a crash.
 */
export async function decryptApiKey(
  value: string | null | undefined,
  opts: VaultOptions = {},
): Promise<string | null> {
  if (!value) return null;
  if (!isEncryptedEnvelope(value)) return null;
  try {
    const subtle = getSubtle(opts.subtle);
    const store = opts.store ?? getDefaultStore();
    const key = await store.load();
    if (!key) return null;
    const rest = value.slice(ENVELOPE_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep <= 0) return null;
    const iv = b64UrlToBytes(rest.slice(0, sep));
    const ct = b64UrlToBytes(rest.slice(sep + 1));
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
