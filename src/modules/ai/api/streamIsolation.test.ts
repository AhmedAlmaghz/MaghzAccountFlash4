import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { aiApi } from './index';
import type { LlmMessage } from '../types';

interface CapturedSub {
  id: string;
  onChunk: (c: { type: 'content'; content: string }) => void;
  onDone: (r: { success: boolean; error?: string }) => void;
  unsubscribed: boolean;
}

function makeSubscribeBridge() {
  const subs: CapturedSub[] = [];
  const started: Array<{ streamId?: string }> = [];
  const stopped: string[] = [];
  const fake = {
    startStream: vi.fn((payload: { streamId?: string }) => {
      started.push({ streamId: payload.streamId });
    }),
    subscribeStream: vi.fn((id: string, onChunk: CapturedSub['onChunk'], onDone: CapturedSub['onDone']) => {
      const sub: CapturedSub = { id, onChunk, onDone, unsubscribed: false };
      subs.push(sub);
      return () => { sub.unsubscribed = true; };
    }),
    stopStream: vi.fn((payload: { streamId: string }) => {
      stopped.push(payload.streamId);
    }),
  };
  return { fake, subs, started, stopped };
}

function makeLegacyBridge() {
  let chunkCb: ((c: unknown) => void) | null = null;
  let doneCb: ((r: unknown) => void) | null = null;
  const fake = {
    startStream: vi.fn(),
    onStreamChunk: vi.fn((cb: (c: unknown) => void) => { chunkCb = cb; }),
    onStreamDone: vi.fn((cb: (r: unknown) => void) => { doneCb = cb; }),
    removeStreamListeners: vi.fn(() => { chunkCb = null; doneCb = null; }),
    emitChunk: (c: unknown) => chunkCb?.(c),
    emitDone: (r: unknown) => doneCb?.(r),
  };
  return { fake };
}

const msg = (content: string): LlmMessage => ({ role: 'user', content });
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('aiApi.startStream â€” per-stream isolation', () => {
  // jsdom: the bridge is read off the real window object.
  const win = window as unknown as { electronAI?: unknown };

  beforeEach(() => {
    vi.resetAllMocks();
    delete win.electronAI;
  });

  afterEach(() => {
    delete win.electronAI;
  });

  it('carries a unique streamId per stream and routes chunks only to their owner', async () => {
    const { fake, subs, started } = makeSubscribeBridge();
    win.electronAI = fake;

    const genA = aiApi.startStream({ companyId: 'c', messages: [msg('a')] });
    const genB = aiApi.startStream({ companyId: 'c', messages: [msg('b')] });
    const pA = genA.next();
    const pB = genB.next();
    await tick();
    await tick();

    expect(subs).toHaveLength(2);
    expect(started).toHaveLength(2);
    const [idA, idB] = started.map((s) => s.streamId);
    expect(typeof idA).toBe('string');
    expect(idA).not.toBe(idB);
    expect(subs[0].id).toBe(idA);
    expect(subs[1].id).toBe(idB);

    // A chunk for B must not resolve A's pending next().
    subs[1].onChunk({ type: 'content', content: 'hello-B' });
    const rB = await pB;
    expect(rB.done).toBe(false);
    if (!rB.done) expect(rB.value).toEqual({ type: 'content', content: 'hello-B' });

    const raceA = await Promise.race([
      pA.then(() => 'resolved'),
      Promise.resolve().then(() => 'pending'),
    ]);
    expect(raceA).toBe('pending');

    // Finishing A must unsubscribe only A and leave B alive.
    subs[0].onDone({ success: true });
    const rA = await pA;
    expect(rA.done).toBe(true);
    expect(subs[0].unsubscribed).toBe(true);
    expect(subs[1].unsubscribed).toBe(false);
  });

  it('return() unsubscribes and asks the host to stop provider traffic', async () => {
    const { fake, subs, stopped } = makeSubscribeBridge();
    win.electronAI = fake;

    const gen = aiApi.startStream({ companyId: 'c', messages: [msg('a')] });
    const p = gen.next();
    await tick();
    await tick();
    expect(subs).toHaveLength(1);

    await gen.return();
    expect(subs[0].unsubscribed).toBe(true);
    expect(stopped).toEqual([subs[0].id]);
    // The abandoned next() stays parked by design (watchdog owns recovery);
    // return() itself must settle.
    await expect(Promise.race([p.then(() => 'resolved'), tick().then(() => 'parked')])).resolves.toBe('parked');
  });

  it('falls back to the legacy shared-channel path on older bridges', async () => {
    const { fake } = makeLegacyBridge();
    win.electronAI = fake;

    const gen = aiApi.startStream({ companyId: 'c', messages: [msg('a')] });
    const p = gen.next();
    await tick();
    await tick();
    expect(fake.startStream).toHaveBeenCalledOnce();

    fake.emitChunk({ type: 'content', content: 'legacy-hi' });
    const r = await p;
    expect(r.done).toBe(false);

    fake.emitDone({ success: true });
    const r2 = await gen.next();
    expect(r2.done).toBe(true);
    expect(fake.removeStreamListeners).toHaveBeenCalled();
  });
});
