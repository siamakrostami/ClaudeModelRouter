import { ROLES, ROLE_INFO } from './core/defaults.js';
import * as store from './core/store.js';
import { clean } from './core/safe.js';

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
  const lines = [`Setup: ${clean(store.activeName(), 40)}${on ? '' : '   (routing OFF)'}`, ''];
  for (const r of ROLES) {
    lines.push(`${r.padEnd(8)} ${s[r].model.padEnd(8)} ${s[r].effort.padEnd(7)} ${ROLE_INFO[r]}`);
  }
  return lines.join('\n') + '\n';
}

const NAMED = { save: '<name>', use: '<setup>', delete: '<setup>' };

/**
 * Run the CLI. io = {stdout, stderr, isTTY, loadPicker?}. Returns the exit code.
 * loadPicker imports the Ink picker; tests pass one that fails.
 */
export async function main(argv, io = { stdout: process.stdout, stderr: process.stderr, isTTY: process.stdout.isTTY && process.stdin.isTTY }) {
  const [cmd, ...rest] = argv.filter(a => a !== '');
  const out = s => io.stdout.write(s);
  if (Object.hasOwn(NAMED, cmd ?? '') && rest[0] === undefined) {
    io.stderr.write(`Usage: claude-model-router ${cmd} ${NAMED[cmd]}\n`);
    return 2;
  }
  try {
    switch (cmd) {
      case undefined:
        if (io.isTTY) {
          let picker = null;
          try {
            picker = await (io.loadPicker ?? (() => import('./picker/app.js')))();
          } catch (e) {
            io.stderr.write(`The interactive picker could not load (${clean(e?.message, 80)}); showing the setup instead.\n`);
          }
          if (picker) {
            await picker.runPicker();
            return 0;
          }
        }
        out(showText());
        return 0;
      case 'show':
        out(showText());
        return 0;
      case 'list': {
        const { active, names } = store.listSetups();
        out(names.map(n => `${n === active ? '*' : ' '} ${clean(n, 40)}`).join('\n') + '\n');
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
        out(`Saved and switched to "${clean(rest[0], 40)}".\n`);
        return 0;
      case 'delete':
        store.remove(rest[0]);
        out(`Deleted "${clean(rest[0], 40)}".\n`);
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
          ? `Wrote the default rules to ${path}\nAdd plain words or phrases per role (the built-in entries are regexes; keep them as they are); new sessions and the next prompt pick them up.\n`
          : `${path} already exists; edit it (delete it and run this again to start from the defaults).\n`);
        return 0;
      }
      case 'help':
      case '--help':
      case '-h':
        out(USAGE);
        return 0;
      default:
        io.stderr.write(`Unknown command "${clean(cmd, 40)}".\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    io.stderr.write(`${clean(e.message, 400)}\n`);
    return 2;
  }
}
