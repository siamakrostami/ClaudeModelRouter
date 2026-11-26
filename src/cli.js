import { ROLES, ROLE_INFO } from './core/defaults.js';
import * as store from './core/store.js';

const USAGE = `Usage: claude-model-router [command]

  (no command)                 open the interactive picker (terminal only)
  show                         show the active setup
  list                         list saved setups (* = active)
  use <setup>                  switch to a saved setup
  set <role> <model> [effort]  change one role in the active setup
  save <name>                  save the active setup under a new name and switch to it
  delete <setup>               delete a saved setup
  on | off                     turn routing on/off everywhere (one session only: /router off)
  rules                        write the default keyword rules to rules.json to edit

Roles: ${ROLES.join(', ')}
Models: fable, opus, sonnet, haiku    Efforts: low, medium, high, xhigh, max
`;

function showText() {
  const s = store.activeSetup();
  const on = store.loadSetups().enabled;
  const lines = [`Setup: ${store.activeName()}${on ? '' : '   (routing OFF)'}`, ''];
  for (const r of ROLES) {
    lines.push(`${r.padEnd(8)} ${s[r].model.padEnd(8)} ${s[r].effort.padEnd(7)} ${ROLE_INFO[r]}`);
  }
  return lines.join('\n') + '\n';
}

/** Run the CLI. io = {stdout, stderr, isTTY}. Returns the exit code. */
export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr, isTTY: process.stdout.isTTY && process.stdin.isTTY }) {
  const [cmd, ...rest] = argv.filter(a => a !== '');
  const out = s => io.stdout.write(s);
  try {
    switch (cmd) {
      case undefined:
        if (io.isTTY) {
          const { runPicker } = await import('./picker/app.js');
          await runPicker();
          return 0;
        }
        out(showText());
        return 0;
      case 'show':
        out(showText());
        return 0;
      case 'list': {
        const { active, names } = store.listSetups();
        out(names.map(n => `${n === active ? '*' : ' '} ${n}`).join('\n') + '\n');
        return 0;
      }
      case 'use':
        store.use(rest[0]);
        out(showText());
        return 0;
      case 'set':
        store.setRole(rest[0], rest[1], rest[2]);
        out(showText());
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
        if (rest.length) {
          io.stderr.write(`"${cmd}" takes no arguments and switches routing everywhere. To pause one session, type /router off in it.\n`);
          return 2;
        }
        store.setEnabled(cmd === 'on');
        out(`Routing ${cmd.toUpperCase()}.\n`);
        return 0;
      case 'rules': {
        const { path, created } = store.writeDefaultRules();
        out(created
          ? `Wrote the default rules to ${path}\nEdit the regexes per role; new sessions and the next prompt pick them up.\n`
          : `${path} already exists; edit it (delete it and run this again to start from the defaults).\n`);
        return 0;
      }
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
