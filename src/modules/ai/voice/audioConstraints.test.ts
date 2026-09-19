import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  pickRecorderMime,
  isVoiceRecordingSupported,
  VOICE_MIC_CONSTRAINTS,
  RECORDER_MIME_CANDIDATES,
} from './audioConstraints';

describe('voice audio constraints', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests browser DSP (AEC + noise suppression + AGC)', () => {
    expect(VOICE_MIC_CONSTRAINTS.echoCancellation).toBe(true);
    expect(VOICE_MIC_CONSTRAINTS.noiseSuppression).toBe(true);
    expect(VOICE_MIC_CONSTRAINTS.autoGainControl).toBe(true);
  });

  it('prefers opus/webm, the universal STT-friendly container', () => {
    expect(RECORDER_MIME_CANDIDATES[0]).toContain('webm');
  });

  it('picks the first supported mime in probe order', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (t: string) => t.includes('ogg'),
    });
    expect(pickRecorderMime()).toContain('ogg');
  });

  it('falls back to default when nothing probes', () => {
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false });
    expect(pickRecorderMime()).toBe('');
  });

  it('reports unsupported without MediaRecorder', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    expect(isVoiceRecordingSupported()).toBe(false);
  });
});
