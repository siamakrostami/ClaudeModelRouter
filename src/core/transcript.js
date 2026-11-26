import fs from 'node:fs';

const TAIL_BYTES = 256 * 1024;
const COMMAND_RE = /(?:Set|Kept) model (?:to|as) `(Fable|Opus|Sonnet|Haiku)\b/gi;
const ASSISTANT_RE = /"model":"claude-(fable|opus|sonnet|haiku)-/g;

function lastMatch(re, text) {
  let last = null;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) last = m;
  return last;
}

/** Which model family is the main chat on? Reads only the tail of the transcript; null if unknown. */
export function detectMainModel(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  let fd;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8');
    const a = lastMatch(COMMAND_RE, text);
    const b = lastMatch(ASSISTANT_RE, text);
    const pick = a && b ? (a.index > b.index ? a : b) : a || b;
    return pick ? pick[1].toLowerCase() : null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}
