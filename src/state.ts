import type {
  BridgeConfig,
  ConnectionState,
  PendingQuestion,
  QuestionAnswer,
} from "./types"

export function createConnectionState() {
  let state: ConnectionState = {
    connected: false,
    sessionId: null,
    channelId: null,
    ownerId: null,
    botUserId: null,
    currentAgent: null,
  }

  const pendingQuestions = new Map<string, PendingQuestion>()
  const questionMessageIds = new Map<string, string[]>()
  const discordTurnSessions = new Set<string>()
  const injectedTexts = new Set<string>()
  let agentMenuMessageId: string | null = null

  return {
    connect(config: BridgeConfig): void {
      state = {
        connected: true,
        sessionId: config.sessionId ?? null,
        channelId: config.channelId,
        ownerId: config.ownerId,
        botUserId: null,
        currentAgent: null,
      }
    },

    disconnect(): void {
      state = {
        connected: false,
        sessionId: null,
        channelId: null,
        ownerId: null,
        botUserId: null,
        currentAgent: null,
      }
      pendingQuestions.clear()
      questionMessageIds.clear()
      discordTurnSessions.clear()
      injectedTexts.clear()
      agentMenuMessageId = null
    },

    setBotUserId(id: string): void {
      state = { ...state, botUserId: id }
    },

    setSessionId(id: string | null): void {
      state = { ...state, sessionId: id }
    },

    markDiscordTurn(id: string): void {
      if (discordTurnSessions.has(id)) return
      if (discordTurnSessions.size >= 128) {
        const oldest = discordTurnSessions.values().next().value
        if (oldest) discordTurnSessions.delete(oldest)
      }
      discordTurnSessions.add(id)
    },

    isDiscordTurn(id: string): boolean {
      return discordTurnSessions.has(id)
    },

    clearDiscordTurn(id: string): void {
      discordTurnSessions.delete(id)
    },

    markInjectedText(text: string): void {
      if (injectedTexts.size >= 256) {
        const oldest = injectedTexts.values().next().value
        if (oldest) injectedTexts.delete(oldest)
      }
      injectedTexts.add(text)
    },

    isInjectedText(text: string): boolean {
      return injectedTexts.has(text)
    },

    clearInjectedTexts(): void {
      injectedTexts.clear()
    },

    setCurrentAgent(name: string): void {
      state = { ...state, currentAgent: name }
    },

    getState(): Readonly<ConnectionState> {
      return { ...state }
    },

    isConnected(): boolean {
      return state.connected
    },

    getSessionId(): string | null {
      return state.sessionId
    },

    getChannelId(): string | null {
      return state.channelId
    },

    getOwnerId(): string | null {
      return state.ownerId
    },

    getBotUserId(): string | null {
      return state.botUserId
    },

    getCurrentAgent(): string | null {
      return state.currentAgent
    },

    addPendingQuestion(
      requestID: string,
      sessionID: string,
      totalQuestions: number,
    ): void {
      pendingQuestions.set(requestID, {
        requestID,
        sessionID,
        totalQuestions,
        answers: Array.from({ length: totalQuestions }, () => null),
      })
    },

    setQuestionAnswer(
      requestID: string,
      questionIndex: number,
      answer: QuestionAnswer,
    ): PendingQuestion | null {
      const pending = pendingQuestions.get(requestID)
      if (!pending) return null
      if (questionIndex < 0 || questionIndex >= pending.totalQuestions)
        return null
      pending.answers[questionIndex] = answer
      return pending
    },

    getPendingQuestion(requestID: string): PendingQuestion | null {
      return pendingQuestions.get(requestID) ?? null
    },

    removePendingQuestion(requestID: string): void {
      pendingQuestions.delete(requestID)
      questionMessageIds.delete(requestID)
    },

    addQuestionMessageId(requestID: string, messageId: string): void {
      const ids = questionMessageIds.get(requestID) ?? []
      ids.push(messageId)
      questionMessageIds.set(requestID, ids)
    },

    getQuestionMessageIds(requestID: string): string[] {
      return questionMessageIds.get(requestID) ?? []
    },

    isQuestionComplete(requestID: string): boolean {
      const pending = pendingQuestions.get(requestID)
      if (!pending) return false
      return pending.answers.every((a) => a !== null)
    },

    setAgentMenuMessageId(id: string): void {
      agentMenuMessageId = id
    },

    getAgentMenuMessageId(): string | null {
      return agentMenuMessageId
    },

    clearAgentMenuMessageId(): void {
      agentMenuMessageId = null
    },
  }
}

export type ConnectionStateManager = ReturnType<typeof createConnectionState>
