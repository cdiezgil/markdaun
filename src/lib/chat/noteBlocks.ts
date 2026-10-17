export type NoteMode = 'create' | 'append';

export type MessageSegment =
  | { type: 'text'; text: string }
  | { type: 'note'; path: string; mode: NoteMode; content: string };

const BLOCK_RE = /```markdaun-note([^\n]*)\n([\s\S]*?)\n```/g;

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

/** Split an assistant message into text segments and note proposals. */
export function parseNoteBlocks(message: string): MessageSegment[] {
  const out: MessageSegment[] = [];
  let last = 0;
  let pending = ''; // text accumulated, including rejected blocks

  const pushText = (t: string) => {
    pending += t;
  };
  const flush = () => {
    if (pending !== '') out.push({ type: 'text', text: pending });
    pending = '';
  };

  for (const m of message.matchAll(BLOCK_RE)) {
    const index = m.index ?? 0;
    pushText(message.slice(last, index));
    last = index + m[0].length;

    const path = attr(m[1], 'path');
    const modeRaw = attr(m[1], 'mode') ?? 'create';
    const valid =
      path !== null && path.toLowerCase().endsWith('.md') && (modeRaw === 'create' || modeRaw === 'append');
    if (!valid) {
      pushText(m[0]);
      continue;
    }
    flush();
    out.push({ type: 'note', path, mode: modeRaw, content: m[2] });
  }
  pushText(message.slice(last));
  flush();
  return out.length ? out : [{ type: 'text', text: message }];
}
