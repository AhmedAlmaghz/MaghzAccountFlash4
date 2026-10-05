/**
 * Minimal typings for the plain-JS relay handler (api/_lib/relayHandler.js).
 * The implementation stays dependency-free JavaScript so the Vercel
 * function, the vite dev twin and the unit tests share it byte-for-byte;
 * this declaration keeps `tsc -b` (tsconfig.node.json) green.
 */

export interface RelayRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  clientIp?: string;
}

export interface RelayResponse {
  status: number;
  body: unknown;
}

export interface RelayHandlerDeps {
  env?: Record<string, string | undefined>;
  pgPool?: ((config: Record<string, unknown>) => {
    query: (sql: string, params?: unknown[]) => Promise<{ rows?: unknown[]; rowCount?: number }>;
    connect: () => Promise<{
      query: (sql: string, params?: unknown[]) => Promise<{ rows?: unknown[]; rowCount?: number }>;
      release: () => void;
    }>;
    end: () => Promise<void>;
  }) | null;
  dnsLookup?: ((host: string) => Promise<string[]>) | null;
  readMigrations?: (() => Promise<Array<{ name: string; sql: string }>>) | null;
  now?: () => number;
}

export interface RelayHandler {
  handle: (req: RelayRequest) => Promise<RelayResponse>;
  privateTargetsAllowed: () => boolean;
}

export function createRelayHandler(deps?: RelayHandlerDeps): RelayHandler;
export const RELAY_VERSION: string;
