// Stands in for Workers AI in scripts/smoke-chat.mjs. A message containing #retired makes the first model fail,
// as a retired model would, so the fallback gets exercised.
import { WorkerEntrypoint } from 'cloudflare:workers';

type Input = { messages: { role: string; content: string }[]; max_tokens: number };

export default class AiStub extends WorkerEntrypoint {
  async run(model: string, input: Input) {
    const last = input.messages.at(-1)?.content ?? '';
    if (model.includes('gemma') && last.includes('#retired')) throw new Error(`${model}: no such model`);
    const text = `this is an automatic reply, josh hasn't gotten to your message yet but he'll see it. (${model.split('/').pop()}, ${input.messages.length} messages, system first: ${input.messages[0]?.role === 'system'})`;
    const usage = { prompt_tokens: 900, completion_tokens: 60, total_tokens: 960 };
    return model.includes('gemma') ? { choices: [{ message: { role: 'assistant', content: text } }], usage } : { response: text, usage };
  }

  async fetch() {
    return new Response('ai stub');
  }
}
