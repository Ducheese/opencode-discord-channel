import * as fs from "fs"
import * as path from "path"
import * as os from "os"

export interface DiscordChannelConfig {
  botToken?: string
  ownerId?: string
  defaultChannelId?: string
  activeSessionId?: string
  activeSessionAt?: number
  activeSessionDirectory?: string
}

const CONFIG_DIR = path.join(os.homedir(), ".config", "opencode")
const CONFIG_FILE = path.join(CONFIG_DIR, "discord-channel.json")

export function getConfigPath(): string {
  return CONFIG_FILE
}

export function loadConfig(): DiscordChannelConfig {
  try {
    const content = fs.readFileSync(CONFIG_FILE, "utf-8")
    return JSON.parse(content) as DiscordChannelConfig
  } catch {
    return {}
  }
}

export function saveConfig(config: DiscordChannelConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n")
}

export function updateConfig(
  partial: Partial<DiscordChannelConfig>,
): DiscordChannelConfig {
  const existing = loadConfig()
  const merged = { ...existing, ...partial }
  saveConfig(merged)
  return merged
}

export function resolveConfig(): {
  botToken: string | undefined
  ownerId: string | undefined
  defaultChannelId: string | undefined
  activeSessionId: string | undefined
  activeSessionAt: number | undefined
  activeSessionDirectory: string | undefined
} {
  const fileConfig = loadConfig()
  return {
    botToken: process.env.DISCORD_BOT_TOKEN ?? fileConfig.botToken,
    ownerId: process.env.DISCORD_OWNER_ID ?? fileConfig.ownerId,
    defaultChannelId: fileConfig.defaultChannelId,
    activeSessionId: fileConfig.activeSessionId,
    activeSessionAt: fileConfig.activeSessionAt,
    activeSessionDirectory: fileConfig.activeSessionDirectory,
  }
}
