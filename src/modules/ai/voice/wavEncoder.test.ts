import { describe, it, expect } from 'vitest';
import { encodeWavMono16k } from './wavEncoder';

describe('encodeWavMono16k', () => {
  it('writes a valid RIFF/WAVE header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const wav = encodeWavMono16k(samples, 16000);
    const ascii = (offset: number, len: number) =>
      String.fromCharCode(...wav.subarray(offset, offset + len));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
    const view = new DataView(wav.buffer);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
  });

  it('clips out-of-range samples instead of overflowing', () => {
    const wav = encodeWavMono16k(new Float32Array([2, -2]), 16000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });

  it('encodes silence as zeros', () => {
    const wav = encodeWavMono16k(new Float32Array(160), 16000);
    expect(wav.length).toBe(44 + 320);
    const view = new DataView(wav.buffer);
    for (let i = 0; i < 160; i++) expect(view.getInt16(44 + i * 2, true)).toBe(0);
  });
});
