const { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType } = require("discord.js");

const token = process.env.DISCORD_TOKEN;

if (!token) {
  console.error("DISCORD_TOKEN is not set!");
  process.exit(1);
}

const SUGGESTIONS_CHANNEL = "【💡】suggestions";
const X_THRESHOLD = 4;

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check if the bot is online")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion to the suggestions channel")
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

client.on("clientReady", async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationCommands(readyClient.user.id), { body: commands });
    console.log("Slash commands registered");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "ping") {
      await interaction.reply("🟢 I'm online and running!");
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
    const body = interaction.fields.getTextInputValue("suggest_body");

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "This command only works in a server!", ephemeral: true });
      return;
    }

    const forumChannel = guild.channels.cache.find(
      (ch) => ch.name === SUGGESTIONS_CHANNEL && ch.type === ChannelType.GuildForum
    );

    if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
      await interaction.reply({ content: `Couldn't find the ${SUGGESTIONS_CHANNEL} channel!`, ephemeral: true });
      return;
    }

    try {
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
      await thread.delete("Reached 4 ❌ reactions");
      console.log(`Deleted forum post ${thread.id} — 4 ❌ reached`);
    }
  } catch (err) {
    console.error("Failed to handle reaction:", err);
  }
});

client.on("guildMemberUpdate", async (_oldMember, newMember) => {
  try {
    const roles = newMember.roles.cache;
    const hasUnverified = roles.some((r) => r.name === "Unverified");
    const hasJadPlays = roles.some((r) => r.name === "Jad Plays Role");

    if (hasUnverified && hasJadPlays) {
      const unverifiedRole = roles.find((r) => r.name === "Unverified");
      if (unverifiedRole) {
        await newMember.roles.remove(unverifiedRole, "Has Jad Plays Role — removing Unverified");
        console.log(`Removed Unverified from ${newMember.user.tag} — has Jad Plays Role`);
      }
    }
  } catch (err) {
    console.error("Failed to handle guildMemberUpdate:", err);
  }
});

client.on("error", console.error);
client.login(token);

const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("I'm alive");
}).listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`));
