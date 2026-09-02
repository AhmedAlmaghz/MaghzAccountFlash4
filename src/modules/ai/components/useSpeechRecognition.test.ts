import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSpeechRecognition, getSpeechRecognitionCtor } from './useSpeechRecognition';

class MockRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
  static instances: MockRecognition[] = [];
  constructor() {
    MockRecognition.instances.push(this);
  }
}

function makeResult(transcript: string, isFinal: boolean) {
  return { isFinal, 0: { transcript } };
}

describe('useSpeechRecognition', () => {
  beforeEach(() => {
    MockRecognition.instances = [];
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', MockRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects support via webkitSpeechRecognition', () => {
    expect(getSpeechRecognitionCtor()).toBe(MockRecognition);
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    expect(result.current.isSupported).toBe(true);
  });

  it('reports unsupported and refuses to start when API is missing', () => {
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    expect(result.current.isSupported).toBe(false);
    expect(result.current.start(onTranscript)).toBe(false);
    expect(result.current.isListening).toBe(false);
  });

  it('starts listening with the requested language and continuous mode', () => {
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    let started = false;
    act(() => {
      started = result.current.start(vi.fn());
    });
    expect(started).toBe(true);
    expect(result.current.isListening).toBe(true);
    const rec = MockRecognition.instances[0];
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(rec.lang).toBe('ar-SA');
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
  });

  it('emits interim then final segments without re-emitting visited results', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(onTranscript);
    });
    const rec = MockRecognition.instances[0];

    // Interim hypothesis
    act(() => {
      rec.onresult?.({ resultIndex: 0, results: [makeResult('مرحبا', false)] });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('مرحبا', false);

    // Same result index now finalized — must be emitted exactly once
    act(() => {
      rec.onresult?.({ resultIndex: 0, results: [makeResult('مرحبا بك', true)] });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('مرحبا بك', true);

    // A re-fired event with an already-visited index (engine restart quirk)
    // must NOT re-emit — this is the duplicate-words guard.
    const callsBefore = onTranscript.mock.calls.length;
    act(() => {
      rec.onresult?.({ resultIndex: 0, results: [makeResult('مرحبا بك', true)] });
    });
    expect(onTranscript.mock.calls.length).toBe(callsBefore);

    // A genuinely new segment still flows through — all live interims of
    // the event are composed into a single hypothesis call.
    act(() => {
      rec.onresult?.({ resultIndex: 1, results: [makeResult('مرحبا', false), makeResult('كيف حالك', false)] });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('مرحبا كيف حالك', false);
  });

  it('stops listening when recognition ends', () => {
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(vi.fn());
    });
    const rec = MockRecognition.instances[0];
    act(() => {
      result.current.stop();
    });
    expect(rec.stop).toHaveBeenCalledTimes(1);
    act(() => {
      rec.onend?.();
    });
    expect(result.current.isListening).toBe(false);
  });

  it('surfaces permission errors but ignores benign no-speech/aborted', () => {
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(vi.fn());
    });
    const rec = MockRecognition.instances[0];

    act(() => {
      rec.onerror?.({ error: 'no-speech' });
    });
    expect(result.current.error).toBeNull();

    act(() => {
      rec.onerror?.({ error: 'not-allowed' });
    });
    expect(result.current.error).toBe('not-allowed');
  });

  it('clears the previous error when starting a new session after stop', () => {
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(vi.fn());
    });
    const first = MockRecognition.instances[0];
    act(() => {
      first.onerror?.({ error: 'network' });
    });
    // Explicit stop disables auto-restart, then end finishes the session
    act(() => {
      result.current.stop();
      first.onend?.();
    });
    expect(result.current.error).toBe('network');
    act(() => {
      result.current.start(vi.fn());
    });
    expect(result.current.error).toBeNull();
  });

  it('auto-restarts on silence while the user keeps listening', () => {
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(vi.fn());
    });
    const first = MockRecognition.instances[0];
    // Chrome ends the session on silence — without an explicit stop we
    // transparently create a fresh engine and keep listening.
    act(() => {
      first.onend?.();
    });
    expect(result.current.isListening).toBe(true);
    expect(MockRecognition.instances.length).toBe(2);
    expect(MockRecognition.instances[1].start).toHaveBeenCalledTimes(1);
    expect(MockRecognition.instances[1].continuous).toBe(true);
    // The restarted engine shares the result handler (guarded, no dupes)
    expect(typeof MockRecognition.instances[1].onresult).toBe('function');
  });

  it('aborts any live session on unmount', () => {
    const { result, unmount } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(vi.fn());
    });
    const rec = MockRecognition.instances[0];
    unmount();
    expect(rec.abort).toHaveBeenCalledTimes(1);
  });

  it('refuses to start twice without stopping', () => {
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(vi.fn());
    });
    let second = true;
    act(() => {
      second = result.current.start(vi.fn());
    });
    expect(second).toBe(false);
    expect(MockRecognition.instances).toHaveLength(1);
  });
});
