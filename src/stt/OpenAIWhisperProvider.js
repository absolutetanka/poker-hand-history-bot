import { SpeechToTextError, SpeechToTextProvider } from './SpeechToTextProvider.js';

/**
 * Server-side STT via any OpenAI-compatible /audio/transcriptions endpoint
 * (OpenAI Whisper, Groq, a self-hosted faster-whisper server, ...).
 */
export class OpenAIWhisperProvider extends SpeechToTextProvider {
  constructor({
    endpoint = 'https://api.openai.com/v1/audio/transcriptions',
    apiKey,
    model = 'whisper-1',
    timeoutMs = 60_000,
    fetchImpl = globalThis.fetch
  }) {
    super();
    this.endpoint = endpoint || 'https://api.openai.com/v1/audio/transcriptions';
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async transcribe({ buffer, mimeType, filename }) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), filename || 'voice-message.ogg');
    form.append('model', this.model);
    // Biases recognition toward poker vocabulary.
    form.append(
      'prompt',
      'Poker hand history: no-limit hold\'em, big blind, small blind, button, cutoff, hijack, under the gun, opens, 3-bets, calls, checks, flop, turn, river, rainbow, suited, offsuit.'
    );

    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {},
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new SpeechToTextError(`Transcription request failed: ${error.message}`, { cause: error });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SpeechToTextError(`Transcription failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = await response.json().catch(() => null);
    const transcript = (data?.text ?? '').trim();
    if (!transcript) throw new SpeechToTextError('Transcription returned empty text');
    return transcript;
  }
}
