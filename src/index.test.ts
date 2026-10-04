import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test"

mock.module("./config", () => ({
  resolveConfig: () => ({
    botToken: process.env.DISCORD_BOT_TOKEN,
    ownerId: process.env.DISCORD_OWNER_ID,
    defaultChannelId: process.env.TEST_DISCORD_CHANNEL_ID,
    activeSessionId: process.env.TEST_ACTIVE_SESSION_ID,
    activeSessionAt: undefined,
    activeSessionDirectory: undefined,
  }),
  getConfigPath: () => "/tmp/opencode-discord-channel.json",
  loadConfig: () => ({}),
  saveConfig: mock(() => {}),
  updateConfig: mock((partial: any) => partial),
}))

let resolveConnect: (() => void) | null = null
let inboundMessageHandler:
  | ((msg: {
      content: string
      authorId: string
      username: string
      channelId: string
      messageId: string
    }) => void)
  | null = null

const fakeDiscordClient = {
  connect: () =>
    new Promise<void>((resolve) => {
      resolveConnect = resolve
    }),
  disconnect: mock(async () => {}),
  validateChannel: mock(async () => true),
  registerSlashCommands: mock(async () => {}),
  onSlashCommand: mock(() => {}),
  onMessage: mock((handler: typeof inboundMessageHandler) => {
    inboundMessageHandler = handler
  }),
  onButtonInteraction: mock(() => {}),
  onSelectMenuInteraction: mock(() => {}),
  onRawButtonInteraction: mock(() => {}),
  onModalSubmit: mock(() => {}),
  sendMessage: mock(async () => {}),
  sendEmbed: mock(async () => {}),
  sendSelectMenu: mock(async () => "msg_menu"),
  startTyping: mock(async () => {}),
  sendQuestion: mock(async () => "msg_q"),
  deleteMessage: mock(async () => {}),
  getBotUserId: () => "bot1",
}
mock.module("./discord-client", () => ({
  createDiscordClient: () => fakeDiscordClient,
}))

const pluginModule = await import("./index")
const plugin = pluginModule.default
const updateConfigMock = (await import("./config")).updateConfig

const promptAsyncMock = mock(async (_opts: any) => {})

const mockCtx = {
  client: {
    session: {
      promptAsync: promptAsyncMock,
      get: async ({ path }: any) => ({ data: { id: path.id } }),
    },
    app: { agents: async () => ({ data: [] }) },
  },
  project: { id: "test-project" },
  directory: "/test",
  worktree: "/test",
  serverUrl: new URL("http://localhost:4096"),
}

const origBotToken = process.env.DISCORD_BOT_TOKEN
const origOwnerId = process.env.DISCORD_OWNER_ID
const origChannelId = process.env.TEST_DISCORD_CHANNEL_ID
const origActiveSessionId = process.env.TEST_ACTIVE_SESSION_ID

function cleanEnv() {
  delete process.env.DISCORD_BOT_TOKEN
  delete process.env.DISCORD_OWNER_ID
  delete process.env.TEST_DISCORD_CHANNEL_ID
  delete process.env.TEST_ACTIVE_SESSION_ID
}

function restoreEnv() {
  if (origBotToken !== undefined) process.env.DISCORD_BOT_TOKEN = origBotToken
  else delete process.env.DISCORD_BOT_TOKEN
  if (origOwnerId !== undefined) process.env.DISCORD_OWNER_ID = origOwnerId
  else delete process.env.DISCORD_OWNER_ID
  if (origChannelId !== undefined) process.env.TEST_DISCORD_CHANNEL_ID = origChannelId
  else delete process.env.TEST_DISCORD_CHANNEL_ID
  if (origActiveSessionId !== undefined) process.env.TEST_ACTIVE_SESSION_ID = origActiveSessionId
  else delete process.env.TEST_ACTIVE_SESSION_ID
}

let connected = false

async function ensureConnected(): Promise<void> {
  if (connected) return
  process.env.DISCORD_BOT_TOKEN = "token"
  process.env.DISCORD_OWNER_ID = "owner"
  process.env.TEST_DISCORD_CHANNEL_ID = "channel"
  await plugin(mockCtx as any)
  expect(resolveConnect).not.toBeNull()
  resolveConnect!()
  for (
    let i = 0;
    i < 50 && fakeDiscordClient.registerSlashCommands.mock.calls.length === 0;
    i++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  expect(fakeDiscordClient.registerSlashCommands).toHaveBeenCalled()
  connected = true
}

function simulateInbound(content: string): void {
  expect(inboundMessageHandler).not.toBeNull()
  inboundMessageHandler!({
    content,
    authorId: "owner",
    username: "owner",
    channelId: "channel",
    messageId: "msg_in",
  })
}

async function waitFor(get: () => number): Promise<void> {
  for (let i = 0; i < 50 && get() === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

describe("opencode-discord-channel plugin", () => {
  beforeEach(() => {
    cleanEnv()
  })

  afterAll(() => {
    restoreEnv()
  })

  describe("plugin() default export", () => {
    it("is an async function", () => {
      expect(typeof plugin).toBe("function")
    })

    it("returns a Hooks object", async () => {
      const hooks = await plugin(mockCtx as any)
      expect(hooks).toBeObject()
    })

    it("registers no command hooks", async () => {
      const hooks = await plugin(mockCtx as any)
      expect(hooks.config).toBeUndefined()
      expect(hooks["command.execute.before"]).toBeUndefined()
    })

    it("includes event hook", async () => {
      const hooks = await plugin(mockCtx as any)
      expect(typeof hooks.event).toBe("function")
    })

    it("includes experimental.chat.system.transform hook", async () => {
      const hooks = await plugin(mockCtx as any)
      expect(typeof hooks["experimental.chat.system.transform"]).toBe(
        "function",
      )
    })
  })

  describe("startup connect", () => {
    it("does not override a session that received a prompt while connecting", async () => {
      process.env.DISCORD_BOT_TOKEN = "token"
      process.env.DISCORD_OWNER_ID = "owner"
      process.env.TEST_DISCORD_CHANNEL_ID = "channel"
      process.env.TEST_ACTIVE_SESSION_ID = "ses_persisted"
      try {
        const hooks = await plugin(mockCtx as any)
        await hooks["chat.message"]!(
          { sessionID: "ses_during_connect" },
          { message: { time: { created: 500 } } as any, parts: [] },
        )
        expect(resolveConnect).not.toBeNull()
        resolveConnect!()
        for (
          let i = 0;
          i < 50 && fakeDiscordClient.registerSlashCommands.mock.calls.length === 0;
          i++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
        expect(fakeDiscordClient.registerSlashCommands).toHaveBeenCalled()

        simulateInbound("ping")
        await waitFor(() => promptAsyncMock.mock.calls.length)
        expect(promptAsyncMock).toHaveBeenLastCalledWith(
          expect.objectContaining({ path: { id: "ses_during_connect" } }),
        )
        connected = true
      } finally {
        delete process.env.DISCORD_BOT_TOKEN
        delete process.env.DISCORD_OWNER_ID
        delete process.env.TEST_DISCORD_CHANNEL_ID
        delete process.env.TEST_ACTIVE_SESSION_ID
      }
    })
  })

  describe("chat.message hook", () => {
    beforeEach(() => updateConfigMock.mockClear())

    it("persists the latest main session as Discord target", async () => {
      const hooks = await plugin(mockCtx as any)
      await hooks["chat.message"]!(
        { sessionID: "ses_main" },
        { message: { time: { created: 1234 } } as any, parts: [] },
      )
      expect(updateConfigMock).toHaveBeenCalledWith({
        activeSessionId: "ses_main",
        activeSessionAt: 1234,
        activeSessionDirectory: "/test",
      })
    })

    it("does not let subagent messages replace the active target", async () => {
      const client = {
        ...mockCtx.client,
        session: {
          ...mockCtx.client.session,
          get: async ({ path }: any) => ({ data: { id: path.id, parentID: "ses_main" } }),
        },
      }
      const hooks = await plugin({ ...mockCtx, client } as any)
      await hooks["chat.message"]!(
        { sessionID: "ses_subagent" },
        { message: { time: { created: 1234 } } as any, parts: [] },
      )
      expect(updateConfigMock).not.toHaveBeenCalled()
    })

    it("keeps the most recently received main-session message as target", async () => {
      const hooks = await plugin(mockCtx as any)
      await hooks["chat.message"]!(
        { sessionID: "ses_newer" },
        { message: { time: { created: 2000 } } as any, parts: [] },
      )
      await hooks["chat.message"]!(
        { sessionID: "ses_older" },
        { message: { time: { created: 1000 } } as any, parts: [] },
      )
      expect(updateConfigMock).toHaveBeenLastCalledWith({
        activeSessionId: "ses_newer",
        activeSessionAt: 2000,
        activeSessionDirectory: "/test",
      })
    })
  })

  describe("Discord turn detection (end to end)", () => {
    beforeEach(() => {
      promptAsyncMock.mockClear()
      fakeDiscordClient.sendMessage.mockClear()
    })

    it("mirrors the reply of a turn that started from Discord", async () => {
      await ensureConnected()
      const hooks = await plugin(mockCtx as any)

      await hooks["chat.message"]!(
        { sessionID: "ses_discord" },
        { message: { time: { created: 3000 } } as any, parts: [] },
      )

      simulateInbound("hello from discord")
      await waitFor(() => promptAsyncMock.mock.calls.length)
      expect(promptAsyncMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: { id: "ses_discord" } }),
      )

      await hooks["chat.message"]!(
        { sessionID: "ses_discord" },
        {
          message: { time: { created: 3001 } } as any,
          parts: [{ type: "text", text: "hello from discord" }],
        },
      )

      await hooks.event!({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part_discord",
              sessionID: "ses_discord",
              messageID: "msg_discord",
              type: "text",
              text: "The answer is 4.",
            },
          },
        } as any,
      })
      await hooks.event!({
        event: {
          type: "session.idle",
          properties: { sessionID: "ses_discord" },
        } as any,
      })

      expect(fakeDiscordClient.sendMessage).toHaveBeenCalledWith(
        "channel",
        "The answer is 4.",
      )
    })

    it("does not mirror a reply for a locally typed turn", async () => {
      await ensureConnected()
      const hooks = await plugin(mockCtx as any)

      await hooks["chat.message"]!(
        { sessionID: "ses_local" },
        { message: { time: { created: 3100 } } as any, parts: [] },
      )

      await hooks.event!({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part_local",
              sessionID: "ses_local",
              messageID: "msg_local",
              type: "text",
              text: "locally generated reply",
            },
          },
        } as any,
      })
      await hooks.event!({
        event: {
          type: "session.idle",
          properties: { sessionID: "ses_local" },
        } as any,
      })

      expect(fakeDiscordClient.sendMessage).not.toHaveBeenCalled()
    })

    it("keeps a Discord turn alive when a delayed message from an older session arrives", async () => {
      await ensureConnected()
      const hooks = await plugin(mockCtx as any)

      await hooks["chat.message"]!(
        { sessionID: "ses_a" },
        { message: { time: { created: 4000 } } as any, parts: [] },
      )
      simulateInbound("hi from discord")
      await waitFor(() => promptAsyncMock.mock.calls.length)
      expect(promptAsyncMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ path: { id: "ses_a" } }),
      )

      await hooks["chat.message"]!(
        { sessionID: "ses_b" },
        { message: { time: { created: 4001 } } as any, parts: [] },
      )

      await hooks["chat.message"]!(
        { sessionID: "ses_a" },
        {
          message: { time: { created: 4002 } } as any,
          parts: [{ type: "text", text: "hi from discord" }],
        },
      )

      await hooks.event!({
        event: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "part_a",
              sessionID: "ses_a",
              messageID: "msg_a",
              type: "text",
              text: "answer from A",
            },
          },
        } as any,
      })
      await hooks.event!({
        event: {
          type: "session.idle",
          properties: { sessionID: "ses_a" },
        } as any,
      })

      expect(fakeDiscordClient.sendMessage).toHaveBeenCalledWith(
        "channel",
        "answer from A",
      )
    })
  })
})
