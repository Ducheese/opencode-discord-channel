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
    | "markDiscordTurn"
    | "isDiscordTurn"
    | "clearDiscordTurn"
    | "markInjectedText"
    | "isInjectedText"
    | "clearInjectedTexts"
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
  clearBuffers: () => void
} {
  const { discordClient, state, fetchAgents } = deps
  const display = deps.agentDisplay ?? {
    buildAgentEmbed,
    buildAgentSelectMenu,
  }
  const textBuffer = new Map<string, string>()
  const pendingUserTexts = new Set<string>()
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

  function normalizeText(text: string): string {
    return text.trim().replace(/\r\n/g, "\n")
  }

  function trackInjectedText(text: string) {
    state.markInjectedText(text)
    pendingUserTexts.add(text)
  }

  function markDiscordTurn(sessionID: string) {
    state.markDiscordTurn(sessionID)
  }

  function clearBuffers() {
    textBuffer.clear()
    pendingUserTexts.clear()
  }

  async function handleEvent(event: OpenCodeEvent): Promise<void> {
    if (!state.isConnected()) return

    if (event.type === "message.part.updated") {
      const part = event.properties?.part
      if (!part) return
      const sessionID = part.sessionID
      if (!sessionID || sessionID !== state.getSessionId() || !state.isDiscordTurn(sessionID)) return
      if (part.type !== "text") return
      if (part.text) {
        const norm = normalizeText(part.text)
        if (state.isInjectedText(part.text)) return
        for (const t of pendingUserTexts) {
          if (norm === normalizeText(t)) return
        }
      }
      const partKey = part.id ?? part.messageID
      if (!partKey || typeof part.text !== "string") return

      textBuffer.set(partKey, part.text)
      return
    }

    const sessionID = event.properties?.sessionID
    if (!sessionID || sessionID !== state.getSessionId() || !state.isDiscordTurn(sessionID)) return

    if (event.type === "session.idle") {
      const channelId = state.getChannelId()
      if (!channelId) return

      // Strip user's prompt if it leaked into buffer
      if (textBuffer.size > 0 && pendingUserTexts.size > 0) {
        for (const [key, val] of textBuffer.entries()) {
          const normVal = normalizeText(val)
          for (const t of pendingUserTexts) {
            if (normVal === normalizeText(t)) {
              textBuffer.delete(key)
              break
            }
          }
        }
      }
      pendingUserTexts.clear()
      state.clearInjectedTexts()

      const menuMsgId = state.getAgentMenuMessageId()
      if (menuMsgId) {
        state.clearAgentMenuMessageId()
        discordClient
          .deleteMessage(channelId, menuMsgId)
          .catch(() => {})
      }

      const allText = [...textBuffer.values()].join("\n\n")
      if (allText.trim().length === 0) {
        state.clearDiscordTurn(sessionID)
        return
      }

      const segments = parseContentWithTables(allText)
      for (const segment of segments) {
        if (segment.type === "text") {
          await discordClient.sendMessage(channelId, segment.content)
        } else {
          await discordClient.sendEmbed(channelId, segment.embed)
        }
      }

      textBuffer.clear()
      state.clearDiscordTurn(sessionID)
      return
    }

    if (event.type === "question.asked") {
      const req = event.properties
      if (!req || !req.id || !req.questions?.length) return
      if (req.sessionID !== sessionID) return

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
      const channelId = state.getChannelId()
      if (!channelId) return
      await discordClient.startTyping(channelId)
    }
  }

  return { handleEvent, trackInjectedText, markDiscordTurn, clearBuffers }
}
