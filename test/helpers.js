import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Point CLAUDE_MODEL_ROUTER_HOME at a fresh temp dir; returns the dir. */
export function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmr-test-'));
  process.env.CLAUDE_MODEL_ROUTER_HOME = dir;
  return dir;
}
