// Runs the text pipeline (LLM -> validate -> format) without Discord.
// Usage: npm run parse -- "1/2 NL. I'm BB with Ks3h. CO makes it 5, I call. Flop K94r."
//
// Uses process.exitCode rather than process.exit(): exiting while fetch sockets
// are still closing crashes Node on Windows (UV_HANDLE_CLOSING assertion).
import { parseHandWithLLM } from '../src/llm/llmClient.js';
import { formatHandHistory } from '../src/poker/formatter.js';

async function main() {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    console.error('Usage: npm run parse -- "<hand description>"');
    return 1;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is not set (add it to .env).');
    return 1;
  }

  try {
    const hand = await parseHandWithLLM({ type: 'text', text });
    if (process.env.SHOW_JSON) console.log(JSON.stringify(hand, null, 2), '\n');
    console.log(formatHandHistory(hand));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

process.exitCode = await main();
