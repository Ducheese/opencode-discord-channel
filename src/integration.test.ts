import { describe, it, expect, mock } from "bun:test"
import { createInboundBridge } from "./bridge-inbound"
import { createOutboundBridge } from "./bridge-outbound"
import { createSystemPromptHook } from "./system-prompt"
import { createConnectionState } from "./state"
import type { DiscordMessage } from "./types"

function createFullMockDiscordClient() {
  let messageCallback:
    | ((msg: DiscordMessage) => void | Promise<void>)
    | null = null
  let buttonCallback:
    | ((
        customId: string,
        userId: string,
        username: string,
      ) => void | Promise<void>)
    | null = null
  let selectMenuCallback:
    | ((
        customId: string,
        values: string[],
        userId: string,
      ) => void | Promise<void>)
    | null = null

  return {
    onMessage: (cb: (msg: DiscordMessage) => void | Promise<void>) => {
      messageCallback = cb
    },
    onButtonInteraction: (
      cb: (
        customId: string,
        userId: string,
        username: string,
      ) => void | Promise<void>,
    ) => {
      buttonCallback = cb
    },
    onRawButtonInteraction: mock(() => {}),
    onSelectMenuInteraction: (
      cb: (
        customId: string,
        values: string[],
        userId: string,
      ) => void | Promise<void>,
    ) => {
      selectMenuCallback = cb
    },
    triggerMessage: async (msg: DiscordMessage) => {
      await messageCallback?.(msg)
    },
    triggerButton: async (
      customId: string,
      userId: string,
      username: string,
    ) => {
      await buttonCallback?.(customId, userId, username)
    },
    triggerSelectMenu: async (
      customId: string,
      values: string[],
      userId: string,
    ) => {
      await selectMenuCallback?.(customId, values, userId)
    },
    sendMessage: mock(async (_channelId: string, _content: string) => {}),
    startTyping: mock(async (_channelId: string) => {}),
    onModalSubmit: mock(() => {}),
    sendSelectMenu: mock(
      async (_channelId: string, _embed: any, _rows: any[]) => {},
    ),
  }
}

describe("Integration: full message round-trip", () => {
  it("Discord message → session prompt → session.idle → Discord send", async () => {
    const state = createConnectionState()
    state.connect({
      botToken: "tok",
      ownerId: "owner123",
      channelId: "ch123",
      sessionId: "ses_main",
    })
    state.setBotUserId("bot456")

    const discord = createFullMockDiscordClient()
    const fetchAgents = mock(async () => [
      { name: "sisyphus", mode: "primary" as const },
    ])
    const outbound = createOutboundBridge({
      discordClient: discord as any,
      state,
      fetchAgents,
    })

    const sessionPrompt = mock(async (params: any) => {
      outbound.markDiscordTurn(params.sessionID)
      if (params.parts) {
        for (const p of params.parts) {
          if (p.text) outbound.trackInjectedText(p.text)
        }
      }
    })

    createInboundBridge({
      discordClient: discord as any,
      state,
      sessionPrompt,
      onAgentSwitch: mock((_name: string) => {}),
      onQuestionReply: mock(async () => {}),
      getQuestionInfo: () => null,
    })

    await discord.triggerMessage({
      content: "hello world",
      authorId: "owner123",
      username: "Owner",
      channelId: "ch123",
      messageId: "msg1",
    })

    expect(sessionPrompt).toHaveBeenCalledTimes(1)
    const promptArgs = sessionPrompt.mock.calls[0][0]
    expect(promptArgs.sessionID).toBe("ses_main")
    expect(promptArgs.parts[0].text).toContain("hello world")

    await outbound.handleEvent({
      type: "message.part.updated",
      properties: {
        part: {
          sessionID: "ses_main",
          messageID: "out_msg1",
          type: "text",
          text: "Bot response here",
        },
      },
    })
    await outbound.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(1)
    expect(discord.sendMessage.mock.calls[0]).toContain("Bot response here")
  })

  it("Agent switch: select menu → state updates → next prompt uses new agent", async () => {
    const state = createConnectionState()
    state.connect({
      botToken: "tok",
      ownerId: "owner123",
      channelId: "ch123",
      sessionId: "ses_main",
    })

    const discord = createFullMockDiscordClient()
    const sessionPrompt = mock(async (_params: any) => {})
    const agentSwitchCallback = mock((name: string) => {
      state.setCurrentAgent(name)
    })

    createInboundBridge({
      discordClient: discord as any,
      state,
      sessionPrompt,
      onAgentSwitch: agentSwitchCallback,
      onQuestionReply: mock(async () => {}),
      getQuestionInfo: () => null,
    })

    await discord.triggerSelectMenu("agent_select", ["oracle"], "owner123")

    expect(agentSwitchCallback).toHaveBeenCalledWith("oracle")
    expect(state.getCurrentAgent()).toBe("oracle")

    await discord.triggerMessage({
      content: "now using oracle",
      authorId: "owner123",
      username: "Owner",
      channelId: "ch123",
      messageId: "msg2",
    })

    expect(sessionPrompt.mock.calls.length).toBeGreaterThan(0)
    const lastCall =
      sessionPrompt.mock.calls[sessionPrompt.mock.calls.length - 1][0]
    expect(lastCall.agent).toBe("oracle")
  })

  it("System prompt injection when connected", async () => {
    const state = createConnectionState()
    state.connect({
      botToken: "tok",
      ownerId: "owner123",
      channelId: "ch123",
      sessionId: "ses_main",
    })

    const hook = createSystemPromptHook(state)
    const output = { system: ["base instructions"] }
    await hook({} as any, output)

    expect(output.system).toHaveLength(2)
    expect(output.system[1]).toContain("Discord")
    expect(output.system[1]).toContain("ch123")
  })

  it("System prompt NOT injected when disconnected", async () => {
    const state = createConnectionState()
    const hook = createSystemPromptHook(state)
    const output = { system: ["base instructions"] }
    await hook({} as any, output)

    expect(output.system).toHaveLength(1)
  })

  it("Typing indicator sent when session becomes busy", async () => {
    const state = createConnectionState()
    state.connect({
      botToken: "tok",
      ownerId: "owner123",
      channelId: "ch123",
      sessionId: "ses_main",
    })

    const discord = createFullMockDiscordClient()
    const fetchAgents = mock(async () => [])
    const outbound = createOutboundBridge({
      discordClient: discord as any,
      state,
      fetchAgents,
    })
    outbound.markDiscordTurn("ses_main")

    await outbound.handleEvent({
      type: "session.status",
      properties: { sessionID: "ses_main", status: { type: "busy" } },
    })

    expect(discord.startTyping).toHaveBeenCalledWith("ch123")
  })

  it("Non-owner Discord message is blocked before round-trip", async () => {
    const state = createConnectionState()
    state.connect({
      botToken: "tok",
      ownerId: "owner123",
      channelId: "ch123",
      sessionId: "ses_main",
    })

    const discord = createFullMockDiscordClient()
    const sessionPrompt = mock(async (_params: any) => {})
    createInboundBridge({
      discordClient: discord as any,
      state,
      sessionPrompt,
      onAgentSwitch: mock((_name: string) => {}),
      onQuestionReply: mock(async () => {}),
      getQuestionInfo: () => null,
    })

    await discord.triggerMessage({
      content: "intruder",
      authorId: "not-owner",
      username: "Guest",
      channelId: "ch123",
      messageId: "msg-x",
    })

    expect(sessionPrompt).not.toHaveBeenCalled()
  })
})
