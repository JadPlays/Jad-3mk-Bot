const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require("discord.js");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("DISCORD_TOKEN is not set!");
  process.exit(1);
}

const SUGGESTIONS_CHANNEL = "【💡】suggestions";
const BAN_CHANNEL_ID = "1540360109149130943";
const X_THRESHOLD = 3;

// Role IDs
const UNVERIFIED_ROLE_ID = "1485598729372176394";
const JAD_PLAYS_FAN_ROLE_ID = "1451570312180269149";

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is online")
    .toJSON(),

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion to the suggestions channel")
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
  partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.GuildMember,
  ],
});

// ─── Bot ready ────────────────────────────────────────────────────────────────

client.on("clientReady", async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const rest = new REST().setToken(token);

  try {
    await rest.put(
      Routes.applicationCommands(readyClient.user.id),
      { body: commands },
    );

    console.log("Slash commands registered");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
});

// ─── Slash commands and suggestion modal ──────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ping") {
      await interaction.reply("🟢 I'm online and running!");
    }

    if (interaction.commandName === "suggest") {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: "You Do Not Have Access To This Command!",
          ephemeral: true,
        });
        return;
      }

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

  if (
    interaction.isModalSubmit() &&
    interaction.customId === "suggest_modal"
  ) {
    const title = interaction.fields.getTextInputValue("suggest_title");
    const body = interaction.fields.getTextInputValue("suggest_body");

    const guild = interaction.guild;

    if (!guild) {
      await interaction.reply({
        content: "This command only works in a server!",
        ephemeral: true,
      });
      return;
    }

    const forumChannel = guild.channels.cache.find(
      (channel) =>
        channel.name === SUGGESTIONS_CHANNEL &&
        channel.type === ChannelType.GuildForum,
    );

    if (!forumChannel) {
      await interaction.reply({
        content: "Couldn't find the suggestions channel!",
        ephemeral: true,
      });
      return;
    }

    try {
      const existing = forumChannel.threads.cache.find(
        (thread) => thread.name === title,
      );

      if (existing) {
        await interaction.reply({
          content: "That suggestion was already posted!",
          ephemeral: true,
        });
        return;
      }

      const thread = await forumChannel.threads.create({
        name: title,
        message: {
          content: `**${body}**`,
        },
      });

      const startMessage = await thread.fetchStarterMessage();

      if (startMessage) {
        await startMessage.react("⭐");
        await startMessage.react("❌");
      }

      await interaction.reply({
        content: `✅ Your suggestion **"${title}"** has been posted!`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("Failed to create suggestion thread:", err);

      await interaction.reply({
        content: "Something went wrong posting your suggestion!",
        ephemeral: true,
      });
    }
  }
});

// ─── Automatically react to new suggestion posts ─────────────────────────────

client.on("threadCreate", async (thread) => {
  if (thread.parent?.name !== SUGGESTIONS_CHANNEL) {
    return;
  }

  try {
    const startMessage = await thread.fetchStarterMessage();

    if (!startMessage) {
      return;
    }

    await startMessage.react("⭐");
    await startMessage.react("❌");
  } catch (err) {
    console.error("Failed to react to forum post:", err);
  }
});

// ─── Delete suggestions after the ❌ threshold ────────────────────────────────

client.on("messageReactionAdd", async (reaction, user) => {
  try {
    if (user.bot) {
      return;
    }

    if (reaction.emoji.name !== "❌") {
      return;
    }

    if (reaction.partial) {
      await reaction.fetch();
    }

    const message = reaction.message.partial
      ? await reaction.message.fetch()
      : reaction.message;

    const thread = message.channel;

    if (!thread.isThread()) {
      return;
    }

    if (thread.parent?.name !== SUGGESTIONS_CHANNEL) {
      return;
    }

    const xReaction = message.reactions.cache.get("❌");
    const count = xReaction?.count ?? 0;

    if (count >= X_THRESHOLD) {
      await thread.delete(`Reached ${X_THRESHOLD} ❌ reactions`);

      console.log(
        `Deleted suggestion thread ${thread.id} — ${X_THRESHOLD} ❌ reached`,
      );
    }
  } catch (err) {
    console.error("Failed to handle reaction:", err);
  }
});

// ─── Ban anyone who posts in the protected raid-detection channel ─────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot) {
    return;
  }

  if (message.channel.id !== BAN_CHANNEL_ID) {
    return;
  }

  const banMessage =
    "You have been **PERMANENTLY** banned because we think you are either a hacked account/is using a raid bot/is a raid bot.\n\n" +
    "If you would like to appeal, You can appeal here: https://dyno.gg/form/a93bf17c";

  try {
    await message.author.send(banMessage);
    console.log(`Sent ban message to ${message.author.tag}`);
  } catch (err) {
    console.error(
      `Could not DM ${message.author.tag} before banning:`,
      err,
    );
  }

  try {
    await message.guild.members.ban(message.author.id, {
      reason: "Posted in the protected raid-detection channel",
    });

    console.log(
      `Banned ${message.author.tag} for posting in protected channel`,
    );
  } catch (err) {
    console.error(`Failed to ban ${message.author.tag}:`, err);
  }
});

// ─── Remove Unverified when member gets Jad Plays Fan ─────────────────────────

client.on("guildMemberUpdate", async (_oldMember, newMember) => {
  try {
    const roles = newMember.roles.cache;

    const hasUnverified = roles.has(UNVERIFIED_ROLE_ID);
    const hasJadPlaysFan = roles.has(JAD_PLAYS_FAN_ROLE_ID);

    if (hasUnverified && hasJadPlaysFan) {
      await newMember.roles.remove(
        UNVERIFIED_ROLE_ID,
        "Has Jad Plays Fan — removing Unverified",
      );

      console.log(`Removed Unverified from ${newMember.user.tag}`);
    }
  } catch (err) {
    console.error("Failed to handle guildMemberUpdate:", err);
  }
});

client.on("error", console.error);

client.login(token);

// ─── HTTP keepalive for Render/UptimeRobot ───────────────────────────────────

const http = require("http");
const PORT = process.env.PORT || 3000;

http
  .createServer((_req, res) => {
    res.writeHead(200);
    res.end("I'm alive");
  })
  .listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
  });
