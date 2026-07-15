const { EmbedBuilder } = require('discord.js');
const vip = require('../config/vipServers');
const fb = require('../utils/firebase');
const PS_PATTERN = /\bprivate[\s-]?server\b/i;

function matchesPrivateServer(content) {
  return PS_PATTERN.test(content);
}

async function vipEmbed() {
  const servers = await fb.getPrivateServers();
  const lines = servers.length
    ? servers.map((s) => `**${(s.tag || 'Unknown').split('#')[0]}s** — \`${s.link}\``).join('\n')
    : '_No codes have been set yet._';
  return new EmbedBuilder().setColor(vip.color || 0x9b59b6).setTitle('🔒 Private Server Codes').setDescription(lines);
}

const PS_COOLDOWN_MS = 5 * 60 * 1000;     
let lastPsSentAt = 0;                      

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    if (message.author.bot || !message.guild) return;

    const channelIds = (process.env.CHATTING || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!channelIds.includes(message.channel.id)) return;

    const content = message.content;

    if (matchesPrivateServer(content)) {
      const now = Date.now();
      if (now - lastPsSentAt < PS_COOLDOWN_MS) return;
      lastPsSentAt = now;
      try {
        const embed = await vipEmbed();
        await message.reply({ embeds: [embed] });
        console.log(`[PS] Sent server codes (triggered by ${message.author.tag})`);
      } catch (err) {
        console.error('[messageCreate] PS reply failed:', err);
      }
      return;
    }


  },

  matchesPrivateServer,
};
