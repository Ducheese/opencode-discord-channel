import { proxyUrl, setupProxy } from "./proxy"
import type {
  Client,
  TextChannel,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  MessageActionRowComponentBuilder,
} from "discord.js"
import { splitMessage } from "./message-splitter"
import type { DiscordMessage } from "./types"
import { ProxyAgent as UndiciProxyAgent } from "undici"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const logFile = path.join(os.tmpdir(), "opencode-discord-channel.log")
function log(msg: string) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

export type DiscordClientWrapper = ReturnType<typeof createDiscordClient>

export function createDiscordClient() {
  let discordClient: Client | null = null
  let botUserId: string | null = null
  let messageHandler: ((msg: DiscordMessage) => void) | null = null
  let buttonHandler:
    | ((customId: string, userId: string, username: string) => void)
    | null = null
  let selectMenuHandler:
    | ((customId: string, values: string[], userId: string) => void)
    | null = null
  let rawButtonHandler:
    | ((interaction: any) => Promise<boolean>)
    | null = null
  let modalSubmitHandler:
    | ((customId: string, fields: Map<string, string>, userId: string) => void)
    | null = null
  let slashCommandHandler:
    | ((command: string, interaction: any) => Promise<void>)
    | null = null

  async function getChannel(channelId: string): Promise<TextChannel> {
    if (!discordClient) throw new Error("Discord client not connected")
    let channel = discordClient.channels.cache.get(channelId)
    if (!channel) {
      channel = (await discordClient.channels.fetch(channelId)) ?? undefined
    }
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${channelId} not found or not text-based`)
    }
    return channel as TextChannel
  }

  return {
    async connect(token: string): Promise<void> {
      if (discordClient) {
        await discordClient.destroy().catch(() => {})
        discordClient = null
        botUserId = null
      }

      // Ensure proxy is configured BEFORE discord.js is imported
      setupProxy()
      const { Client: DiscordClient, GatewayIntentBits } = await import("discord.js")

      discordClient = new DiscordClient({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
        ],
        rest: {
          agent: proxyUrl ? new UndiciProxyAgent(proxyUrl) : undefined,
        },
      })

      discordClient.on("messageCreate", (msg: any) => {
        log(`[dc] raw messageCreate from=${msg.author?.id} channel=${msg.channelId} content="${msg.content?.slice(0, 30)}"`)
        if (!messageHandler) return
        if (msg.author?.bot) return
        // 仅当 @Bot 时才转发，避免另一机器人或普通聊天被误投喂
        if (!botUserId || !msg.mentions?.has?.(botUserId)) {
          log(`[dc] ignored non-mention from=${msg.author?.id}`)
          return
        }
        // 去掉开头的 @提及，保持内容干净
        let content = msg.content ?? ""
        if (botUserId) {
          // discord.js 会把 <@botId> / <@!botId> 两种形式都放进 mentions
          content = content.replace(new RegExp(`<@!?${botUserId}>`, "g"), "").trim()
        }
        messageHandler({
          content,
          authorId: msg.author.id,
          username: msg.author.username,
          channelId: msg.channelId,
          messageId: msg.id,
        })
      })

      discordClient.on("interactionCreate", async (interaction: any) => {
        try {
          const onModal = modalSubmitHandler
          const onRawButton = rawButtonHandler
          const onButton = buttonHandler
          const onSelect = selectMenuHandler
          const onSlash = slashCommandHandler

          if (interaction.isChatInputCommand?.()) {
            if (onSlash) {
              try {
                await onSlash(interaction.commandName, interaction)
              } catch (err) {
                try {
                  const msg = err instanceof Error ? err.message : "Unknown error"
                  if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: `Error: ${msg}` })
                  } else {
                    await interaction.reply({ content: `Error: ${msg}`, ephemeral: true })
                  }
                } catch {}
              }
            }
            return
          }

          if (interaction.isModalSubmit?.()) {
            try {
              await interaction.deferUpdate()
            } catch {}
            if (onModal) {
              const fields = new Map<string, string>()
              for (const [key, comp] of interaction.fields.fields) {
                fields.set(comp.customId ?? key, comp.value)
              }
              onModal(interaction.customId, fields, interaction.user.id)
            }
            return
          }

          if (interaction.isButton?.()) {
            if (onRawButton) {
              const handled = await onRawButton(interaction)
              if (handled) return
            }
            try {
              await interaction.deferUpdate()
            } catch {}
            if (onButton) {
              onButton(
                interaction.customId,
                interaction.user.id,
                interaction.user.username,
              )
            }
            return
          }

          if (interaction.isStringSelectMenu?.()) {
            try {
              await interaction.deferUpdate()
            } catch {}
            if (onSelect) {
              onSelect(
                interaction.customId,
                interaction.values,
                interaction.user.id,
              )
            }
            return
          }
        } catch {}
      })

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Discord connection timeout (30s)")),
          30_000,
        )

        discordClient!.once("clientReady", () => {
          clearTimeout(timeout)
          botUserId = discordClient!.user?.id ?? null
          resolve()
        })

        discordClient!.login(token).catch((err: Error) => {
          clearTimeout(timeout)
          reject(
            new Error(
              `Discord login failed: ${err.message.replace(/[A-Za-z0-9_-]{20,}/g, "[REDACTED]")}`,
            ),
          )
        })
      })
    },

    async disconnect(): Promise<void> {
      await discordClient?.destroy().catch(() => {})
      discordClient = null
      botUserId = null
    },

    async sendMessage(channelId: string, content: string): Promise<void> {
      const channel = await getChannel(channelId)
      const chunks = splitMessage(content)
      if (chunks.length === 0) return
      for (const chunk of chunks) {
        await channel.send(chunk)
      }
    },

    async sendEmbed(channelId: string, embed: EmbedBuilder): Promise<void> {
      const channel = await getChannel(channelId)
      await channel.send({ embeds: [embed] })
    },

    async sendButtons(
      channelId: string,
      embed: EmbedBuilder,
      rows: ActionRowBuilder<ButtonBuilder>[],
    ): Promise<void> {
      const channel = await getChannel(channelId)
      await channel.send({ embeds: [embed], components: rows })
    },

    async sendSelectMenu(
      channelId: string,
      embed: EmbedBuilder,
      rows: ActionRowBuilder<StringSelectMenuBuilder>[],
    ): Promise<string> {
      const channel = await getChannel(channelId)
      const msg = await channel.send({ embeds: [embed], components: rows })
      return msg.id
    },

    async startTyping(channelId: string): Promise<void> {
      const channel = await getChannel(channelId)
      await channel.sendTyping()
    },

    async validateChannel(channelId: string): Promise<boolean> {
      try {
        await getChannel(channelId)
        return true
      } catch {
        return false
      }
    },

    onMessage(handler: (msg: DiscordMessage) => void): void {
      messageHandler = handler
    },

    onButtonInteraction(
      handler: (customId: string, userId: string, username: string) => void,
    ): void {
      buttonHandler = handler
    },

    onSelectMenuInteraction(
      handler: (customId: string, values: string[], userId: string) => void,
    ): void {
      selectMenuHandler = handler
    },

    onRawButtonInteraction(
      handler: (interaction: any) => Promise<boolean>,
    ): void {
      rawButtonHandler = handler
    },

    onModalSubmit(
      handler: (
        customId: string,
        fields: Map<string, string>,
        userId: string,
      ) => void,
    ): void {
      modalSubmitHandler = handler
    },

    async sendQuestion(
      channelId: string,
      embeds: EmbedBuilder[],
      rows: ActionRowBuilder<MessageActionRowComponentBuilder>[],
    ): Promise<string> {
      const channel = await getChannel(channelId)
      const msg = await channel.send({ embeds, components: rows })
      return msg.id
    },

    async deleteMessage(channelId: string, messageId: string): Promise<void> {
      const channel = await getChannel(channelId)
      const msg = await channel.messages.fetch(messageId)
      await msg.delete()
    },

    onSlashCommand(
      handler: (command: string, interaction: any) => Promise<void>,
    ): void {
      slashCommandHandler = handler
    },

    async registerSlashCommands(token: string, channelId: string): Promise<void> {
      const { SlashCommandBuilder, REST, Routes } = await import("discord.js")
      const commands = [
        new SlashCommandBuilder()
          .setName("agents")
          .setDescription("Show agent selector"),
        new SlashCommandBuilder()
          .setName("status")
          .setDescription("Show OpenCode bridge status"),
      ].map((c) => c.toJSON())

      const rest = new REST({
        version: "10",
        agent: proxyUrl ? new UndiciProxyAgent(proxyUrl) : undefined,
      }).setToken(token)
      const appId = discordClient?.user?.id
      if (!appId) return

      await rest.put(Routes.applicationCommands(appId), { body: [] }).catch(() => {})

      const channel = await getChannel(channelId)
      const guildId = channel.guildId
      if (guildId) {
        await rest.put(Routes.applicationGuildCommands(appId, guildId), {
          body: commands,
        })
      } else {
        await rest.put(Routes.applicationCommands(appId), {
          body: commands,
        })
      }
    },

    getBotUserId(): string | null {
      return botUserId
    },
  }
}
