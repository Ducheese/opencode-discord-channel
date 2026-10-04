import { describe, it, expect } from "bun:test"
import type {
  ConnectionState,
  BridgeConfig,
  DiscordMessage,
  AgentInfo,
} from "./types"
import type { PluginInput } from "@opencode-ai/plugin"

describe("ConnectionState", () => {
  it("should have required fields with correct types", () => {
    const state: ConnectionState = {
      connected: false,
      sessionId: null,
      channelId: null,
      ownerId: null,
      botUserId: null,
      currentAgent: null,
    }
    expect(state.connected).toBe(false)
    expect(state.sessionId).toBeNull()
    expect(state.currentAgent).toBeNull()
  })

  it("should accept connected state with all string fields", () => {
    const state: ConnectionState = {
      connected: true,
      sessionId: "ses_abc123",
      channelId: "123456789",
      ownerId: "987654321",
      botUserId: "111222333",
      currentAgent: "oracle",
    }
    expect(state.connected).toBe(true)
    expect(state.currentAgent).toBe("oracle")
  })
})

describe("BridgeConfig", () => {
  it("should have all required string fields", () => {
    const config: BridgeConfig = {
      botToken: "token123",
      ownerId: "owner456",
      channelId: "channel789",
      sessionId: "ses_abc",
    }
    expect(config.botToken).toBe("token123")
    expect(config.sessionId).toBe("ses_abc")
  })

  it("allows the Discord bot to connect before a session has been selected", () => {
    const config: BridgeConfig = {
      botToken: "token123",
      ownerId: "owner456",
      channelId: "channel789",
      sessionId: null,
    }
    expect(config.sessionId).toBeNull()
  })
})

describe("DiscordMessage", () => {
  it("should have content, authorId, username, channelId, messageId", () => {
    const msg: DiscordMessage = {
      content: "hello",
      authorId: "123",
      username: "TestUser",
      channelId: "456",
      messageId: "789",
    }
    expect(msg.username).toBe("TestUser")
    expect(msg.content).toBe("hello")
  })
})

describe("AgentInfo", () => {
  it("should accept primary mode", () => {
    const agent: AgentInfo = { name: "oracle", mode: "primary" }
    expect(agent.name).toBe("oracle")
    expect(agent.mode).toBe("primary")
  })

  it("should accept subagent mode with optional fields", () => {
    const agent: AgentInfo = {
      name: "explore",
      mode: "subagent",
      color: "#FF5733",
      description: "Codebase explorer",
    }
    expect(agent.mode).toBe("subagent")
    expect(agent.color).toBe("#FF5733")
  })

  it("should accept all mode", () => {
    const agent: AgentInfo = { name: "sisyphus", mode: "all" }
    expect(agent.mode).toBe("all")
  })
})

type _PluginInput = PluginInput
