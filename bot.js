const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType, PermissionFlagsBits } = require("discord.js");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("DISCORD_TOKEN is not set!");
  process.exit(1);
}

const SUGGESTIONS_CHANNEL = "【💡】suggestions";
const X_THRESHOLD = 3;

// Role IDs
const TOURNAMENT_MASTER_ROLE_ID     = "1479411898830028982";
const OLD_TOURNAMENT_MASTER_ROLE_ID = "1479575611142836316";
const UNVERIFIED_ROLE_ID            = "1485598729372176394";
const JAD_PLAYS_FAN_ROLE_ID         = "1451570312180269149";

let hofMessageId = null;
let hofChannelId = null;

// Track current tournament role holders so we can detect removals
// (oldMember is often partial/empty, so we can't rely on it)
const trackedTMs  = new Set();
const trackedOTMs = new Set();

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is online")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion to the suggestions channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Sends The Hall Of Fame Winners Message")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .toJSON(),
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember],
});

// ─── Hall of Fame ─────────────────────────────────────────────────────────────

async function buildHofContent(guild) {
  const members = await guild.members.fetch();

  // Both filters are independent — someone with BOTH roles appears on BOTH lists
  const currentMasters = members.filter((m) => m.roles.cache.has(TOURNAMENT_MASTER_ROLE_ID));
  const oldMasters     = members.filter((m) => m.roles.cache.has(OLD_TOURNAMENT_MASTER_ROLE_ID));

  // Keep tracked sets in sync so guildMemberUpdate can detect removals
  trackedTMs.clear();
  currentMasters.forEach((m) => trackedTMs.add(m.id));
  trackedOTMs.clear();
  oldMasters.forEach((m) => trackedOTMs.add(m.id));

  const currentList = currentMasters.size > 0
    ? currentMasters.map((m) => `<@${m.id}>`).join("\n")
    : "(No one so far.)";

  const oldList = oldMasters.size > 0
    ? oldMasters.map((m) => `<@${m.id}>`).join("\n")
    : "(No one so far.)";

  return [
    `@everyone`,
    ``,
    `:crown: CURRENT <@&${TOURNAMENT_MASTER_ROLE_ID}>`,
    currentList,
    ``,
    `:medal: HALL OF FAME - <@&${OLD_TOURNAMENT_MASTER_ROLE_ID}>`,
    `These Warriors Have Claimed Victory In The Past And Earned **Eternal** Recognition`,
    oldList,
  ].join("\n");
}

async function getHofChannel(guild) {
  if (hofChannelId) {
    const ch = guild.channels.cache.get(hofChannelId);
    if (ch) return ch;
  }
  await guild.channels.fetch();
  const ch = guild.channels.cache.find((c) => c.name.toLowerCase().includes("hall-of-fame"));
  if (ch) hofChannelId = ch.id;
  return ch || null;
}

async function updateHofMessage(guild) {
  try {
    const hofChannel = await getHofChannel(guild);
    if (!hofChannel) {
      console.warn("Could not find hall-of-fame channel");
      return;
    }

    const content = await buildHofContent(guild);

    if (hofMessageId) {
      try {
        const msg = await hofChannel.messages.fetch(hofMessageId);
        await msg.edit({ content, allowedMentions: { parse: ["everyone", "roles"] } });
        console.log("Hall of Fame message updated");
        return;
      } catch {
        hofMessageId = null;
      }
    }

    const sent = await hofChannel.send({ content, allowedMentions: { parse: ["everyone", "roles"] } });
    hofMessageId = sent.id;
    console.log(`Hall of Fame message sent (id: ${sent.id})`);
  } catch (err) {
    console.error("Failed to update Hall of Fame:", err);
  }
}

// resendHofMessage now returns true/false so the /send command can report real status
async function resendHofMessage(guild) {
  try {
    const hofChannel = await getHofChannel(guild);
    if (!hofChannel) {
      console.warn("resendHofMessage: hall-of-fame channel not found");
      return false;
    }

    if (hofMessageId) {
      try {
        const old = await hofChannel.messages.fetch(hofMessageId);
        await old.delete();
      } catch {}
      hofMessageId = null;
    }

    const content = await buildHofContent(guild);
    const sent = await hofChannel.send({ content, allowedMentions: { parse: ["everyone", "roles"] } });
    hofMessageId = sent.id;
    console.log(`Hall of Fame message resent (id: ${sent.id})`);
    return true;
  } catch (err) {
    console.error("Failed to resend Hall of Fame:", err);
    return false;
  }
}

// ─── Ready ────────────────────────────────────────────────────────────────────

client.on("clientReady", async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands });
    console.log("Slash commands registered");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }

  for (const guild of readyClient.guilds.cache.values()) {
    try {
      const hofChannel = await getHofChannel(guild);
      if (!hofChannel) {
        console.warn(`No hall-of-fame channel found in "${guild.name}"`);
        continue;
      }

      const messages = await hofChannel.messages.fetch({ limit: 50 });
      const existing = messages.find((m) => m.author.id === readyClient.user.id);
      if (existing) {
        hofMessageId = existing.id;
        console.log(`Re-using existing HOF message (id: ${existing.id})`);
      }

      await updateHofMessage(guild);
    } catch (err) {
      console.error("Failed to init Hall of Fame:", err);
    }
  }
});

// ─── Slash commands & modals ──────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ping") {
      await interaction.reply("🟢 I'm online and running!");
    }

    if (interaction.commandName === "send") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({ content: "❌ You need Administrator permission to use this.", ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const ok = await resendHofMessage(interaction.guild);
      if (ok) {
        await interaction.editReply({ content: "✅ Hall of Fame message sent!", ephemeral: true });
      } else {
        await interaction.editReply({ content: "❌ Failed to send Hall of Fame message. Check the bot logs for details.", ephemeral: true });
      }
    }

    if (interaction.commandName === "suggest") {
      const modal = new ModalBuilder()
        .setCustomId("suggest_modal")
        .setTitle("Submit a Suggestion");

      const titleInput = new TextInputBuilder()
        .setCustomId("suggest_title")
        .setLabel("Title")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Short title for your suggestion")
        .setRequired(true)
        .setMaxLength(100);

      const bodyInput = new TextInputBuilder()
        .setCustomId("suggest_body")
        .setLabel("Description")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Describe your suggestion in detail...")
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(bodyInput),
      );

      await interaction.showModal(modal);
    }
  }

  if (interaction.isModalSubmit() && interaction.customId === "suggest_modal") {
    const title = interaction.fields.getTextInputValue("suggest_title");
    const body  = interaction.fields.getTextInputValue("suggest_body");

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "This command only works in a server!", ephemeral: true });
      return;
    }

    const forumChannel = guild.channels.cache.find(
      (ch) => ch.name === SUGGESTIONS_CHANNEL && ch.type === ChannelType.GuildForum
    );

    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
      await interaction.reply({ content: `Couldn't find the suggestions channel!`, ephemeral: true });
      return;
    }

    try {
      const existing = forumChannel.threads.cache.find((t) => t.name === title);
      if (existing) {
        await interaction.reply({ content: "That suggestion was already posted!", ephemeral: true });
        return;
      }

      const thread = await forumChannel.threads.create({
        name: title,
        message: { content: `**${body}**` },
      });

      const startMessage = await thread.fetchStarterMessage();
      if (startMessage) {
        await startMessage.react("⭐");
        await startMessage.react("❌");
      }

      await interaction.reply({ content: `✅ Your suggestion **"${title}"** has been posted!`, ephemeral: true });
    } catch (err) {
      console.error("Failed to create suggestion thread:", err);
      await interaction.reply({ content: "Something went wrong posting your suggestion!", ephemeral: true });
    }
  }
});

// ─── Auto-react on new forum posts ───────────────────────────────────────────

client.on("threadCreate", async (thread) => {
  if (thread.parent?.name !== SUGGESTIONS_CHANNEL) return;
  try {
    const startMessage = await thread.fetchStarterMessage();
    if (!startMessage) return;
    await startMessage.react("⭐");
    await startMessage.react("❌");
  } catch (err) {
    console.error("Failed to react to forum post:", err);
  }
});

// ─── Auto-delete on ❌ threshold ──────────────────────────────────────────────

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) return;
    if (reaction.emoji.name !== "❌") return;
    if (reaction.partial) await reaction.fetch();
    const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    const thread = message.channel;
    if (!thread.isThread()) return;
    if (thread.parent?.name !== SUGGESTIONS_CHANNEL) return;
    const xReaction = message.reactions.cache.get("❌");
    const count = xReaction?.count ?? 0;
    if (count >= X_THRESHOLD) {
      await thread.delete(`Reached ${X_THRESHOLD} ❌ reactions`);
      console.log(`Deleted suggestion thread ${thread.id}`);
    }
  } catch (err) {
    console.error("Failed to handle reaction:", err);
  }
});

// ─── Role updates ─────────────────────────────────────────────────────────────

client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const roles = newMember.roles.cache;

    // Remove Unverified if member also has Jad Plays Fan
    if (roles.has(UNVERIFIED_ROLE_ID) && roles.has(JAD_PLAYS_FAN_ROLE_ID)) {
      await newMember.roles.remove(UNVERIFIED_ROLE_ID, "Has Jad Plays Fan — removing Unverified");
      console.log(`Removed Unverified from ${newMember.user.tag}`);
    }

    // Use tracked sets instead of oldMember (which is often partial/empty)
    // so we correctly detect both role additions AND removals
    const hasTM  = roles.has(TOURNAMENT_MASTER_ROLE_ID);
    const hasOTM = roles.has(OLD_TOURNAMENT_MASTER_ROLE_ID);
    const hadTM  = trackedTMs.has(newMember.id);
    const hadOTM = trackedOTMs.has(newMember.id);

    if (hadTM !== hasTM || hadOTM !== hasOTM) {
      console.log(`Tournament role changed for ${newMember.user.tag} — refreshing Hall of Fame`);
      await updateHofMessage(newMember.guild);
    }
  } catch (err) {
    console.error("Failed to handle guildMemberUpdate:", err);
  }
});

client.on("error", console.error);
client.login(token);

// ─── HTTP keepalive for UptimeRobot ──────────────────────────────────────────

const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("I'm alive");
}).listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));
