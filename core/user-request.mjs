// Only user-authored text belongs here, never system/developer messages or tool results.
export function userRequest(content) {
  let text = typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter(c => ['text', 'input_text'].includes(c?.type) && typeof c.text === 'string').map(c => c.text).join('\n') : '';
  const request = text.match(/(?:^|\n)## My request:\s*\n/);
  if (request) text = text.slice(request.index + request[0].length);
  else if (/^\s*(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<INSTRUCTIONS>)/.test(text)) return '';
  text = text.replace(/<(image|environment_context|ide_context|system-reminder)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/&#x20;|&#32;|&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 600 ? `${text.slice(0, 599)}…` : text;
}
