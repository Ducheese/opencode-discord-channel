import { buildAgentSelectMenu, buildAgentEmbed } from "./agent-display"
import {
  buildQuestionEmbed,
  buildQuestionComponents,
} from "./question-display"
import { parseContentWithTables } from "./table-parser"
import type { DiscordClientWrapper } from "./discord-client"
import type { ConnectionStateManager } from "./state"
import type { AgentInfo, QuestionRequest } from "./types"

type AgentDisplayFunctions = {
  buildAgentEmbed: typeof buildAgentEmbed
  buildAgentSelectMenu: typeof buildAgentSelectMenu
}

type OutboundBridgeDeps = {
  discordClient: Pick<
    DiscordClientWrapper,
    "sendMessage" | "sendEmbed" | "startTyping" | "sendSelectMenu" | "sendQuestion" | "deleteMessage"
  >
  state: Pick<
    ConnectionStateManager,
    | "isConnected"
    | "getSessionId"
    | "getChannelId"
    | "getCurrentAgent"
    | "addPendingQuestion"
    | "addQuestionMessageId"
    | "getAgentMenuMessageId"
    | "clearAgentMenuMessageId"
  >
  agentDisplay?: AgentDisplayFunctions
  fetchAgents: () => Promise<AgentInfo[]>
}

type OpenCodeEvent =
  | {
      type: "message.part.updated"
      properties?: {
        part?: {
          id?: string
          sessionID?: string
          messageID?: string
          type?: string
          text?: string
        }
      }
    }
  | {
      type: "session.idle"
      properties?: { sessionID?: string }
    }
  | {
      type: "session.status"
      properties?: { sessionID?: string; status?: { type?: string } }
    }
  | {
      type: "question.asked"
      properties?: QuestionRequest
    }

export function createOutboundBridge(deps: OutboundBridgeDeps): {
  handleEvent: (event: OpenCodeEvent) => Promise<void>
  trackInjectedText: (text: string) => void
  markDiscordTurn: (sessionID: string) => void
} {
  const { discordClient, state, fetchAgents } = deps
  const display = deps.agentDisplay ?? {
    buildAgentEmbed,
    buildAgentSelectMenu,
  }
  const textBuffer = new Map<string, string>()
  const injectedTexts = new Set<string>()
  const pendingUserTexts = new Set<string>()
  const discordTurnSessions = new Set<string>()
  let cachedAgents: AgentInfo[] | null = null
  let cachedAt = 0
  const CACHE_TTL = 30_000

  async function getCachedAgents(): Promise<AgentInfo[]> {
    const now = Date.now()
    if (cachedAgents && now - cachedAt < CACHE_TTL) return cachedAgents
    cachedAgents = await fetchAgents()
    cachedAt = now
    return cachedAgents
  }

  function trackInjectedText(text: string) {
    injectedTexts.add(text)
    pendingUserTexts.add(text)
  }

  function markDiscordTurn(sessionID: string) {
    discordTurnSessions.add(sessionID)
  }

  async function handleEvent(event: OpenCodeEvent): Promise<void> {
    if (!state.isConnected()) return

    const connectedSessionId = state.getSessionId()
    if (!connectedSessionId) return

    if (event.type === "message.part.updated") {
      const part = event.properties?.part
      if (!part) return
      if (part.sessionID !== connectedSessionId) return
      if (part.type !== "text") return
      if (part.text) {
        const trimmed = part.text.trim()
        for (const t of injectedTexts) {
          if (trimmed === t.trim()) return
        }
        for (const t of pendingUserTexts) {
          if (trimmed === t.trim()) return
        }
      }
      const partKey = part.id ?? part.messageID
      if (!partKey || typeof part.text !== "string") return

      textBuffer.set(partKey, part.text)
      return
    }

    const sessionID = event.properties?.sessionID
    if (sessionID !== connectedSessionId) return

    if (event.type === "session.idle") {
      const channelId = state.getChannelId()
      if (!channelId) return

      // Only mirror to Discord if this turn was initiated from Discord
      if (!discordTurnSessions.has(connectedSessionId)) {
        textBuffer.clear()
        pendingUserTexts.clear()
        injectedTexts.clear()
        return
      }
      discordTurnSessions.delete(connectedSessionId)

      // Strip user's prompt if it leaked into buffer
      if (textBuffer.size > 0 && pendingUserTexts.size > 0) {
        const firstKey = textBuffer.keys().next().value as string | undefined
        const firstText = firstKey ? textBuffer.get(firstKey) : undefined
        if (firstText) {
          const ft = firstText.trim()
          for (const t of pendingUserTexts) {
            if (ft === t.trim() || ft.startsWith(t.trim())) {
              textBuffer.delete(firstKey!)
              break
            }
          }
        }
      }
      pendingUserTexts.clear()
      injectedTexts.clear()

      const menuMsgId = state.getAgentMenuMessageId()
      if (menuMsgId) {
        state.clearAgentMenuMessageId()
        discordClient
          .deleteMessage(channelId, menuMsgId)
          .catch(() => {})
      }

      const allText = [...textBuffer.values()].join("\n\n")
      if (allText.trim().length === 0) return

      const segments = parseContentWithTables(allText)
      for (const segment of segments) {
        if (segment.type === "text") {
          await discordClient.sendMessage(channelId, segment.content)
        } else {
          await discordClient.sendEmbed(channelId, segment.embed)
        }
      }

      textBuffer.clear()
      return
    }

    if (event.type === "question.asked") {
      const req = event.properties
      if (!req || !req.id || !req.questions?.length) return
      if (req.sessionID !== connectedSessionId) return
      if (!discordTurnSessions.has(connectedSessionId)) return

      const channelId = state.getChannelId()
      if (!channelId) return

      state.addPendingQuestion(req.id, req.sessionID, req.questions.length)

      for (let i = 0; i < req.questions.length; i++) {
        const q = req.questions[i]
        const embed = buildQuestionEmbed(q, i, req.questions.length)
        const components = buildQuestionComponents(q, req.id, i)
        try {
          const msgId = await discordClient.sendQuestion(channelId, [embed], components)
          state.addQuestionMessageId(req.id, msgId)
        } catch (err) {
          console.error("[discord-channel] question display failed:", err)
        }
      }
      return
    }

    if (
      event.type === "session.status" &&
      event.properties?.status?.type === "busy"
    ) {
      if (!discordTurnSessions.has(connectedSessionId)) return
      const channelId = state.getChannelId()
      if (!channelId) return
      await discordClient.startTyping(channelId)
    }
  }

  return { handleEvent, trackInjectedText, markDiscordTurn }
}
