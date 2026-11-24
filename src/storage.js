import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const statePath = path.join(root, 'data', 'state.json');
export function loadState() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) return { guilds: {} };
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}
export const state = loadState();
export function guildState(id) {
  return state.guilds[id] ??= { roles: {}, channels: {}, tickets: {}, settings: {}, phases: {} };
}
export function save() {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = statePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, statePath);
}
export function exportPlan(plan, prefix = 'plan') {
  const dir = path.join(root, 'data', 'plans');
  fs.mkdirSync(dir, { recursive: true });
  const filename = prefix.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48) + '-' + Date.now() + '.json';
  const file = path.join(dir, filename);
  fs.writeFileSync(file, JSON.stringify(plan, null, 2), { mode: 0o600 });
  return file;
}
