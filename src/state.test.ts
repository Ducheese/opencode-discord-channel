import { describe, it, expect } from "bun:test"
import { createConnectionState } from "./state"
import type { BridgeConfig } from "./types"

const validConfig: BridgeConfig = {
  botToken: "test-token",
  ownerId: "owner123",
  channelId: "channel456",
  sessionId: "ses_abc",
}

describe("createConnectionState", () => {
  describe("given initial state", () => {
    it("starts disconnected", () => {
      const state = createConnectionState()
      expect(state.isConnected()).toBe(false)
    })

    it("has null sessionId initially", () => {
      const state = createConnectionState()
      expect(state.getSessionId()).toBeNull()
    })

    it("has null currentAgent initially", () => {
      const state = createConnectionState()
      expect(state.getCurrentAgent()).toBeNull()
    })

    it("returns full null state from getState()", () => {
      const state = createConnectionState()
      const s = state.getState()
      expect(s.connected).toBe(false)
      expect(s.sessionId).toBeNull()
      expect(s.channelId).toBeNull()
      expect(s.ownerId).toBeNull()
      expect(s.botUserId).toBeNull()
      expect(s.currentAgent).toBeNull()
    })
  })

  describe("when connect() is called with valid config", () => {
    it("sets connected to true", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      expect(state.isConnected()).toBe(true)
    })

    it("stores sessionId", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      expect(state.getSessionId()).toBe("ses_abc")
    })

    it("stores channelId", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      expect(state.getChannelId()).toBe("channel456")
    })
  })

  describe("when disconnect() is called", () => {
    it("resets to initial state", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      state.disconnect()
      expect(state.isConnected()).toBe(false)
      expect(state.getSessionId()).toBeNull()
      expect(state.getCurrentAgent()).toBeNull()
    })
  })

  describe("when multiple connect() calls", () => {
    it("last config wins", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      state.connect({ ...validConfig, sessionId: "ses_new", channelId: "new_channel" })
      expect(state.getSessionId()).toBe("ses_new")
      expect(state.getChannelId()).toBe("new_channel")
    })
  })

  describe("active session routing", () => {
    it("updates the Discord target without reconnecting", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      state.setSessionId("ses_latest")
      expect(state.getSessionId()).toBe("ses_latest")
      expect(state.isConnected()).toBe(true)
      expect(state.getChannelId()).toBe(validConfig.channelId)
    })

    it("tracks Discord-originated turns per session", () => {
      const state = createConnectionState()
      state.markDiscordTurn("ses_a")
      state.markDiscordTurn("ses_b")
      expect(state.isDiscordTurn("ses_a")).toBe(true)
      expect(state.isDiscordTurn("ses_b")).toBe(true)
      state.clearDiscordTurn("ses_a")
      expect(state.isDiscordTurn("ses_a")).toBe(false)
      expect(state.isDiscordTurn("ses_b")).toBe(true)
    })

    it("tracks injected Discord prompt texts", () => {
      const state = createConnectionState()
      state.markInjectedText("hello from discord")
      expect(state.isInjectedText("hello from discord")).toBe(true)
      expect(state.isInjectedText("typed locally")).toBe(false)
      state.clearInjectedTexts()
      expect(state.isInjectedText("hello from discord")).toBe(false)
    })
  })

  describe("agent management", () => {
    it("setCurrentAgent updates current agent", () => {
      const state = createConnectionState()
      state.setCurrentAgent("oracle")
      expect(state.getCurrentAgent()).toBe("oracle")
    })

    it("setCurrentAgent is reset on disconnect", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      state.setCurrentAgent("oracle")
      state.disconnect()
      expect(state.getCurrentAgent()).toBeNull()
    })
  })

  describe("state immutability", () => {
    it("modifying returned state does not affect internal state", () => {
      const state = createConnectionState()
      state.connect(validConfig)
      const copy = state.getState()
      ;(copy as { connected: boolean }).connected = false
      expect(state.isConnected()).toBe(true)
    })
  })

  describe("factory pattern", () => {
    it("each call returns a fresh independent instance", () => {
      const s1 = createConnectionState()
      const s2 = createConnectionState()
      s1.connect(validConfig)
      expect(s1.isConnected()).toBe(true)
      expect(s2.isConnected()).toBe(false)
    })
  })
})
