import { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { guildState, save } from './storage.js';
const kinds = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum };
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
export function panel(title, description, color = 0x5865f2) { return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setFooter({ text: 'BuilCord' }); }
function resolveOverwrites(guild, store, rules = {}) {
  return Object.entries(rules).map(([key, rule]) => {
    const id = key === 'everyone' ? guild.id : store.roles[key];
    if (!id) throw new Error('Cargo de overwrite não encontrado: ' + key);
    const bits = arr => (arr ?? []).map(name => {
      if (!(name in PermissionFlagsBits)) throw new Error('Permissão inválida: ' + name);
      return PermissionFlagsBits[name];
    });
    return { id, allow: bits(rule.allow), deny: bits(rule.deny) };
  });
}
function getRole(guild, store, spec) {
  const saved = guild.roles.cache.get(store.roles[spec.key]);
  return saved ?? guild.roles.cache.find(x => x.name === spec.name && x.id !== guild.id);
}
function getChannel(guild, store, spec, kind) {
  const saved = guild.channels.cache.get(store.channels[spec.key]);
  return saved ?? guild.channels.cache.find(x => x.name === spec.name && x.type === kind);
}
export function preview(template) {
  const categories = template.categories ?? [];
  const channels = categories.flatMap(c => c.channels ?? []);
  return { roles: (template.roles ?? []).length, categories: categories.length, channels: channels.length, text: channels.filter(c => (c.type ?? 'text') === 'text').length, voice: channels.filter(c => c.type === 'voice').length };
}
export function validateTemplate(t) {
  if (!t || !Array.isArray(t.categories) || !Array.isArray(t.roles)) throw new Error('Template precisa de arrays roles e categories.');
  const keys = new Set();
  for (const role of t.roles) {
    if (!role.key || !role.name || keys.has('r:' + role.key)) throw new Error('Cargo inválido/duplicado.');
    keys.add('r:' + role.key);
    for (const perm of role.permissions ?? []) if (!(perm in PermissionFlagsBits)) throw new Error('Permissão inválida: ' + perm);
  }
  for (const cat of t.categories) {
    if (!cat.key || !cat.name || keys.has('c:' + cat.key)) throw new Error('Categoria duplicada/inválida.');
    keys.add('c:' + cat.key);
    for (const ch of cat.channels ?? []) {
      if (!ch.key || !ch.name || keys.has('c:' + ch.key) || !(ch.type ?? 'text' in kinds)) throw new Error('Canal inválido/duplicado: ' + ch.name);
      keys.add('c:' + ch.key);
    }
  }
}
export async function deploy(guild, template, maxPhase = 5, progress = console.log) {
  validateTemplate(template);
  const store = guildState(guild.id);
  await guild.roles.fetch(); await guild.channels.fetch();
  const full = maxPhase > 1;
  const phase = async (number, message, fn) => {
    if (maxPhase < number) return;
    progress('FASE ' + number + ': ' + message);
    await fn();
    store.phases[number] = new Date().toISOString();
    save();
  };
  await phase(1, 'estrutura seca: cargos, categorias e canais', async () => {
    for (const r of template.roles) {
      let role = getRole(guild, store, r);
      if (!role) role = await guild.roles.create({ name: r.name, permissions: [], reason: 'BuilCord fase 1' });
      store.roles[r.key] = role.id; save();
    }
    for (const cat of template.categories) {
      let parent = getChannel(guild, store, cat, ChannelType.GuildCategory);
      if (!parent) parent = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, reason: 'BuilCord fase 1' });
      store.channels[cat.key] = parent.id; save();
      for (const ch of cat.channels ?? []) {
        const kind = kinds[ch.type ?? 'text'];
        let channel = getChannel(guild, store, ch, kind);
        if (!channel) channel = await guild.channels.create({ name: ch.name, type: kind, parent: parent.id, reason: 'BuilCord fase 1' });
        store.channels[ch.key] = channel.id; save();
      }
    }
  });
  await phase(2, 'permissões e hierarquia', async () => {
    for (const r of template.roles) {
      const role = guild.roles.cache.get(store.roles[r.key]);
      if (!role) continue;
      await role.edit({ permissions: r.permissions ?? [], hoist: !!r.hoist, mentionable: false, reason: 'BuilCord fase 2' });
    }
    for (const cat of template.categories) {
      const parent = guild.channels.cache.get(store.channels[cat.key]);
      if (!parent) continue;
      if (cat.overwrites) await parent.permissionOverwrites.set(resolveOverwrites(guild, store, cat.overwrites));
      for (const ch of cat.channels ?? []) {
        const channel = guild.channels.cache.get(store.channels[ch.key]);
        if (channel && ch.overwrites) await channel.permissionOverwrites.set(resolveOverwrites(guild, store, ch.overwrites));
      }
    }
  });
  await phase(3, 'decoração e cores', async () => {
    for (const r of template.roles) {
      const role = guild.roles.cache.get(store.roles[r.key]);
      if (role) await role.edit({ name: r.name, color: r.color ?? '#99aab5', hoist: !!r.hoist });
    }
    for (const cat of template.categories) {
      const parent = guild.channels.cache.get(store.channels[cat.key]);
      if (parent) await parent.setName(cat.name);
      for (const ch of cat.channels ?? []) {
        const channel = guild.channels.cache.get(store.channels[ch.key]);
        if (!channel) continue;
        await channel.setName(ch.name);
        if (ch.topic && 'setTopic' in channel) await channel.setTopic(ch.topic.slice(0, 1024));
      }
    }
  });
  await phase(4, 'regras, embeds e painéis', async () => {
    for (const cat of template.categories) for (const ch of cat.channels ?? []) {
      if (!ch.message) continue;
      const channel = guild.channels.cache.get(store.channels[ch.key]);
      if (!channel?.isTextBased() || !('send' in channel)) continue;
      if (store.settings['message:' + ch.key]) continue;
      const m = await channel.send({ embeds: [panel(ch.message.title, ch.message.description)] });
      if (ch.pin) await m.pin().catch(() => {});
      store.settings['message:' + ch.key] = m.id; save();
    }
    await installPanels(guild);
  });
  await phase(5, 'sistemas persistentes', async () => {
    store.settings = { ...store.settings, ...(template.settings ?? {}) };
    store.settings.template = template.name || 'Personalizado';
    save();
  });
  return { guild: guild.name, phases: maxPhase, items: preview(template) };
}
export async function installPanels(guild) {
  const store = guildState(guild.id);
  for (const [mode, key, title, description, label, style] of [
    ['ticket', 'tickets', '🎫 Atendimento', 'Abra um ticket privado para conversar com a equipe.', 'Abrir ticket', ButtonStyle.Primary],
    ['verify', 'verificacao', '✅ Verificação', 'Clique para receber o cargo de membro verificado.', 'Verificar', ButtonStyle.Success]
  ]) {
    const id = store.channels[key];
    if (!id || store.settings['panel:' + mode]) continue;
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) continue;
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('builcord:' + mode).setLabel(label).setStyle(style));
    const m = await channel.send({ embeds: [panel(title, description)], components: [row] });
    await m.pin().catch(() => {});
    store.settings['panel:' + mode] = m.id; save();
  }
}
export async function logEvent(guild, title, description) {
  const store = guildState(guild.id);
  const id = store.channels.logs;
  if (!id) return;
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (channel?.isTextBased() && 'send' in channel) await channel.send({ embeds: [panel(title, description, 0xfee75c)] }).catch(() => {});
}
export async function interactions(client, i) {
  if (!i.isButton() || !i.guild || !i.customId.startsWith('builcord:')) return;
  const store = guildState(i.guild.id);
  const ephemeral = content => i.reply({ content, flags: MessageFlags.Ephemeral });
  try {
    if (i.customId === 'builcord:verify') {
      const id = store.roles.verificado ?? store.roles.membro;
      if (!id) return ephemeral('Cargo de verificação não configurado.');
      await i.guild.members.fetch(i.user.id).then(member => member.roles.add(id));
      return ephemeral('✅ Verificação concluída.');
    }
    if (i.customId === 'builcord:ticket') {
      const open = Object.entries(store.tickets).find(([, t]) => t.owner === i.user.id && t.open);
      if (open) return ephemeral('Você já tem um ticket: <#' + open[0] + '>');
      const overwrites = [
        { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
      ];
      const staff = store.roles.staff ?? store.roles.moderador ?? store.roles.admin;
      if (staff) overwrites.push({ id: staff, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      const channel = await i.guild.channels.create({ name: 'ticket-' + i.user.id, type: ChannelType.GuildText, parent: store.channels.atendimento || undefined, permissionOverwrites: overwrites, reason: 'BuilCord ticket' });
      store.tickets[channel.id] = { owner: i.user.id, open: true, createdAt: new Date().toISOString() }; save();
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('builcord:close').setLabel('Fechar ticket').setStyle(ButtonStyle.Danger));
      await channel.send({ content: '<@' + i.user.id + '>', embeds: [panel('🎫 Ticket', 'Descreva sua solicitação. A equipe responderá aqui.')], components: [row] });
      await logEvent(i.guild, '🎫 Ticket aberto', channel.toString());
      return ephemeral('Ticket criado: ' + channel.toString());
    }
    if (i.customId === 'builcord:close') {
      const ticket = store.tickets[i.channelId];
      if (!ticket?.open) return ephemeral('Este canal não é um ticket aberto.');
      if (ticket.owner !== i.user.id && !i.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return ephemeral('Sem permissão.');
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const messages = await i.channel.messages.fetch({ limit: 100 });
      const lines = [...messages.values()].reverse().map(m => '[' + m.createdAt.toISOString() + '] ' + m.author.tag + ': ' + m.content + ' ' + [...m.attachments.values()].map(a => a.url).join(' '));
      const dir = path.join(process.cwd(), 'data', 'transcripts');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, i.channelId + '.txt'), lines.join('\n'), { mode: 0o600 });
      ticket.open = false; ticket.closedAt = new Date().toISOString(); save();
      await logEvent(i.guild, '🔒 Ticket fechado', i.channel.name);
      await i.editReply('Ticket fechado. Transcrição local salva.');
      await i.channel.delete('BuilCord ticket fechado');
    }
  } catch (error) {
    console.error(error);
    if (i.replied || i.deferred) await i.followUp({ content: 'Erro: ' + error.message, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await ephemeral('Erro: ' + error.message).catch(() => {});
  }
}
