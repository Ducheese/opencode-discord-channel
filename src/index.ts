import "./proxy"
import type { Plugin } from "@opencode-ai/plugin"
import { createDiscordClient } from "./discord-client"
import { createConnectionState } from "./state"
import { createInboundBridge } from "./bridge-inbound"
import { createOutboundBridge } from "./bridge-outbound"
import { createSystemPromptHook } from "./system-prompt"
import { buildAgentEmbed, buildAgentSelectMenu } from "./agent-display"
import { resolveConfig, updateConfig } from "./config"
import type { DiscordClientWrapper } from "./discord-client"
import type { ConnectionStateManager } from "./state"
import type { AgentInfo, QuestionAnswer, QuestionRequest } from "./types"
import { textPart } from "./types"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

let activeDiscordClient: DiscordClientWrapper | null = null
let activeState: ConnectionStateManager | null = null
let activeEventHandler: ((event: any) => Promise<void>) | null = null
let activeOutboundBridge: ReturnType<typeof createOutboundBridge> | null = null
let activeContext: Parameters<Plugin>[0] | null = null
const handledEventIds = new Set<string>()
const questionRequests = new Map<string, QuestionRequest>()
const instanceOwners = new Set<symbol>()
const instanceContexts = new Map<symbol, Parameters<Plugin>[0]>()
const instanceOutboundBridges = new Map<symbol, ReturnType<typeof createOutboundBridge>>()
let inboundInitialized = false
let discordConnectPromise: Promise<void> | null = null
let activeSessionAt = 0
let chatHookSequence = 0
let activeSessionSequence = 0

const logFile = path.join(os.tmpdir(), "opencode-discord-channel.log")
function log(msg: string) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

const plugin: Plugin = async (ctx) => {
  const owner = Symbol("discord-channel-instance")
  instanceOwners.add(owner)
  instanceContexts.set(owner, ctx)
  const persistedTarget = resolveConfig()
  activeSessionAt = Math.max(activeSessionAt, persistedTarget.activeSessionAt ?? 0)
  if (persistedTarget.activeSessionDirectory === ctx.directory) activeContext = ctx
  const discordClient = activeDiscordClient ?? createDiscordClient()
  const state = activeState ?? createConnectionState()
  activeDiscordClient = discordClient
  activeState = state

  let outbound: ReturnType<typeof createOutboundBridge> | null = null
  let isConnecting = false

  async function promptSession(params: {
    sessionID: string
    agent?: string
    parts: unknown[]
  }): Promise<void> {
    log(`[promptSession] sessionID=${params.sessionID}`)

    if (outbound && Array.isArray(params.parts)) {
      for (const p of params.parts) {
        const text = (p as any)?.text
        if (typeof text === "string" && text.trim()) {
          outbound.trackInjectedText(text)
        }
      }
    }

    const body: Record<string, unknown> = { parts: params.parts }
    if (params.agent) body.agent = params.agent

    const currentContext = activeContext ?? ctx
    try {
      const result = await (currentContext.client as any).session.promptAsync({
        path: { id: params.sessionID },
        body,
      })
      log(`[promptSession] result: ${JSON.stringify(result).slice(0, 500)}`)
    } catch (err) {
      log(`[promptSession] promptAsync threw: ${err}`)
      try {
        const result = await (currentContext.client as any).session.prompt({
          path: { id: params.sessionID },
          body: { parts: params.parts },
        })
        log(`[promptSession] prompt fallback: ${JSON.stringify(result).slice(0, 500)}`)
      } catch (err2) {
        log(`[promptSession] prompt also threw: ${err2}`)
        throw err2
      }
    }
  }

  async function replyQuestion(
    requestID: string,
    answers: QuestionAnswer[],
  ): Promise<void> {
    log(`[question] reply requestID=${requestID}`)
    const currentContext = activeContext ?? ctx
    const internalClient = (currentContext.client as any)._client
    if (internalClient?.post) {
      const result = await internalClient.post({
        url: `/question/${encodeURIComponent(requestID)}/reply`,
        body: { answers },
        headers: { "Content-Type": "application/json" },
      })
      log(
        `[question] reply via internal client: ${JSON.stringify(result?.data ?? result?.error).slice(0, 200)}`,
      )
      if (result?.error) {
        throw new Error(
          `Question reply failed: ${JSON.stringify(result.error)}`,
        )
      }
    } else {
      const baseUrl = currentContext.serverUrl.toString().replace(/\/$/, "")
      const url = `${baseUrl}/question/${encodeURIComponent(requestID)}/reply`
      log(`[question] reply POST ${url}`)
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      })
      if (!resp.ok) {
        const body = await resp.text().catch(() => "")
        throw new Error(`Question reply failed: ${resp.status} ${body}`)
      }
    }
    questionRequests.delete(requestID)
    log(`[question] reply success`)
  }

  async function fetchAgents(): Promise<AgentInfo[]> {
    try {
      const result = await (activeContext ?? ctx).client.app.agents()
      const agents = result.data ?? []
      return agents.map((a: any) => ({
        name: a.name,
        mode: (a.mode ?? "primary") as AgentInfo["mode"],
        color: a.color,
        description: a.description,
      }))
    } catch {
      return []
    }
  }

  outbound = activeOutboundBridge ?? createOutboundBridge({
    discordClient,
    state,
    agentDisplay: { buildAgentEmbed, buildAgentSelectMenu },
    fetchAgents,
  })
  activeEventHandler = outbound.handleEvent
  activeOutboundBridge = outbound
  instanceOutboundBridges.set(owner, outbound)

  const systemPromptHook = createSystemPromptHook(state)

  async function doConnect(params: {
    token: string
    ownerId: string
    channelId: string
    sessionId?: string | null
  }): Promise<void> {
    if (
      state.isConnected() &&
      state.getChannelId() === params.channelId
    ) {
      log(`[connect] already connected to ${params.channelId}`)
      if (params.sessionId && !state.getSessionId()) state.setSessionId(params.sessionId)
      return
    }

    if (discordConnectPromise) {
      await discordConnectPromise
      if (state.isConnected() && state.getChannelId() === params.channelId) {
        if (params.sessionId && !state.getSessionId()) state.setSessionId(params.sessionId)
        return
      }
    }

    log(`[connect] connecting to discord with channel=${params.channelId}`)
    const connecting = (async () => {
      await discordClient.connect(params.token)

      const channelValid = await discordClient.validateChannel(params.channelId)
      if (!channelValid) {
        await discordClient.disconnect().catch(() => {})
        state.disconnect()
        throw new Error(`Channel ${params.channelId} not found or bot lacks access.`)
      }

      state.connect({
        botToken: params.token,
        ownerId: params.ownerId,
        channelId: params.channelId,
        sessionId: state.getSessionId() ?? params.sessionId ?? null,
      })

      const botUserId = discordClient.getBotUserId() ?? ""
      state.setBotUserId(botUserId)
      updateConfig({ defaultChannelId: params.channelId })

      try {
        await discordClient.registerSlashCommands(params.token, params.channelId)
        log("[slash] commands registered")
      } catch (err) {
        log(`[slash] registration warning: ${err}`)
      }

      log(`[connect] success: Discord bridge connected to channel ${params.channelId}`)
    })()
    discordConnectPromise = connecting
    try {
      await connecting
    } finally {
      if (discordConnectPromise === connecting) discordConnectPromise = null
    }
  }

  async function tryAutoConnect(): Promise<boolean> {
    if (state.isConnected() || isConnecting) return state.isConnected()
    const cfg = resolveConfig()
    if (!cfg.botToken || !cfg.ownerId || !cfg.defaultChannelId) {
      log("[auto-connect] missing bot token, owner ID, or default channel ID")
      return false
    }
    isConnecting = true
    try {
      log(`[auto-connect] auto-connecting to channel=${cfg.defaultChannelId}`)
      await doConnect({
        token: cfg.botToken,
        ownerId: cfg.ownerId,
        channelId: cfg.defaultChannelId,
        sessionId: cfg.activeSessionId ?? null,
      })
      return true
    } catch (err) {
      log(`[auto-connect] failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    } finally {
      isConnecting = false
    }
  }

  discordClient.onSlashCommand(async (command, interaction) => {
    if (command !== "agents") {
      await interaction.reply({ content: "Unknown command.", ephemeral: true })
      return
    }
    if (!state.isConnected()) {
      await interaction.reply({ content: "Discord bridge is not connected.", ephemeral: true })
      return
    }
    const ch = interaction.channelId as string
    await interaction.deferReply({ ephemeral: true })
    try {
      const agents = await fetchAgents()
      if (agents.length <= 1) {
        await interaction.editReply({ content: "No agents available." })
        return
      }
      const currentAgent = state.getCurrentAgent() ?? agents[0]?.name ?? ""
      const embed = buildAgentEmbed(currentAgent)
      const rows = buildAgentSelectMenu(agents, currentAgent)
      if (rows.length > 0) {
        const msgId = await discordClient.sendSelectMenu(ch, embed, rows)
        state.setAgentMenuMessageId(msgId)
      }
      await interaction.editReply({ content: "Agent selector sent." })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      await interaction.editReply({ content: `Failed: ${msg}` }).catch(() => {})
    }
  })

  if (!inboundInitialized) createInboundBridge({
    discordClient,
    state,
    sessionPrompt: async (p) => {
      activeOutboundBridge?.markDiscordTurn(p.sessionID)
      await promptSession({
        sessionID: p.sessionID,
        agent: p.agent,
        parts: p.parts.map((part) => textPart(part.text)),
      })
    },
    onAgentSwitch: async (agentName) => {
      state.setCurrentAgent(agentName)
      const sid = state.getSessionId()
      if (sid) activeOutboundBridge?.markDiscordTurn(sid)
      if (!sid) return
      await promptSession({
        sessionID: sid,
        agent: agentName,
        parts: [textPart(`(Agent switched to ${agentName} via Discord)`)],
      }).catch(() => {})
    },
    onQuestionReply: replyQuestion,
    getQuestionInfo: (requestID, questionIndex) => {
      const req = questionRequests.get(requestID)
      return req?.questions[questionIndex] ?? null
    },
  })
  if (!inboundInitialized) inboundInitialized = true

  void tryAutoConnect()

  return {
    async "chat.message"(input, output) {
      const sequence = ++chatHookSequence
      try {
        const result = await (ctx.client as any).session.get({ path: { id: input.sessionID } })
        if (!result?.data || result.data.parentID) return
      } catch (err) {
        log(`[session] failed to inspect ${input.sessionID}: ${err}`)
        return
      }

      const messageAt = Number(output.message?.time?.created ?? Date.now())
      const config = resolveConfig()
      if (
        sequence < activeSessionSequence ||
        messageAt < Math.max(activeSessionAt, config.activeSessionAt ?? 0)
      ) {
        return
      }
      activeSessionSequence = sequence
      activeSessionAt = messageAt
      activeContext = ctx
      if (state.getSessionId() !== input.sessionID) {
        activeOutboundBridge?.clearBuffers()
      }
      state.setSessionId(input.sessionID)
      const fromDiscord = output.parts.some(
        (part) => part.type === "text" && state.isInjectedText(part.text),
      )
      if (fromDiscord) state.markDiscordTurn(input.sessionID)
      else state.clearDiscordTurn(input.sessionID)
      updateConfig({
        activeSessionId: input.sessionID,
        activeSessionAt: messageAt,
        activeSessionDirectory: ctx.directory,
      })
      log(`[session] active Discord target updated to ${input.sessionID}`)
    },

    async event({ event }) {
      const evt = event as { type: string; properties?: any }
      const eventId = (event as any)?.id
      if (typeof eventId === "string") {
        if (handledEventIds.has(eventId)) return
        handledEventIds.add(eventId)
        if (handledEventIds.size > 2048) {
          const oldest = handledEventIds.values().next().value
          if (oldest) handledEventIds.delete(oldest)
        }
      }
      if (
        evt.type === "question.asked" &&
        evt.properties?.id &&
        evt.properties?.questions
      ) {
        questionRequests.set(evt.properties.id, evt.properties)
      }

      if (activeEventHandler) {
        await activeEventHandler(event)
      }
    },

    async "experimental.chat.system.transform"(input, output) {
      await systemPromptHook(input, output)
    },

    async dispose() {
      log("[plugin] dispose: cleaning up Discord connection")
      instanceOwners.delete(owner)
      instanceContexts.delete(owner)
      instanceOutboundBridges.delete(owner)
      if (activeEventHandler === outbound?.handleEvent) {
        activeOutboundBridge = [...instanceOwners]
          .map((instance) => instanceOutboundBridges.get(instance))
          .find((bridge): bridge is ReturnType<typeof createOutboundBridge> => Boolean(bridge)) ?? null
        activeEventHandler = activeOutboundBridge?.handleEvent ?? null
      }
      if (activeContext === ctx) activeContext = [...instanceOwners]
        .map((instance) => instanceContexts.get(instance))
        .find((context): context is Parameters<Plugin>[0] => Boolean(context)) ?? null
      if (instanceOwners.size > 0) return
      activeContext = null
      activeSessionSequence = 0
      activeSessionAt = 0
      handledEventIds.clear()
      instanceOutboundBridges.clear()
      activeOutboundBridge = null
      inboundInitialized = false
      await discordClient.disconnect().catch(() => {})
      state.disconnect()
      activeEventHandler = null
      activeDiscordClient = null
      activeState = null
    },
  }
}

export default plugin
