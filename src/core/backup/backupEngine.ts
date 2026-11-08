/**
 * Backup envelope engine — pure functions, no DB, no DOM.
 *
 * File format (`.mab`, JSON envelope):
 *   1. tables → JSON → gzip (or raw when CompressionStream is unavailable)
 *   2. optional AES-GCM-256 encryption (PBKDF2-SHA256, 210k iterations)
 *   3. SHA-256 checksum over the final payload bytes — verified BEFORE any
 *      database write, so a corrupt/tampered file can never half-restore.
 *
 * Secrets (`users.password_hash`) are stripped unless the envelope is
 * encrypted — see SECRET_COLUMNS in backupTables.ts.
 */

import {
  ALL_PLANNED_TABLES,
  DELETE_ORDER,
  INSERT_ORDER,
  RESTORE_SKIP_TABLES,
  RESTORE_UPSERT_TABLES,
  SECRET_COLUMNS,
  USER_REF_COLUMNS,
  isSafeIdentifier,
  type PlannedTable,
} from './backupTables';

export const BACKUP_MAGIC = 'MAGHZBACKUP';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupManifest {
  app: string;
  formatVersion: number;
  companyId: string;
  companyName: string;
  createdAt: string;
  encrypted: boolean;
  compressed: boolean;
  secretsStripped: string[];
  tables: Record<string, { rows: number }>;
  totalRows: number;
}

export interface BackupEnvelope {
  magic: string;
  formatVersion: number;
  manifest: BackupManifest;
  checksum: string;
  encryption?: {
    algo: 'AES-GCM-256';
    kdf: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
    iv: string;
  };
  payload: string;
}

export type TablesMap = Record<string, Record<string, unknown>[]>;

export class BackupError extends Error {
  code:
    | 'INVALID_FILE'
    | 'UNSUPPORTED_VERSION'
    | 'CHECKSUM_MISMATCH'
    | 'PASSWORD_REQUIRED'
    | 'WRONG_PASSWORD'
    | 'DECRYPT_FAILED';
  constructor(code: BackupError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// bytes / base64 helpers (chunked — a backup can be tens of MB)
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBytes(text: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(text);
}

export function fromBytes(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexDecode(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

// ---------------------------------------------------------------------------
// compression (gzip when available, raw otherwise — flagged in the manifest)
// ---------------------------------------------------------------------------

export function gzipSupported(): boolean {
  // Blob.stream() is the missing piece in non-browser runtimes (jsdom) —
  // check the whole chain so callers never half-enter the gzip path.
  try {
    return (
      typeof CompressionStream !== 'undefined' &&
      typeof DecompressionStream !== 'undefined' &&
      typeof new Blob([]).stream === 'function'
    );
  } catch {
    return false;
  }
}

export async function compress(bytes: Uint8Array): Promise<{ data: Uint8Array; compressed: boolean }> {
  if (!gzipSupported()) return { data: bytes, compressed: false };
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return { data: new Uint8Array(buf), compressed: true };
}

export async function decompress(bytes: Uint8Array, compressed: boolean): Promise<Uint8Array> {
  if (!compressed) return bytes;
  if (!gzipSupported()) throw new BackupError('INVALID_FILE', 'Gzip payload but no decompressor available');
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return hexEncode(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// encryption (AES-GCM-256, PBKDF2-SHA256 210k iterations)
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 210000;

async function deriveAesKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', toBytes(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// encode / decode
// ---------------------------------------------------------------------------

export interface EncodeOptions {
  companyId: string;
  companyName: string;
  password?: string;
}

export async function encodeBackup(tables: TablesMap, options: EncodeOptions): Promise<string> {
  const manifestTables: BackupManifest['tables'] = {};
  let totalRows = 0;
  const secretsStripped: string[] = [];
  const encrypted = !!options.password;
  const payloadTables: TablesMap = {};

  for (const [table, rows] of Object.entries(tables)) {
    if (!ALL_PLANNED_TABLES.includes(table)) continue;
    let out = rows;
    if (!encrypted) {
      const secrets = SECRET_COLUMNS[table];
      if (secrets) {
        out = rows.map((row) => {
          const copy = { ...row };
          for (const col of secrets) {
            if (col in copy) {
              delete copy[col];
              const marker = `${table}.${col}`;
              if (!secretsStripped.includes(marker)) secretsStripped.push(marker);
            }
          }
          return copy;
        });
      }
    }
    payloadTables[table] = out;
    manifestTables[table] = { rows: out.length };
    totalRows += out.length;
  }

  const { data: compressed, compressed: didCompress } = await compress(toBytes(JSON.stringify(payloadTables)));

  const envelope: BackupEnvelope = {
    magic: BACKUP_MAGIC,
    formatVersion: BACKUP_FORMAT_VERSION,
    manifest: {
      app: 'maghzaccount-pro',
      formatVersion: BACKUP_FORMAT_VERSION,
      companyId: options.companyId,
      companyName: options.companyName,
      createdAt: new Date().toISOString(),
      encrypted,
      compressed: didCompress,
      secretsStripped,
      tables: manifestTables,
      totalRows,
    },
    checksum: '',
    payload: '',
  };

  let payloadBytes = compressed;
  if (options.password) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveAesKey(options.password, salt);
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, compressed as BufferSource);
    payloadBytes = new Uint8Array(cipher);
    envelope.encryption = {
      algo: 'AES-GCM-256',
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      salt: hexEncode(salt),
      iv: hexEncode(iv),
    };
  }

  envelope.checksum = await sha256Hex(payloadBytes);
  envelope.payload = base64Encode(payloadBytes);
  return JSON.stringify(envelope);
}

export function parseEnvelopeFile(text: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('INVALID_FILE', 'File is not valid JSON');
  }
  const env = parsed as Partial<BackupEnvelope>;
  if (!env || env.magic !== BACKUP_MAGIC || typeof env.payload !== 'string' || !env.manifest) {
    throw new BackupError('INVALID_FILE', 'Not a MaghzAccount backup file');
  }
  if (env.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupError('UNSUPPORTED_VERSION', `Unsupported backup version ${String(env.formatVersion)}`);
  }
  return env as BackupEnvelope;
}

export interface DecodedBackup {
  manifest: BackupManifest;
  tables: TablesMap;
}

export async function decodeBackup(text: string, password?: string): Promise<DecodedBackup> {
  const envelope = parseEnvelopeFile(text);
  const payloadBytes = base64Decode(envelope.payload);

  const actual = await sha256Hex(payloadBytes);
  if (actual !== envelope.checksum) {
    throw new BackupError('CHECKSUM_MISMATCH', 'Backup file is corrupt or was tampered with');
  }

  let plain = payloadBytes;
  if (envelope.manifest.encrypted) {
    if (!password) throw new BackupError('PASSWORD_REQUIRED', 'This backup is encrypted — a password is required');
    if (!envelope.encryption) throw new BackupError('INVALID_FILE', 'Encrypted backup misses key parameters');
    try {
      const key = await deriveAesKey(password, hexDecode(envelope.encryption.salt));
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: hexDecode(envelope.encryption.iv) as BufferSource },
        key,
        payloadBytes as BufferSource,
      );
      plain = new Uint8Array(decrypted);
    } catch {
      throw new BackupError('WRONG_PASSWORD', 'Wrong password or corrupted data');
    }
  } else if (password) {
    // Harmless: user supplied a password for a plain backup — ignore it.
  }

  const tables = JSON.parse(fromBytes(await decompress(plain, envelope.manifest.compressed))) as TablesMap;
  return { manifest: envelope.manifest, tables };
}

// ---------------------------------------------------------------------------
// SQL composers — renderer fallback path AND the contract the main-process
// handler mirrors. Table/column names are whitelisted; values are params.
// ---------------------------------------------------------------------------

export interface SqlStatement {
  sql: string;
  params: unknown[];
}

function assertPlannedTable(plan: PlannedTable): void {
  if (!isSafeIdentifier(plan.table)) throw new BackupError('INVALID_FILE', `Unsafe table name: ${plan.table}`);
}

/** SELECT composer for the backup read path. */
export function selectForScope(plan: PlannedTable): { sql: string } {
  assertPlannedTable(plan);
  const scope = plan.scope;
  if (scope.type === 'company') {
    return { sql: `SELECT * FROM ${plan.table} WHERE company_id = $1` };
  }
  if (scope.type === 'single') {
    if (!isSafeIdentifier(scope.idColumn)) throw new BackupError('INVALID_FILE', 'Unsafe id column');
    return { sql: `SELECT * FROM ${plan.table} WHERE ${scope.idColumn} = $1` };
  }
  if (!isSafeIdentifier(scope.parent) || !isSafeIdentifier(scope.fk)) {
    throw new BackupError('INVALID_FILE', 'Unsafe parent reference');
  }
  return {
    sql: `SELECT c.* FROM ${plan.table} c JOIN ${scope.parent} p ON p.id = c.${scope.fk} WHERE p.company_id = $1`,
  };
}

function toSqlValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** DELETE composer for the restore path (FK-safe order comes from the plan). */
export function deleteForScope(plan: PlannedTable): { sql: string } {
  assertPlannedTable(plan);
  const scope = plan.scope;
  if (scope.type === 'company') {
    return { sql: `DELETE FROM ${plan.table} WHERE company_id = $1` };
  }
  if (scope.type === 'single') {
    if (!isSafeIdentifier(scope.idColumn)) throw new BackupError('INVALID_FILE', 'Unsafe id column');
    return { sql: `DELETE FROM ${plan.table} WHERE ${scope.idColumn} = $1` };
  }
  if (!isSafeIdentifier(scope.parent) || !isSafeIdentifier(scope.fk)) {
    throw new BackupError('INVALID_FILE', 'Unsafe parent reference');
  }
  return {
    sql: `DELETE FROM ${plan.table} WHERE ${scope.fk} IN (SELECT id FROM ${scope.parent} WHERE company_id = $1)`,
  };
}

/**
 * Full restore batch for one company. Best-practice restore contract
 * (mirrored by the main-process `db:restore-company` handler):
 *
 * 1. Wipe EVERY planned table (not just payload-present ones) so restoring an
 *    older backup cannot leave stale rows that hit RESTRICT FKs.
 * 2. `users` is never restored — identity/security data; the target's users
 *    are preserved (RESTORE_SKIP_TABLES).
 * 3. `companies` is upserted, never deleted — deleting it would CASCADE-wipe
 *    every user account (RESTORE_UPSERT_TABLES).
 * 4. User references (created_by / assigned_to / …) are resolved against the
 *    target's existing users; dangling ids are re-attributed to the restoring
 *    user (USER_REF_COLUMNS).
 *
 * Unknown tables and unsafe columns are skipped (reported via `warnings`) —
 * a backup file is untrusted input.
 */
export interface RestoreOptions {
  /** User ids that exist in the target database (users are never restored). */
  knownUserIds?: ReadonlySet<string>;
  /** Re-attribute dangling user references to this user (the restorer). */
  fallbackUserId?: string | null;
}

function resolveUserRef(value: unknown, options: RestoreOptions): unknown {
  if (value === null || value === undefined || value === '') return null;
  const id = String(value);
  if (options.knownUserIds?.has(id)) return id;
  return options.fallbackUserId ?? null;
}

export function composeRestoreBatch(
  companyId: string,
  tables: TablesMap,
  options: RestoreOptions = {},
): { statements: SqlStatement[]; warnings: string[] } {
  const statements: SqlStatement[] = [];
  const warnings: string[] = [];

  // Safety valve: a payload with no planned table at all (garbage/foreign
  // file) must not wipe the database. decodeBackup already verified the
  // envelope, so real backups always contain at least `companies`.
  const plannedPayload = INSERT_ORDER.filter((p) => Array.isArray(tables[p.table]));
  if (plannedPayload.length === 0) {
    const unknown = Object.keys(tables).map((t) => `${t}: unknown table, skipped`);
    return { statements: [], warnings: unknown.length > 0 ? unknown : ['no restorable tables in backup'] };
  }

  // DELETE phase: wipe every planned table in FK-safe order (children →
  // documents → masters). DELETE_ORDER is the canonical delete order — using
  // INSERT_ORDER here would delete `units` before `product_units` (RESTRICT)
  // and fail identically. This runs BEFORE any insert so old backups missing
  // newer tables cannot leave RESTRICT-referenced rows behind.
  for (const plan of DELETE_ORDER) {
    if (RESTORE_SKIP_TABLES.includes(plan.table)) continue;
    if (RESTORE_UPSERT_TABLES.includes(plan.table)) continue;
    statements.push({ ...deleteForScope(plan), params: [companyId] });
  }
  if (Array.isArray(tables.users)) {
    warnings.push('users: identity data is never restored; existing users were preserved');
  }

  for (const plan of plannedPayload) {
    const rows = tables[plan.table] as Record<string, unknown>[];
    if (RESTORE_SKIP_TABLES.includes(plan.table)) continue;
    if (rows.length === 0) continue; // empty table — already wiped above

    const columns = Array.from(
      new Set(rows.flatMap((r) => Object.keys(r)).filter((c) => isSafeIdentifier(c))),
    );
    if (columns.length === 0) {
      warnings.push(`${plan.table}: no safe columns, skipped`);
      continue;
    }
    const userRefs = USER_REF_COLUMNS[plan.table] ?? [];
    const isUpsert = RESTORE_UPSERT_TABLES.includes(plan.table);
    // One multi-row INSERT per chunk keeps huge restores to few statements.
    // Chunk at 500 rows so a single statement never grows unbounded.
    const CHUNK_ROWS = 500;
    const cols = columns.join(', ');
    const setClause = columns.filter((c) => c !== 'id');
    const conflictClause = isUpsert
      ? setClause.length > 0
        ? ` ON CONFLICT (id) DO UPDATE SET ${setClause.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
        : ' ON CONFLICT (id) DO NOTHING'
      : '';
    for (let start = 0; start < rows.length; start += CHUNK_ROWS) {
      const params: unknown[] = [];
      const groups = rows.slice(start, start + CHUNK_ROWS).map((row) => {
        const placeholders = columns.map((col) => {
          const raw = (row as Record<string, unknown>)[col];
          params.push(userRefs.includes(col) ? resolveUserRef(raw, options) : toSqlValue(raw));
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      statements.push({
        sql: `INSERT INTO ${plan.table} (${cols}) VALUES ${groups.join(', ')}${conflictClause}`,
        params,
      });
    }
  }

  for (const unknown of Object.keys(tables)) {
    if (!INSERT_ORDER.some((p) => p.table === unknown)) warnings.push(`${unknown}: unknown table, skipped`);
  }
  return { statements, warnings };
}
