import type { PluginInput } from "@opencode-ai/plugin"
import type { Part } from "@opencode-ai/sdk"

export type { PluginInput }

// The SDK's Hooks use Part[] (output format with required id/sessionID/messageID)
// but plugins construct TextPartInput (input format with optional fields).
// This helper centralizes the unavoidable cast at the SDK type boundary.
export function textPart(text: string): Part {
  return { type: "text", text } as unknown as Part
}

export interface ConnectionState {
  connected: boolean
  sessionId: string | null
  channelId: string | null
  ownerId: string | null
  botUserId: string | null
  currentAgent: string | null
}

export interface BridgeConfig {
  botToken: string
  ownerId: string
  channelId: string
  sessionId?: string | null
}

export interface DiscordMessage {
  content: string
  authorId: string
  username: string
  channelId: string
  messageId: string
}

export interface AgentInfo {
  name: string
  mode: "primary" | "subagent" | "all"
  color?: string
  description?: string
}

// Question types — mirrors @opencode-ai/sdk/v2 QuestionRequest
// Defined locally to avoid hard v2 dependency in the plugin type surface.

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionInfo {
  question: string
  header: string
  options: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export interface QuestionRequest {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  tool?: {
    messageID: string
    callID: string
  }
}

export type QuestionAnswer = string[]

export interface PendingQuestion {
  requestID: string
  sessionID: string
  totalQuestions: number
  answers: (QuestionAnswer | null)[]
}
