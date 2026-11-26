import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { ROLES, MODELS, EFFORTS, ROLE_INFO } from '../core/defaults.js';
import * as store from '../core/store.js';

const h = React.createElement;

const MODEL_COLOR = { fable: 'magentaBright', opus: 'yellowBright', sonnet: 'cyanBright', haiku: 'greenBright' };
const EFFORT_BAR = e => '●'.repeat(EFFORTS.indexOf(e) + 1) + '○'.repeat(EFFORTS.length - EFFORTS.indexOf(e) - 1);
const cycle = (list, value, step) => list[(list.indexOf(value) + step + list.length) % list.length];

function snapshot() {
  const d = store.loadSetups();
  return { setup: store.activeSetup(), active: d.active, names: Object.keys(d.setups), enabled: d.enabled };
}

function Header({ s }) {
  return h(Box, { borderStyle: 'round', borderColor: 'gray', paddingX: 1, justifyContent: 'space-between' },
    h(Text, null, h(Text, { bold: true, color: 'whiteBright' }, '⇢ Claude Model Router'), h(Text, { color: 'gray' }, '  model routing for Claude Code')),
    h(Text, null,
      h(Text, { color: 'gray' }, 'setup '), h(Text, { bold: true, color: 'blueBright' }, s.active),
      h(Text, { color: 'gray' }, '   routing '),
      h(Text, { bold: true, color: s.enabled ? 'greenBright' : 'redBright' }, s.enabled ? 'ON' : 'OFF')));
}

function RoleTable({ s, cursor }) {
  return h(Box, { flexDirection: 'column', paddingX: 1, marginTop: 1 },
    h(Box, null,
      h(Box, { width: 3 }), h(Box, { width: 10 }, h(Text, { color: 'gray' }, 'ROLE')),
      h(Box, { width: 12 }, h(Text, { color: 'gray' }, 'MODEL')),
      h(Box, { width: 16 }, h(Text, { color: 'gray' }, 'EFFORT')),
      h(Text, { color: 'gray' }, 'HANDLES')),
    ...ROLES.map((r, i) => {
      const sel = i === cursor;
      const { model, effort } = s.setup[r];
      return h(Box, { key: r },
        h(Box, { width: 3 }, h(Text, { color: 'blueBright' }, sel ? '❯' : ' ')),
        h(Box, { width: 10 }, h(Text, { bold: sel, color: sel ? 'whiteBright' : undefined }, r)),
        h(Box, { width: 12 }, h(Text, { color: MODEL_COLOR[model], bold: true }, sel ? `‹ ${model} ›` : `  ${model}`)),
        h(Box, { width: 16 }, h(Text, { color: sel ? 'whiteBright' : 'gray' }, `${EFFORT_BAR(effort)} ${effort}`)),
        h(Text, { color: 'gray', wrap: 'truncate' }, ROLE_INFO[r]));
    }));
}

function Footer({ mode, input, s, listCursor, toast }) {
  const key = (k, label) => h(Text, null, h(Text, { color: 'blueBright', bold: true }, k), h(Text, { color: 'gray' }, ` ${label}   `));
  let body;
  if (mode === 'save') {
    body = h(Text, null, h(Text, { color: 'gray' }, 'Save setup as: '), h(Text, { color: 'whiteBright' }, input), h(Text, { color: 'blueBright' }, '█'),
      h(Text, { color: 'gray' }, '   enter save · esc cancel'));
  } else if (mode === 'load' || mode === 'delete') {
    body = h(Box, { flexDirection: 'column' },
      h(Text, { color: 'gray' }, mode === 'load' ? 'Load setup (enter load · esc cancel):' : 'Delete setup (enter delete · esc cancel):'),
      ...s.names.map((n, i) => h(Text, { key: n },
        h(Text, { color: 'blueBright' }, i === listCursor ? '❯ ' : '  '),
        h(Text, { color: n === s.active ? 'blueBright' : undefined, bold: i === listCursor }, n),
        n === s.active ? h(Text, { color: 'gray' }, '  (active)') : null)));
  } else {
    body = h(Text, null, key('↑↓', 'role'), key('←→', 'model'), key('e', 'effort'), key('s', 'save'), key('l', 'load'),
      key('d', 'delete'), key('t', 'on/off'), key('q', 'quit'));
  }
  return h(Box, { flexDirection: 'column', paddingX: 1, marginTop: 1 },
    body,
    toast ? h(Text, { color: toast.error ? 'redBright' : 'greenBright' }, toast.text) : h(Text, null, ' '));
}

function App() {
  const { exit } = useApp();
  const [s, setS] = useState(snapshot);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState('main');
  const [input, setInput] = useState('');
  const [listCursor, setListCursor] = useState(0);
  const [toast, setToast] = useState(null);

  const act = (fn, ok) => {
    try {
      fn();
      setS(snapshot());
      setToast(ok ? { text: ok } : null);
    } catch (e) {
      setToast({ text: e.message, error: true });
    }
  };

  useInput((ch, key) => {
    if (mode === 'save') {
      if (key.escape) { setMode('main'); setInput(''); return; }
      if (key.return) {
        const name = input.trim();
        act(() => store.saveAs(name), `Saved as "${name}"`);
        setMode('main'); setInput('');
        return;
      }
      if (key.backspace || key.delete) { setInput(v => v.slice(0, -1)); return; }
      if (ch && !key.ctrl && !key.meta) setInput(v => (v + ch).slice(0, 40));
      return;
    }
    if (mode === 'load' || mode === 'delete') {
      if (key.escape || ch === 'q') { setMode('main'); return; }
      if (key.upArrow) setListCursor(i => Math.max(0, i - 1));
      if (key.downArrow) setListCursor(i => Math.min(s.names.length - 1, i + 1));
      if (key.return) {
        const name = s.names[listCursor];
        if (mode === 'load') act(() => store.use(name), `Loaded "${name}"`);
        else act(() => store.remove(name), `Deleted "${name}"`);
        setMode('main');
      }
      return;
    }
    const role = ROLES[cursor];
    const cur = s.setup[role];
    if (ch === 'q' || key.escape || (key.ctrl && ch === 'c')) { exit(); return; }
    if (key.upArrow || ch === 'k') setCursor(i => (i + ROLES.length - 1) % ROLES.length);
    else if (key.downArrow || ch === 'j') setCursor(i => (i + 1) % ROLES.length);
    else if (key.rightArrow) act(() => store.setRole(role, cycle(MODELS, cur.model, 1)));
    else if (key.leftArrow) act(() => store.setRole(role, cycle(MODELS, cur.model, -1)));
    else if (ch === 'e') act(() => store.setRole(role, cur.model, cycle(EFFORTS, cur.effort, 1)));
    else if (ch === 'E') act(() => store.setRole(role, cur.model, cycle(EFFORTS, cur.effort, -1)));
    else if (ch === 's') { setMode('save'); setInput(''); setToast(null); }
    else if (ch === 'l') { setMode('load'); setListCursor(Math.max(0, s.names.indexOf(s.active))); setToast(null); }
    else if (ch === 'd') { setMode('delete'); setListCursor(0); setToast(null); }
    else if (ch === 't') act(() => store.setEnabled(!s.enabled), `Routing ${s.enabled ? 'OFF' : 'ON'}`);
  });

  return h(Box, { flexDirection: 'column' },
    h(Header, { s }),
    h(RoleTable, { s, cursor }),
    h(Footer, { mode, input, s, listCursor, toast }),
    h(Text, { color: 'gray', dimColor: true }, '  Changes save instantly and apply from the next prompt in every session.'));
}

export async function runPicker() {
  const app = render(h(App));
  await app.waitUntilExit();
}
