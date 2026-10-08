/**
 * Typings for the plain-JS shared database core (api/_lib/dbCore.js).
 * Keeps `tsc -b` (tsconfig.node.json) green for importers.
 */

export type ConnectionProvider = 'neon' | 'supabase' | 'localhost' | 'generic';

export interface ParsedDbUrl {
  raw: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  strictVerify: boolean;
  provider: ConnectionProvider;
}

export interface PoolConfigOptions {
  timeoutMs?: number;
  max?: number;
  statementTimeoutMs?: number;
}

export declare const DEFAULT_PG_PORT: number;
export declare function trimInvisible(v: unknown): string;
export declare function detectProvider(host: string): ConnectionProvider;
export declare function parseDbUrl(raw: string): ParsedDbUrl;
export declare function poolConfigFromParsed(
  p: ParsedDbUrl,
  timeoutMsOrOpts?: number | PoolConfigOptions,
): Record<string, unknown>;
export declare function redactDatabaseUrl(url: string): string;
export declare function normalizeIdempotent(rawSql: string): string;
export declare function splitMigrationStatements(sql: string): string[];
