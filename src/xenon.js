import * as cheerio from 'cheerio';
const ROOT = 'https://xenon.bot';
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const normal = s => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function safeTemplateUrl(input) {
  const u = new URL(input, ROOT);
  if (u.origin !== ROOT || !/^\/(?:pt\/)?templates\/[a-z0-9_-]+\/?$/i.test(u.pathname)) throw new Error('Somente URLs públicas https://xenon.bot/pt/templates/ID são aceitas.');
  return u.href;
}
async function html(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'BuilCord/0.2 public template reference', 'Accept': 'text/html' } });
    if (!response.ok) throw new Error('Falha na página Xenon: HTTP ' + response.status);
    return await response.text();
  } finally { clearTimeout(timer); }
}
export async function searchXenon(query) {
  const $ = cheerio.load(await html(ROOT + '/pt/templates'));
  const choices = new Map();
  $('a[href]').each((_, link) => {
    try {
      const url = safeTemplateUrl($(link).attr('href'));
      const title = clean($(link).text()) || url.split('/').filter(Boolean).pop();
      choices.set(url, { title, url, relevance: normal(title).includes(normal(query)) ? 1 : 0 });
    } catch {}
  });
  return [...choices.values()].sort((a, b) => b.relevance - a.relevance).slice(0, 30);
}
export async function readXenon(input) {
  const url = safeTemplateUrl(input);
  const $ = cheerio.load(await html(url));
  $('script,style,nav,footer').remove();
  const title = clean($('h1').first().text()) || 'Referência Xenon';
  const categories = [];
  const roles = [];
  let mode = '';
  let current = null;
  $('h2,h3,li').each((_, node) => {
    const tag = node.tagName?.toLowerCase();
    const value = clean($(node).text());
    if (!value) return;
    if (tag === 'h2' || tag === 'h3') {
      if (/canais|channels/i.test(value)) mode = 'channels';
      else if (/cargos|roles/i.test(value)) mode = 'roles';
      else mode = '';
      return;
    }
    if (mode === 'roles' && value.length < 90) roles.push(value.replace(/shown separately/gi, '').trim());
    if (mode !== 'channels') return;
    if (/^[#♪🔊]/u.test(value)) {
      current ??= { name: 'GERAL', channels: [] };
      if (!categories.includes(current)) categories.push(current);
      current.channels.push({ name: value.replace(/^#/, ''), type: /^[♪🔊]/u.test(value) ? 'voice' : 'text' });
    } else if (value.length < 80) {
      current = { name: value, channels: [] };
      categories.push(current);
    }
  });
  return { url, title, roles: [...new Set(roles)].filter(Boolean), categories: categories.filter(x => x.channels.length), warning: 'O HTML público não garante permissão, cor ou categoria completas. Conferir antes da implantação.' };
}
const slug = str => normal(str).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'item';
export function toSkeleton(ref, theme) {
  const used = new Set();
  function unique(name) { const key = slug(name); let k = key, n = 2; while (used.has(k)) k = key + '-' + n++; used.add(k); return k; }
  return {
    name: theme + ' — referência ' + ref.title, source: ref.url,
    roles: ref.roles.slice(0, 60).map(name => ({ key: unique(name), name, color: '#99aab5', permissions: [] })),
    categories: ref.categories.slice(0, 40).map(cat => ({ key: unique(cat.name), name: cat.name, channels: cat.channels.slice(0, 40).map(ch => ({ key: unique(ch.name), name: ch.name, type: ch.type })) }))
  };
}
