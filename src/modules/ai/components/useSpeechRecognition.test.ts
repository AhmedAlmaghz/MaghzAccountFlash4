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

  it('emits interim and final transcript segments', () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(onTranscript);
    });
    const rec = MockRecognition.instances[0];

    act(() => {
      rec.onresult?.({ resultIndex: 0, results: [makeResult('مرحبا', false)] });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('مرحبا', false);

    act(() => {
      rec.onresult?.({ resultIndex: 0, results: [makeResult('مرحبا بك', true)] });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('مرحبا بك', true);
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

  it('clears the previous error when starting a new session', () => {
    const { result } = renderHook(() => useSpeechRecognition('ar-SA'));
    act(() => {
      result.current.start(vi.fn());
    });
    const first = MockRecognition.instances[0];
    act(() => {
      first.onerror?.({ error: 'network' });
      first.onend?.();
    });
    expect(result.current.error).toBe('network');
    act(() => {
      result.current.start(vi.fn());
    });
    expect(result.current.error).toBeNull();
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
