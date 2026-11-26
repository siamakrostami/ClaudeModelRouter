import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Point SWITCHBOARD_HOME at a fresh temp dir; returns the dir. */
export function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
  process.env.SWITCHBOARD_HOME = dir;
  return dir;
}
