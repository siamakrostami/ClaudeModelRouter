import { ROLES, ROLE_INFO } from './core/defaults.js';
import * as store from './core/store.js';
import { statusSegment } from './core/status.js';

const USAGE = `Usage: switchboard [command]

  (no command)                 open the interactive picker (terminal only)
  show                         show the active setup
  list                         list saved setups (* = active)
  use <setup>                  switch to a saved setup
  set <role> <model> [effort]  change one role in the active setup
  save <name>                  save the active setup under a new name and switch to it
  delete <setup>               delete a saved setup
  on | off                     turn routing on/off (add --session <id> for one session only)
  status-segment [session]     print the status line segment

Roles: ${ROLES.join(', ')}
Models: fable, opus, sonnet, haiku    Efforts: low, medium, high, xhigh, max
`;

function takeSession(argv) {
  const args = [...argv];
  let session = null;
  const i = args.indexOf('--session');
  if (i !== -1) {
    const v = args[i + 1];
    session = v && !v.startsWith('-') ? v : null;
    args.splice(i, v !== undefined && !v.startsWith('-') ? 2 : 1);
  }
  return { args: args.filter(a => a !== ''), session, sessionFlag: i !== -1 };
}

function showText(session) {
  const s = store.activeSetup();
  const on = session ? store.sessionEnabled(session) : store.loadSetups().enabled;
  const lines = [`Setup: ${store.activeName()}${on ? '' : '   (routing OFF' + (session ? ' for this session' : '') + ')'}`, ''];
  for (const r of ROLES) {
    lines.push(`${r.padEnd(8)} ${s[r].model.padEnd(8)} ${s[r].effort.padEnd(7)} ${ROLE_INFO[r]}`);
  }
  if (process.env.CLAUDE_CODE_SUBAGENT_MODEL) {
    lines.push('', `Warning: CLAUDE_CODE_SUBAGENT_MODEL=${process.env.CLAUDE_CODE_SUBAGENT_MODEL} is set and overrides every helper's model.`);
  }
  return lines.join('\n') + '\n';
}

/** Run the CLI. io = {stdout, stderr, isTTY}. Returns the exit code. */
export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr, isTTY: process.stdout.isTTY && process.stdin.isTTY }) {
  const { args, session, sessionFlag } = takeSession(argv);
  const [cmd, ...rest] = args;
  const out = s => io.stdout.write(s);
  try {
    switch (cmd) {
      case undefined:
        if (io.isTTY) {
          const { runPicker } = await import('./picker/app.js');
          await runPicker();
          return 0;
        }
        out(showText(session));
        return 0;
      case 'show':
        out(showText(session));
        return 0;
      case 'list': {
        const { active, names } = store.listSetups();
        out(names.map(n => `${n === active ? '*' : ' '} ${n}`).join('\n') + '\n');
        return 0;
      }
      case 'use':
        store.use(rest[0]);
        out(showText(session));
        return 0;
      case 'set':
        store.setRole(rest[0], rest[1], rest[2]);
        out(showText(session));
        return 0;
      case 'save':
        store.saveAs(rest[0]);
        out(`Saved and switched to "${rest[0]}".\n`);
        return 0;
      case 'delete':
        store.remove(rest[0]);
        out(`Deleted "${rest[0]}".\n`);
        return 0;
      case 'on':
      case 'off':
        if (sessionFlag && !session) {
          io.stderr.write('No session id was passed, so nothing changed. Use `switchboard on|off` in a terminal for a global switch.\n');
          return 2;
        }
        store.setEnabled(cmd === 'on', session || undefined);
        out(`Routing ${cmd.toUpperCase()}${session ? ' for this session' : ''}.\n`);
        return 0;
      case 'status-segment':
        out(statusSegment(rest[0] || session || null));
        return 0;
      case 'help':
      case '--help':
      case '-h':
        out(USAGE);
        return 0;
      default:
        io.stderr.write(`Unknown command "${cmd}".\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    io.stderr.write(`${e.message}\n`);
    return 2;
  }
}
