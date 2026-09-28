import { SpeechToTextError } from '../stt/SpeechToTextProvider.js';

export const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/wave'
]);

// "audio/ogg; codecs=opus" -> "audio/ogg"
export function baseMimeType(contentType) {
  return contentType?.split(';')[0].trim().toLowerCase() || null;
}

export function findAudioAttachment(message) {
  const attachments = [...(message.attachments?.values?.() ?? [])];
  return (
    attachments.find((attachment) =>
      SUPPORTED_AUDIO_TYPES.has(baseMimeType(attachment.contentType))
    ) ?? null
  );
}

/**
 * Resolves a Discord message into { type: 'text' | 'voice', text }.
 * Returns null when there is no usable text or supported audio.
 */
export function createInputResolver({
  speechToText,
  maxAudioBytes = 25 * 1024 * 1024,
  fetchImpl = globalThis.fetch
}) {
  return async function getUserInput(message) {
    const text = message.content?.trim();
    if (text) return { type: 'text', text };

    const audio = findAudioAttachment(message);
    if (!audio) return null;

    if (audio.size && audio.size > maxAudioBytes) {
      throw new SpeechToTextError(`Voice note is too large (${audio.size} bytes).`);
    }

    let audioResponse;
    try {
      audioResponse = await fetchImpl(audio.url, { signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new SpeechToTextError(`Could not download voice note: ${error.message}`, { cause: error });
    }
    if (!audioResponse.ok) {
      throw new SpeechToTextError(`Could not download voice note (${audioResponse.status})`);
    }

    const buffer = Buffer.from(await audioResponse.arrayBuffer());

    const transcript = await speechToText.transcribe({
      buffer,
      mimeType: baseMimeType(audio.contentType),
      filename: audio.name
    });

    const cleaned = transcript?.trim();
    if (!cleaned) throw new SpeechToTextError('Transcript was empty');

    return { type: 'voice', text: cleaned };
  };
}
