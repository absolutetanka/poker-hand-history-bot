import { BrowserSpeechBridgeProvider } from './BrowserSpeechBridgeProvider.js';
import { OpenAIWhisperProvider } from './OpenAIWhisperProvider.js';
import { DisabledSpeechToTextProvider } from './SpeechToTextProvider.js';

/** Builds the single enabled STT provider from config (STT_PROVIDER). */
export function createSpeechToText(sttConfig) {
  switch (sttConfig.provider) {
    case 'browser_bridge':
      return new BrowserSpeechBridgeProvider(sttConfig);
    case 'openai_whisper':
      return new OpenAIWhisperProvider(sttConfig);
    case 'none':
    case '':
    case undefined:
      return new DisabledSpeechToTextProvider();
    default:
      throw new Error(`Unknown STT_PROVIDER "${sttConfig.provider}"`);
  }
}
