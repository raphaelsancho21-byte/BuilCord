import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import inquirer from 'inquirer';
import { guildState, save, exportPlan } from './storage.js';
import { readXenon, searchXenon, toSkeleton } from './xenon.js';
import { deploy, preview, validateTemplate, installPanels, logEvent, interactions, panel } from './engine.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const questions = items => inquirer.prompt(items);
const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'novo';

async function chooseGuild() {
  const available = [...client.guilds.cache.values()];
  if (!available.length) throw new Error('Adicione o bot a um servidor antes de executar.');
  const { id } = await questions([{ type: 'select', name: 'id', message: 'Servidor:', choices: available.map(g => ({ name: g.name + ' (' + g.id + ')', value: g.id })) }]);
  const guild = await client.guilds.fetch(id);
  await guild.members.fetchMe();
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels) || !guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles))
    throw new Error('O bot precisa de ManageChannels e ManageRoles; para tickets e mensagens configure também as permissões de envio e leitura.');
  return guild;
}
async function confirmDeploy(guild, template, phase = 5) {
  validateTemplate(template);
  console.log('\nPLANO: ' + template.name, preview(template));
  console.log('Fases 1 até ' + phase + '. Objetos existentes com o mesmo nome podem ser reutilizados.');
  const { ok } = await questions([{ type: 'confirm', name: 'ok', default: false, message: 'AUTORIZA as alterações em ' + guild.name + '?' }]);
  if (!ok) return;
  try { console.log(await deploy(guild, template, phase)); }
  catch (error) { console.error('Falha parcial:', error.message, '\nO estado foi salvo. Corrija as permissões e execute novamente.'); }
}
function listTemplates() {
  const dir = path.join(process.cwd(), 'templates');
  return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
}
function loadTemplate(name) { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'templates', name + '.json'), 'utf8')); }
async function templateFlow(guild) {
  const { name } = await questions([{ type: 'select', name: 'name', message: 'Template pronto:', choices: listTemplates() }]);
  const { phase } = await questions([{ type: 'select', name: 'phase', message: 'Até qual fase construir?', choices: [1, 2, 3, 4, 5].map(n => ({ name: 'Fase ' + n, value: n })) }]);
  await confirmDeploy(guild, loadTemplate(name), phase);
}
async function xenonFlow(guild) {
  const { topic } = await questions([{ name: 'topic', message: 'Tema (ex.: Miraculous):', validate: x => !!x?.trim() }]);
  let refs = [];
  try { refs = await searchXenon(topic); } catch (error) { console.warn('Busca automática não disponível:', error.message); }
  const { selected } = await questions([{ type: 'select', name: 'selected', message: 'Selecione uma referência pública:', choices: [...refs.map(x => ({ name: x.title + ' — ' + x.url, value: x.url })), { name: 'Informar URL do Xenon manualmente', value: 'manual' }] }]);
  let url = selected;
  if (selected === 'manual') ({ url } = await questions([{ name: 'url', message: 'URL Xenon:' }]));
  const ref = await readXenon(url);
  console.log(ref.warning);
  if (!ref.categories.length) { console.warn('A página não expôs canais utilizáveis; nenhuma alteração foi feita.'); return; }
  const skeleton = toSkeleton(ref, topic);
  const file = exportPlan({ phase: 1, theme: topic, reference: ref, template: skeleton }, slug(topic));
  console.log('Plano salvo em ' + file);
  await confirmDeploy(guild, skeleton, 1);
  console.log('A referência Xenon só é usada para a estrutura seca; fases posteriores devem ser personalizadas em JSON.');
}
async function customFlow(guild) {
  const answers = await questions([
    { name: 'theme', message: 'Nome/tema do servidor:' },
    { name: 'categories', message: 'Categorias (separadas por vírgula):', default: 'INÍCIO,COMUNIDADE,SUPORTE' },
    { name: 'channels', message: 'Canais em cada categoria (separados por vírgula):', default: 'regras,geral,avisos' },
    { name: 'roles', message: 'Cargos (separados por vírgula):', default: 'Membro,Moderador,Staff' }
  ]);
  const split = text => String(text).split(',').map(s => s.trim()).filter(Boolean);
  const categories = split(answers.categories).map((name, i) => ({ key: slug(name) + '-' + i, name, channels: split(answers.channels).map((c, j) => ({ key: slug(c) + '-' + i + '-' + j, name: c, type: 'text' })) }));
  const roles = split(answers.roles).map((name, i) => ({ key: slug(name) + '-' + i, name, permissions: [] }));
  const template = { name: answers.theme || 'Personalizado', categories, roles };
  const file = path.join(process.cwd(), 'templates', slug(answers.theme) + '.json');
  fs.writeFileSync(file, JSON.stringify(template, null, 2));
  console.log('Template editável salvo em ' + file);
  await confirmDeploy(guild, template, 1);
}
async function webhookFlow(guild) {
  await guild.channels.fetch();
  const channels = [...guild.channels.cache.values()].filter(c => c.isTextBased() && 'createWebhook' in c);
  if (!channels.length) return console.log('Nenhum canal aceita webhooks.');
  const { id, name } = await questions([
    { type: 'select', name: 'id', message: 'Canal:', choices: channels.map(c => ({ name: c.name, value: c.id })) },
    { name: 'name', message: 'Nome:', default: 'BuilCord Announcements' }
  ]);
  const { ok } = await questions([{ type: 'confirm', name: 'ok', message: 'Criar webhook neste canal?', default: false }]);
  if (!ok) return;
  const hook = await guild.channels.cache.get(id).createWebhook({ name, reason: 'BuilCord webhook autorizado' });
  console.log('URL SECRETA (copie para um cofre e NÃO publique): ' + hook.url);
}
async function backupFlow(guild) {
  await guild.roles.fetch(); await guild.channels.fetch();
  const data = { guild: guild.name, createdAt: new Date().toISOString(), state: guildState(guild.id), roles: guild.roles.cache.map(r => ({ name: r.name, id: r.id, color: r.hexColor, permissions: r.permissions.toArray() })), channels: guild.channels.cache.map(c => ({ name: c.name, id: c.id, type: c.type, parent: c.parentId, topic: c.topic })) };
  const file = exportPlan(data, 'backup-' + guild.id);
  console.log('Backup estrutural: ' + file + ' (não inclui histórico ou restauração).');
}
client.on(Events.InteractionCreate, i => interactions(client, i));
client.on(Events.GuildMemberAdd, async m => {
  const store = guildState(m.guild.id);
  const role = store.roles[store.settings.autorole];
  if (role) await m.roles.add(role).catch(() => {});
  const welcome = store.channels.boas_vindas;
  if (welcome) {
    const ch = await m.guild.channels.fetch(welcome).catch(() => null);
    if (ch?.isTextBased() && 'send' in ch) await ch.send({ embeds: [panel('👋 Boas-vindas!', 'Bem-vindo(a), ' + m.toString() + '! Leia as regras e participe da comunidade.')] }).catch(() => {});
  }
  await logEvent(m.guild, '📥 Entrada', m.user.tag);
});
client.on(Events.GuildMemberRemove, m => logEvent(m.guild, '📤 Saída', m.user.tag));
client.on(Events.MessageDelete, m => {
  if (!m.guild || m.author?.bot) return;
  return logEvent(m.guild, '🗑️ Mensagem removida', 'Canal: ' + m.channel.toString() + '\nAutor: ' + (m.author?.tag ?? 'Desconhecido') + '\n' + (m.content ?? '[indisponível]').slice(0, 800));
});
async function main() {
  if (!process.env.DISCORD_TOKEN) throw new Error('Preencha DISCORD_TOKEN no arquivo .env.');
  await client.login(process.env.DISCORD_TOKEN);
  await new Promise(resolve => client.isReady() ? resolve() : client.once(Events.ClientReady, resolve));
  console.log('BuilCord conectado: ' + client.user.tag);
  const guild = await chooseGuild();
  while (true) {
    const { action } = await questions([{ type: 'select', name: 'action', message: 'BuilCord | ' + guild.name, choices: [
      { name: 'Template completo por fases', value: 'template' },
      { name: 'Pesquisar referência Xenon (fase 1)', value: 'xenon' },
      { name: 'Criar template JSON personalizado', value: 'custom' },
      { name: 'Instalar painéis de tickets/verificação', value: 'panels' },
      { name: 'Criar webhook', value: 'webhook' },
      { name: 'Exportar backup estrutural', value: 'backup' },
      { name: 'Status', value: 'status' },
      { name: 'Sair (bot ficará offline)', value: 'exit' }
    ] }]);
    if (action === 'exit') break;
    try {
      if (action === 'template') await templateFlow(guild);
      if (action === 'xenon') await xenonFlow(guild);
      if (action === 'custom') await customFlow(guild);
      if (action === 'panels') await installPanels(guild);
      if (action === 'webhook') await webhookFlow(guild);
      if (action === 'backup') await backupFlow(guild);
      if (action === 'status') console.log(guildState(guild.id));
    } catch (error) { console.error('Erro:', error.message); }
  }
  save(); client.destroy();
}
main().catch(err => { console.error(err); process.exitCode = 1; client.destroy(); });
