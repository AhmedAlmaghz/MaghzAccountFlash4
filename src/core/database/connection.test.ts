import { describe, it, expect } from 'vitest';
import {
  parseDatabaseUrl,
  validateDatabaseUrl,
  redactDatabaseUrl,
  buildDatabaseUrl,
  detectProvider,
  resolveDriver,
  providerLabel,
} from './connection';

describe('detectProvider', () => {
  it('detects Neon hosts', () => {
    expect(detectProvider('ep-cool-123.us-east-2.aws.neon.tech')).toBe('neon');
    expect(detectProvider('NEON.TECH')).toBe('neon');
  });
  it('detects Supabase hosts', () => {
    expect(detectProvider('db.abcd1234.supabase.co')).toBe('supabase');
  });
  it('detects localhost variants', () => {
    expect(detectProvider('localhost')).toBe('localhost');
    expect(detectProvider('127.0.0.1')).toBe('localhost');
    expect(detectProvider('::1')).toBe('localhost');
  });
  it('falls back to generic', () => {
    expect(detectProvider('db.example.com')).toBe('generic');
    expect(detectProvider('34.120.0.1')).toBe('generic');
  });
});

describe('parseDatabaseUrl', () => {
  it('parses a Neon URL with TLS on', () => {
    const p = parseDatabaseUrl('postgres://user:pass@ep-x.aws.neon.tech:5432/mydb?sslmode=require');
    expect(p.host).toBe('ep-x.aws.neon.tech');
    expect(p.port).toBe(5432);
    expect(p.database).toBe('mydb');
    expect(p.user).toBe('user');
    expect(p.password).toBe('pass');
    expect(p.ssl).toBe(true);
    expect(p.provider).toBe('neon');
  });
  it('parses a Supabase URL and defaults the port', () => {
    const p = parseDatabaseUrl('postgresql://postgres:secret@db.xyz.supabase.co/postgres');
    expect(p.port).toBe(5432);
    expect(p.provider).toBe('supabase');
    expect(p.ssl).toBe(true);
  });
  it('decodes URL-encoded credentials', () => {
    const p = parseDatabaseUrl('postgres://us%40er:p%40ss%3Aword@localhost:5433/app');
    expect(p.user).toBe('us@er');
    expect(p.password).toBe('p@ss:word');
    expect(p.provider).toBe('localhost');
    expect(p.ssl).toBe(false);
  });
  it('honors sslmode=disable on remote hosts', () => {
    const p = parseDatabaseUrl('postgres://u:p@db.example.com/db?sslmode=disable');
    expect(p.ssl).toBe(false);
  });
  it('rejects non-postgres schemes', () => {
    expect(() => parseDatabaseUrl('mysql://u:p@h/db')).toThrow(/postgres:\/\//);
  });
  it('rejects missing host / database / user', () => {
    expect(() => parseDatabaseUrl('postgres:///db')).toThrow(/host/);
    expect(() => parseDatabaseUrl('postgres://u@h/')).toThrow(/database/);
    expect(() => parseDatabaseUrl('postgres://:p@h/db')).toThrow(/user/);
  });
  it('rejects empty input', () => {
    expect(() => parseDatabaseUrl('   ')).toThrow(/empty/);
  });
});

describe('validateDatabaseUrl', () => {
  it('returns ok + parsed for valid URLs', () => {
    const r = validateDatabaseUrl('postgres://u:p@localhost/db');
    expect(r.ok).toBe(true);
    expect(r.parsed?.host).toBe('localhost');
  });
  it('returns ok:false with message for garbage', () => {
    const r = validateDatabaseUrl('not a url');
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});

describe('redactDatabaseUrl', () => {
  it('masks the password but keeps the rest', () => {
    const out = redactDatabaseUrl('postgres://admin:s3cret@db.example.com:5432/app');
    expect(out).toContain('admin');
    expect(out).toContain('db.example.com');
    expect(out).not.toContain('s3cret');
    expect(out).toContain('****');
  });
  it('never leaks garbage input', () => {
    expect(redactDatabaseUrl('garbage')).toBe('****');
  });
});

describe('buildDatabaseUrl', () => {
  it('round-trips through parse', () => {
    const url = buildDatabaseUrl({ host: 'db.example.com', port: 5433, database: 'app', user: 'u', password: 'p@ss' });
    const p = parseDatabaseUrl(url);
    expect(p.host).toBe('db.example.com');
    expect(p.port).toBe(5433);
    expect(p.password).toBe('p@ss');
  });
  it('adds sslmode=disable when ssl is false', () => {
    expect(buildDatabaseUrl({ host: 'h', database: 'd', user: 'u', ssl: false })).toContain('sslmode=disable');
  });
});

describe('resolveDriver', () => {
  it('electron serves everything over direct TCP', () => {
    expect(resolveDriver('neon', 'electron')).toBe('direct');
    expect(resolveDriver('supabase', 'electron')).toBe('direct');
    expect(resolveDriver('localhost', 'electron')).toBe('direct');
    expect(resolveDriver('generic', 'electron')).toBe('direct');
  });
  it('web serves only Neon over HTTP (no TCP in browsers)', () => {
    expect(resolveDriver('neon', 'web')).toBe('http');
    expect(resolveDriver('supabase', 'web')).toBeNull();
    expect(resolveDriver('localhost', 'web')).toBeNull();
    expect(resolveDriver('generic', 'web')).toBeNull();
  });
});

describe('providerLabel', () => {
  it('labels every provider', () => {
    expect(providerLabel('neon')).toBe('Neon');
    expect(providerLabel('supabase')).toBe('Supabase');
    expect(providerLabel('localhost')).toBe('Local');
    expect(providerLabel('generic')).toBe('PostgreSQL');
  });
});
