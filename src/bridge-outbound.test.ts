import { beforeEach, describe, expect, it, mock } from "bun:test"
import { createOutboundBridge } from "./bridge-outbound"

function createMockState(
  overrides: Partial<{
    isConnected: boolean
    sessionId: string | null
    channelId: string | null
    currentAgent: string | null
  }> = {},
) {
  const defaults = {
    isConnected: true,
    sessionId: "ses_main",
    channelId: "ch_discord",
    currentAgent: null,
    ...overrides,
  }

  return {
    isConnected: () => defaults.isConnected,
    getSessionId: () => defaults.sessionId,
    getChannelId: () => defaults.channelId,
    getCurrentAgent: () => defaults.currentAgent,
    getState: () => ({ ...defaults }),
    addPendingQuestion: mock(() => {}),
    addQuestionMessageId: mock(() => {}),
    getAgentMenuMessageId: () => null as string | null,
    clearAgentMenuMessageId: mock(() => {}),
  }
}

function createMockDiscordClient() {
  return {
    sendMessage: mock(async (_channelId: string, _content: string) => {}),
    sendEmbed: mock(async (_channelId: string, _embed: any) => {}),
    startTyping: mock(async (_channelId: string) => {}),
    sendSelectMenu: mock(
      async (_channelId: string, _embed: any, _rows: any[]) => "msg_menu",
    ),
    sendQuestion: mock(
      async (_channelId: string, _embeds: any[], _rows: any[]) => "msg_q",
    ),
    deleteMessage: mock(async (_channelId: string, _messageId: string) => {}),
  }
}

function createMockAgentDisplay() {
  return {
    buildAgentEmbed: mock(
      (_name: string, _color?: string, _status?: string) => ({
        toJSON: () => ({}),
      }),
    ),
    buildAgentSelectMenu: mock((_agents: any[], _current: string) => []),
  }
}

describe("createOutboundBridge", () => {
  let state: ReturnType<typeof createMockState>
  let discord: ReturnType<typeof createMockDiscordClient>
  let agentDisplay: ReturnType<typeof createMockAgentDisplay>
  let fetchAgents: ReturnType<typeof mock>
  let bridge: ReturnType<typeof createOutboundBridge>
  let handler: (event: any) => Promise<void>

  beforeEach(() => {
    state = createMockState()
    discord = createMockDiscordClient()
    agentDisplay = createMockAgentDisplay()
    fetchAgents = mock(async () => [
      { name: "sisyphus", mode: "primary" as const },
    ])

    bridge = createOutboundBridge({
      discordClient: discord as any,
      state: state as any,
      agentDisplay: agentDisplay as any,
      fetchAgents,
    })
    bridge.markDiscordTurn("ses_main")
    handler = bridge.handleEvent
  })

  it("buffers text on message.part.updated and does not send immediately", async () => {
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "hello",
        },
      },
    })

    expect(discord.sendMessage).not.toHaveBeenCalled()
    expect(discord.sendSelectMenu).not.toHaveBeenCalled()
  })

  it("replaces text for same messageID on repeated part updates", async () => {
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "hel",
        },
      },
    })
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "hello world",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(1)
    expect(discord.sendMessage.mock.calls[0]?.[1]).toBe("hello world")
  })

  it("sends buffered text on session.idle", async () => {
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "hello world",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(1)
    expect(discord.sendMessage.mock.calls[0]).toContain("hello world")
  })

  it("does not send when buffer is empty", async () => {
    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).not.toHaveBeenCalled()
    expect(discord.sendSelectMenu).not.toHaveBeenCalled()
  })

  it("clears buffer after sending once", async () => {
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "first",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })
    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(1)
  })

  it("keeps buffer when sendMessage fails, then retries on next idle", async () => {
    discord.sendMessage.mockRejectedValueOnce(new Error("send failed"))

    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "first",
        },
      },
    })

    await expect(
      handler({
        type: "session.idle",
        properties: { sessionID: "ses_main" },
      }),
    ).rejects.toThrow("send failed")

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(2)
    expect(discord.sendMessage.mock.calls[1]?.[1]).toBe("first")
  })

  it("ignores tool parts", async () => {
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "tool",
          tool: "bash",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).not.toHaveBeenCalled()
  })

  describe("given reasoning part", () => {
    it("ignores reasoning parts", async () => {
      await handler({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part1",
            sessionID: "ses_main",
            messageID: "msg1",
            type: "reasoning",
            text: "thinking...",
          },
        },
      })
      await handler({
        type: "session.idle",
        properties: { sessionID: "ses_main" },
      })
      expect(discord.sendMessage).not.toHaveBeenCalled()
    })
  })

  it("ignores non-text parts like reasoning", async () => {
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "reasoning",
          text: "think",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).not.toHaveBeenCalled()
  })

  it("ignores events from different session", async () => {
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_OTHER",
          messageID: "msg1",
          type: "text",
          text: "ignore me",
        },
      },
    })
    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_OTHER" },
    })
    await handler({
      type: "session.status",
      properties: { sessionID: "ses_OTHER", status: { type: "busy" } },
    })

    expect(discord.sendMessage).not.toHaveBeenCalled()
    expect(discord.startTyping).not.toHaveBeenCalled()
  })

  it("sends typing indicator on session.status busy", async () => {
    await handler({
      type: "session.status",
      properties: { sessionID: "ses_main", status: { type: "busy" } },
    })

    expect(discord.startTyping).toHaveBeenCalledWith("ch_discord")
  })

  it("does not send typing indicator for idle status", async () => {
    await handler({
      type: "session.status",
      properties: { sessionID: "ses_main", status: { type: "idle" } },
    })

    expect(discord.startTyping).not.toHaveBeenCalled()
  })

  it("does not send select menu when no rows", async () => {
    agentDisplay.buildAgentSelectMenu.mockReturnValueOnce([])

    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "hello",
        },
      },
    })
    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendSelectMenu).not.toHaveBeenCalled()
  })

  it("ignores all events when disconnected", async () => {
    state = createMockState({ isConnected: false })
    const bridge = createOutboundBridge({
      discordClient: discord as any,
      state: state as any,
      agentDisplay: agentDisplay as any,
      fetchAgents,
    })
    handler = bridge.handleEvent

    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "hi",
        },
      },
    })
    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })
    await handler({
      type: "session.status",
      properties: { sessionID: "ses_main", status: { type: "busy" } },
    })

    expect(discord.sendMessage).not.toHaveBeenCalled()
    expect(discord.sendSelectMenu).not.toHaveBeenCalled()
    expect(discord.startTyping).not.toHaveBeenCalled()
  })

  it("does not throw if fetchAgents fails after sending text", async () => {
    fetchAgents = mock(async () => {
      throw new Error("agent list failed")
    })
    const originalError = console.error
    console.error = mock(() => {}) as any
    try {
      const bridge = createOutboundBridge({
        discordClient: discord as any,
        state: state as any,
        agentDisplay: agentDisplay as any,
        fetchAgents,
      })
      bridge.markDiscordTurn("ses_main")
      handler = bridge.handleEvent

      await handler({
        type: "message.part.updated",
        properties: {
          part: {
            id: "part1",
            sessionID: "ses_main",
            messageID: "msg1",
            type: "text",
            text: "hi",
          },
        },
      })

      await expect(
        handler({
          type: "session.idle",
          properties: { sessionID: "ses_main" },
        }),
      ).resolves.toBeUndefined()
      expect(discord.sendMessage).toHaveBeenCalledTimes(1)
      expect(discord.sendSelectMenu).not.toHaveBeenCalled()
    } finally {
      console.error = originalError
    }
  })

  it("filters out user's injected prompt from being echoed back to Discord in part.updated", async () => {
    bridge.trackInjectedText("what is 2 + 2?")

    // 1. User's own prompt event arrives
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "user_part_1",
          sessionID: "ses_main",
          messageID: "msg_user",
          type: "text",
          text: "what is 2 + 2?",
        },
      },
    })

    // 2. Assistant's response arrives
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "asst_part_1",
          sessionID: "ses_main",
          messageID: "msg_asst",
          type: "text",
          text: "The answer is 4.",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(1)
    expect(discord.sendMessage.mock.calls[0]?.[1]).toBe("The answer is 4.")
    expect(discord.sendMessage.mock.calls[0]?.[1]).not.toContain("what is 2 + 2?")
  })

  it("purges user prompt from textBuffer at session.idle even if part.updated filter was bypassed", async () => {
    // Simulate prompt reaching textBuffer first before trackInjectedText was called
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "user_part_1",
          sessionID: "ses_main",
          messageID: "msg_user",
          type: "text",
          text: "user leaked text\r\nline 2",
        },
      },
    })

    // Now track injected text (with different newline formatting)
    bridge.trackInjectedText("user leaked text\nline 2")

    // Assistant response
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "asst_part_1",
          sessionID: "ses_main",
          messageID: "msg_asst",
          type: "text",
          text: "Real answer",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(1)
    expect(discord.sendMessage.mock.calls[0]?.[1]).toBe("Real answer")
  })

  it("does not accidentally strip bot response that starts with user prompt (prevents false positive startsWith)", async () => {
    bridge.trackInjectedText("test")

    // Assistant response begins with "test"
    await handler({
      type: "message.part.updated",
      properties: {
        part: {
          id: "asst_part_1",
          sessionID: "ses_main",
          messageID: "msg_asst",
          type: "text",
          text: "testing passed successfully with all results green",
        },
      },
    })

    await handler({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).toHaveBeenCalledTimes(1)
    expect(discord.sendMessage.mock.calls[0]?.[1]).toBe("testing passed successfully with all results green")
  })

  it("silently drops session.idle when the turn was not initiated from Discord", async () => {
    const uninitiatedBridge = createOutboundBridge({
      discordClient: discord as any,
      state: state as any,
      agentDisplay: agentDisplay as any,
      fetchAgents,
    })
    // Do NOT call markDiscordTurn

    await uninitiatedBridge.handleEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part1",
          sessionID: "ses_main",
          messageID: "msg1",
          type: "text",
          text: "TUI message",
        },
      },
    })

    await uninitiatedBridge.handleEvent({
      type: "session.idle",
      properties: { sessionID: "ses_main" },
    })

    expect(discord.sendMessage).not.toHaveBeenCalled()
  })
})
