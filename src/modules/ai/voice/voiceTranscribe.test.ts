import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transcribeVoiceNote } from './voiceTranscribe';
import { aiApi } from '../api';

vi.mock('../api', () => ({
  aiApi: { complete: vi.fn() },
}));

const WAV_B64 = 'UklGRgAAABdBVUUAQAEAACgAAAAgAAAAQAAAAEAAQACAgA=';

describe('transcribeVoiceNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends wav input_audio with temperature 0 and no tools', async () => {
    vi.mocked(aiApi.complete).mockResolvedValue({
      success: true,
      data: { content: 'فاتورة جديدة', toolCalls: [], finishReason: 'stop', usage: null },
    });
    const res = await transcribeVoiceNote({
      companyId: 'comp-1',
      wavBase64: WAV_B64,
      wavBytes: 1000,
      lang: 'ar',
    });
    expect(res.success).toBe(true);
    expect(res.text).toBe('فاتورة جديدة');
    const payload = vi.mocked(aiApi.complete).mock.calls[0][0];
    expect(payload.companyId).toBe('comp-1');
    expect(payload.temperature).toBe(0);
    expect(payload.tools).toBeUndefined();
    const parts = (payload.messages[0].content || []) as Array<{ type: string; input_audio?: { data: string; format: string } }>;
    const audio = parts.find((p) => p.type === 'input_audio');
    expect(audio?.input_audio?.format).toBe('wav');
    expect(audio?.input_audio?.data).toBe(WAV_B64);
  });

  it('rejects empty and oversized payloads without calling the provider', async () => {
    const empty = await transcribeVoiceNote({ companyId: 'c', wavBase64: '', wavBytes: 0, lang: 'ar' });
    expect(empty.success).toBe(false);
    const big = await transcribeVoiceNote({ companyId: 'c', wavBase64: WAV_B64, wavBytes: 20 * 1024 * 1024, lang: 'ar' });
    expect(big.success).toBe(false);
    expect(big.error).toBe('too_long');
    expect(vi.mocked(aiApi.complete)).not.toHaveBeenCalled();
  });

  it('passes provider errors through honestly', async () => {
    vi.mocked(aiApi.complete).mockResolvedValue({ success: false, error: 'مفتاح API غير مضبوط' });
    const res = await transcribeVoiceNote({ companyId: 'c', wavBase64: WAV_B64, wavBytes: 10, lang: 'ar' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('مفتاح API غير مضبوط');
  });

  it('treats unintelligible markers as failure', async () => {
    vi.mocked(aiApi.complete).mockResolvedValue({
      success: true,
      data: { content: '[غير مفهوم]', toolCalls: [], finishReason: 'stop', usage: null },
    });
    const res = await transcribeVoiceNote({ companyId: 'c', wavBase64: WAV_B64, wavBytes: 10, lang: 'ar' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('empty_transcript');
  });
});
