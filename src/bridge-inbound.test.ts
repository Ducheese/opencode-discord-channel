import { describe, it, expect, mock, beforeEach } from "bun:test"
import { createInboundBridge } from "./bridge-inbound"
import type { DiscordMessage } from "./types"

function createMockState(
  overrides: Partial<{
    isConnected: boolean
    sessionId: string | null
    channelId: string | null
    ownerId: string | null
    botUserId: string | null
    currentAgent: string | null
  }> = {},
) {
  const defaults = {
    isConnected: true,
    sessionId: "ses_test",
    channelId: "ch_test",
    ownerId: "owner_id_123",
    botUserId: "bot_id_456",
    currentAgent: null,
    ...overrides,
  }

  return {
    isConnected: () => defaults.isConnected,
    getSessionId: () => defaults.sessionId,
    getChannelId: () => defaults.channelId,
    getOwnerId: () => defaults.ownerId,
    getBotUserId: () => defaults.botUserId,
    getCurrentAgent: () => defaults.currentAgent,
    setCurrentAgent: mock((_name: string) => {}),
    connect: mock((_config: any) => {}),
    disconnect: mock(() => {}),
    setBotUserId: mock((_id: string) => {}),
    getState: () => ({ ...defaults }),
    setQuestionAnswer: mock(() => null),
    isQuestionComplete: () => false,
    getPendingQuestion: () => null,
    removePendingQuestion: mock(() => {}),
    getQuestionMessageIds: () => [] as string[],
    getAgentMenuMessageId: () => null as string | null,
    clearAgentMenuMessageId: mock(() => {}),
  }
}

function createMockDiscordClient() {
  let messageCallback:
    | ((msg: DiscordMessage) => void | Promise<void>)
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
    onButtonInteraction: mock(() => {}),
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
    triggerMessage: (msg: DiscordMessage) => messageCallback?.(msg),
    triggerSelectMenu: (
      customId: string,
      values: string[],
      userId: string,
    ) => selectMenuCallback?.(customId, values, userId),
    sendMessage: mock(async () => {}),
    startTyping: mock(async () => {}),
    onModalSubmit: mock(() => {}),
    deleteMessage: mock(async () => {}),
  }
}

const ownerMessage: DiscordMessage = {
  content: "hello bot",
  authorId: "owner_id_123",
  username: "OwnerUser",
  channelId: "ch_test",
  messageId: "msg_001",
}

describe("createInboundBridge", () => {
  let sessionPrompt: ReturnType<typeof mock>
  let onAgentSwitch: ReturnType<typeof mock>

  beforeEach(() => {
    sessionPrompt = mock(async (_params: any) => {})
    onAgentSwitch = mock((_agentName: string) => {})
  })

  describe("given owner message in correct channel", () => {
    it("forwards message content as plain text", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage(ownerMessage)

      expect(sessionPrompt).toHaveBeenCalledTimes(1)
      const callArgs = sessionPrompt.mock.calls[0][0]
      expect(callArgs.parts[0].text).toBe("hello bot")
    })

    it("includes agent in prompt when currentAgent is set", async () => {
      const state = createMockState({ currentAgent: "oracle" })
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage(ownerMessage)

      const callArgs = sessionPrompt.mock.calls[0][0]
      expect(callArgs.agent).toBe("oracle")
    })

    it("does not include agent when currentAgent is null", async () => {
      const state = createMockState({ currentAgent: null })
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage(ownerMessage)

      const callArgs = sessionPrompt.mock.calls[0][0]
      expect(callArgs.agent).toBeUndefined()
    })

    it("forwards raw content without wrapping", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage({
        ...ownerMessage,
        content: "test <with> special & chars",
      })

      const text = sessionPrompt.mock.calls[0][0].parts[0].text as string
      expect(text).toBe("test <with> special & chars")
    })
  })

  describe("given non-owner message", () => {
    it("ignores messages from non-owners", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage({
        ...ownerMessage,
        authorId: "random_user_999",
      })

      expect(sessionPrompt).not.toHaveBeenCalled()
    })
  })

  describe("given wrong channel message", () => {
    it("ignores messages from wrong channels", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage({
        ...ownerMessage,
        channelId: "wrong_channel",
      })

      expect(sessionPrompt).not.toHaveBeenCalled()
    })
  })

  describe("given bot self-message", () => {
    it("ignores messages from bot itself", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage({
        ...ownerMessage,
        authorId: "bot_id_456",
      })

      expect(sessionPrompt).not.toHaveBeenCalled()
    })
  })

  describe("given disconnected state", () => {
    it("ignores messages when not connected", async () => {
      const state = createMockState({ isConnected: false })
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerMessage(ownerMessage)

      expect(sessionPrompt).not.toHaveBeenCalled()
    })
  })

  describe("agent switch via select menu", () => {
    it("calls onAgentSwitch with selected agent from owner", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerSelectMenu(
        "agent_select",
        ["oracle"],
        "owner_id_123",
      )

      expect(onAgentSwitch).toHaveBeenCalledWith("oracle")
    })

    it("ignores select menu from non-owner", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerSelectMenu(
        "agent_select",
        ["oracle"],
        "random_999",
      )

      expect(onAgentSwitch).not.toHaveBeenCalled()
    })

    it("ignores non-agent-select menus", async () => {
      const state = createMockState()
      const discord = createMockDiscordClient()
      createInboundBridge({
        discordClient: discord as any,
        state: state as any,
        sessionPrompt,
        onAgentSwitch,
        onQuestionReply: mock(async () => {}),
        getQuestionInfo: () => null,
      })

      await discord.triggerSelectMenu(
        "some_other_menu",
        ["oracle"],
        "owner_id_123",
      )

      expect(onAgentSwitch).not.toHaveBeenCalled()
    })
  })
})
