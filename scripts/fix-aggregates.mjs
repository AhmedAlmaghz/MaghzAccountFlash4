import fs from 'fs';
const f = 'src/modules/reports/shared/liveAggregates.ts';
let s = fs.readFileSync(f, 'utf8');
s = s.replace('export function pickNum(row: RowWithBase | undefined, key: string): number {',
              'export function pickNum(row: object | null | undefined, key: string): number {');
s = s.replace('export function sumCol(rows: RowWithBase[], key: string): number {',
              'export function sumCol<T extends object>(rows: T[], key: string): number {');
s = s.replace('export function avgCol(rows: RowWithBase[], key: string): number {',
              'export function avgCol<T extends object>(rows: T[], key: string): number {');
s = s.replace('export function percentOf(part: number, whole: number): number {',
              'export function percentOf(part: number, whole: number): number {');
s = s.replace('export function deltaWithPct(current: number, previous: number)',
              'export function deltaWithPct(current: number, previous: number)');
fs.writeFileSync(f, s);
console.log('aggregates fixed');
