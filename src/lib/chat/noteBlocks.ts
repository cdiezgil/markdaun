export type NoteMode = 'create' | 'append';

export type MessageSegment =
  | { type: 'text'; text: string }
  | { type: 'note'; path: string; mode: NoteMode; content: string; adjusted?: boolean };

const OPEN = '```markdaun-note';

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

/**
 * Finds the position of the closing `\n\`\`\`` fence in `body`, tracking inner
 * code-fence depth so that Mermaid/code blocks inside a note are not mistaken
 * for the block closer. Returns -1 if no closing fence is found.
 */
function findClosingFence(body: string): number {
  let depth = 0;
  let pos = 0;
  while (pos < body.length) {
    const nl = body.indexOf('\n```', pos);
    if (nl === -1) return -1;
    const after = body[nl + 4];
    const bare = after === undefined || after === '\n' || after === '\r';
    if (bare) {
      if (depth === 0) return nl;
      depth--;
    } else {
      depth++;
    }
    pos = nl + 4;
  }
  return -1;
}

/** Split an assistant message into text segments and note proposals. */
export function parseNoteBlocks(message: string): MessageSegment[] {
  const out: MessageSegment[] = [];
  let pos = 0;
  let pending = '';

  const flush = () => {
    if (pending !== '') out.push({ type: 'text', text: pending });
    pending = '';
  };

  while (pos < message.length) {
    const openIdx = message.indexOf(OPEN, pos);
    if (openIdx === -1) {
      pending += message.slice(pos);
      break;
    }
    pending += message.slice(pos, openIdx);
    const afterOpen = message.indexOf('\n', openIdx + OPEN.length);
    if (afterOpen === -1) {
      pending += message.slice(openIdx);
      break;
    }
    const attrs = message.slice(openIdx + OPEN.length, afterOpen);
    const body = message.slice(afterOpen + 1);
    const closeRel = findClosingFence(body);
    if (closeRel === -1) {
      pending += message.slice(openIdx);
      break;
    }
    const content = body.slice(0, closeRel);
    const blockEnd = afterOpen + 1 + closeRel + 4; // past \n```
    pos = blockEnd;

    const path = attr(attrs, 'path');
    const modeRaw = attr(attrs, 'mode') ?? 'create';
    const valid =
      path !== null && path.toLowerCase().endsWith('.md') && (modeRaw === 'create' || modeRaw === 'append');
    if (!valid) {
      pending += message.slice(openIdx, blockEnd);
      continue;
    }
    flush();
    const adjusted = attr(attrs, 'adjusted') === 'true';
    out.push(adjusted
      ? { type: 'note', path, mode: modeRaw as NoteMode, content, adjusted }
      : { type: 'note', path, mode: modeRaw as NoteMode, content });
  }
  flush();
  return out.length ? out : [{ type: 'text', text: message }];
}
