export class SpeechToTextError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'SpeechToTextError';
  }
}

/**
 * STT adapter interface. Implementations turn an audio buffer into a transcript
 * and know nothing about Discord or hand-history formatting.
 */
export class SpeechToTextProvider {
  // eslint-disable-next-line no-unused-vars
  async transcribe({ buffer, mimeType, filename }) {
    throw new Error('Not implemented');
  }
}

export class DisabledSpeechToTextProvider extends SpeechToTextProvider {
  async transcribe() {
    const error = new SpeechToTextError('Voice notes are not enabled on this bot (STT_PROVIDER=none).');
    error.code = 'STT_DISABLED';
    throw error;
  }
}
