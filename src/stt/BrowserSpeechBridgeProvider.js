import { SpeechToTextError, SpeechToTextProvider } from './SpeechToTextProvider.js';

/**
 * Sends audio to a separate browser-based STT worker (e.g. Playwright + Chromium
 * running the Web Speech API) over HTTP.
 *
 * Bridge contract:
 *   POST {STT_ENDPOINT}
 *   Content-Type: <audio mime type>
 *   X-Filename: <original filename>
 *   Authorization: Bearer <STT_API_KEY>   (only if configured)
 *   body: raw audio bytes
 *
 *   200 -> { "transcript": "..." }  (or { "text": "..." })
 */
export class BrowserSpeechBridgeProvider extends SpeechToTextProvider {
  constructor({ endpoint, apiKey, timeoutMs = 60_000, fetchImpl = globalThis.fetch }) {
    super();
    if (!endpoint) throw new Error('STT_ENDPOINT is required for STT_PROVIDER=browser_bridge');
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  async transcribe({ buffer, mimeType, filename }) {
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType || 'application/octet-stream',
          ...(filename ? { 'X-Filename': encodeURIComponent(filename) } : {}),
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: buffer,
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch (error) {
      throw new SpeechToTextError(`STT bridge request failed: ${error.message}`, { cause: error });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SpeechToTextError(`STT bridge failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = await response.json().catch(() => null);
    const transcript = (data?.transcript ?? data?.text ?? '').trim();
    if (!transcript) throw new SpeechToTextError('STT bridge returned an empty transcript');
    return transcript;
  }
}
