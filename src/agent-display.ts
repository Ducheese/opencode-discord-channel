import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "@discordjs/builders"
import type { AgentInfo } from "./types"

const SELECT_MENU_ID = "agent_select"
const MAX_OPTIONS = 25
const HIDDEN_AGENTS = new Set(["compaction", "title", "summary"])

function hexToDecimal(hex: string): number {
  return parseInt(hex.replace("#", ""), 16)
}

export function buildAgentEmbed(
  agentName: string,
  color?: string,
  status?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(agentName)

  if (color) {
    embed.setColor(hexToDecimal(color))
  }

  if (status) {
    embed.setDescription(status)
  }

  return embed
}

export function buildAgentSelectMenu(
  agents: AgentInfo[],
  currentAgent: string,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const primaryAgents = agents.filter(
    (a) => a.mode !== "subagent" && !HIDDEN_AGENTS.has(a.name.toLowerCase()),
  )
  if (primaryAgents.length === 0) return []

  const capped = primaryAgents.slice(0, MAX_OPTIONS)

  const options = capped.map((agent) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(agent.name)
      .setValue(agent.name)
      .setDefault(agent.name === currentAgent)

    if (agent.description) {
      option.setDescription(agent.description.slice(0, 100))
    }

    return option
  })

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_MENU_ID)
    .setPlaceholder("Switch agent...")
    .addOptions(options)

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
  ]
}

export function parseSelectInteraction(
  customId: string,
  values: string[],
): string | null {
  if (customId !== SELECT_MENU_ID) return null
  return values[0] ?? null
}
