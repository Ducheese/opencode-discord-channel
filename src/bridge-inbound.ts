import { parseSelectInteraction } from "./agent-display"
import {
  parseQuestionInteraction,
  buildCustomAnswerModal,
} from "./question-display"
import type { DiscordClientWrapper } from "./discord-client"
import type { ConnectionStateManager } from "./state"
import type { QuestionAnswer, QuestionInfo } from "./types"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const logFile = path.join(os.tmpdir(), "opencode-discord-channel.log")
function log(msg: string) {
  try {
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`)
  } catch {}
}

type SessionPromptFn = (params: {
  sessionID: string
  parts: Array<{ type: string; text: string }>
  agent?: string
}) => Promise<void>

type QuestionReplyFn = (
  requestID: string,
  answers: QuestionAnswer[],
) => Promise<void>

type InboundBridgeDeps = {
  discordClient: Pick<
    DiscordClientWrapper,
    | "onMessage"
    | "onButtonInteraction"
    | "onSelectMenuInteraction"
    | "onRawButtonInteraction"
    | "onModalSubmit"
    | "deleteMessage"
  >
  state: Pick<
    ConnectionStateManager,
    | "isConnected"
    | "getSessionId"
    | "getChannelId"
    | "getOwnerId"
    | "getBotUserId"
    | "getCurrentAgent"
    | "setQuestionAnswer"
    | "isQuestionComplete"
    | "getPendingQuestion"
    | "removePendingQuestion"
    | "getQuestionMessageIds"
    | "getAgentMenuMessageId"
    | "clearAgentMenuMessageId"
  >
  sessionPrompt: SessionPromptFn
  onAgentSwitch: (agentName: string) => void
  onQuestionReply: QuestionReplyFn
  getQuestionInfo: (
    requestID: string,
    questionIndex: number,
  ) => QuestionInfo | null
  onShowAgents: () => Promise<void>
}

export function createInboundBridge(deps: InboundBridgeDeps): void {
  const {
    discordClient,
    state,
    sessionPrompt,
    onAgentSwitch,
    onQuestionReply,
    getQuestionInfo,
    onShowAgents,
  } = deps

  log("[init] inbound bridge created")

  async function tryCompleteQuestion(requestID: string): Promise<void> {
    if (!state.isQuestionComplete(requestID)) return
    const pending = state.getPendingQuestion(requestID)
    if (!pending) return

    const answers = pending.answers.filter(
      (a): a is QuestionAnswer => a !== null,
    )
    log(`[question] completing requestID=${requestID} answers=${JSON.stringify(answers)}`)

    try {
      await onQuestionReply(requestID, answers)
      log(`[question] reply success requestID=${requestID}`)
    } catch (err) {
      log(`[question] reply FAILED requestID=${requestID}: ${err}`)
    }

    const channelId = state.getChannelId()
    if (channelId) {
      for (const msgId of state.getQuestionMessageIds(requestID)) {
        discordClient
          .deleteMessage(channelId, msgId)
          .catch((err) =>
            log(`[question] delete msg failed: ${err}`),
          )
      }
    }

    state.removePendingQuestion(requestID)
  }

  discordClient.onMessage(async (msg) => {
    log(
      `[msg] from=${msg.authorId} (${msg.username}) channel=${msg.channelId} content="${msg.content.slice(0, 50)}"`,
    )
    log(
      `[state] connected=${state.isConnected()} channelId=${state.getChannelId()} ownerId=${state.getOwnerId()} botUserId=${state.getBotUserId()}`,
    )

    if (!state.isConnected()) {
      log("[filter] not connected")
      return
    }
    if (msg.channelId !== state.getChannelId()) {
      log(`[filter] wrong channel: ${msg.channelId} !== ${state.getChannelId()}`)
      return
    }
    if (msg.authorId === state.getBotUserId()) {
      log("[filter] bot self-message")
      return
    }
    if (msg.authorId !== state.getOwnerId()) {
      log(`[filter] not owner: ${msg.authorId} !== ${state.getOwnerId()}`)
      return
    }

    const sessionId = state.getSessionId()
    if (!sessionId) {
      log("[filter] no sessionId")
      return
    }

    if (msg.content.trim() === "/dc:agents") {
      log("[cmd] /dc:agents from Discord")
      await onShowAgents().catch((err) =>
        log(`[cmd] /dc:agents failed: ${err}`),
      )
      return
    }

    const formattedText = msg.content

    const currentAgent = state.getCurrentAgent()
    const params: Parameters<SessionPromptFn>[0] = {
      sessionID: sessionId,
      parts: [{ type: "text", text: formattedText }],
    }

    if (currentAgent) {
      params.agent = currentAgent
    }

    log(
      `[prompt] sessionID=${sessionId} agent=${currentAgent ?? "default"} text="${formattedText.slice(0, 80)}"`,
    )

    try {
      await sessionPrompt(params)
      log("[prompt] success")
    } catch (err) {
      log(`[prompt] FAILED: ${err}`)
    }
  })

  discordClient.onSelectMenuInteraction(async (customId, values, userId) => {
    if (!state.isConnected()) return
    if (userId !== state.getOwnerId()) return

    const questionParsed = parseQuestionInteraction(customId)
    if (questionParsed?.type === "select") {
      log(`[question] select requestID=${questionParsed.requestID} idx=${questionParsed.questionIndex} values=${JSON.stringify(values)}`)
      state.setQuestionAnswer(
        questionParsed.requestID,
        questionParsed.questionIndex,
        values,
      )
      await tryCompleteQuestion(questionParsed.requestID)
      return
    }

    const agentName = parseSelectInteraction(customId, values)
    if (!agentName) return

    log(`[select-menu] agent switch to: ${agentName}`)

    const channelId = state.getChannelId()
    const menuMsgId = state.getAgentMenuMessageId()
    if (channelId && menuMsgId) {
      state.clearAgentMenuMessageId()
      discordClient
        .deleteMessage(channelId, menuMsgId)
        .catch((err) => log(`[select-menu] delete menu failed: ${err}`))
    }

    onAgentSwitch(agentName)
  })

  discordClient.onRawButtonInteraction(async (interaction: any) => {
    if (!state.isConnected()) return false
    if (interaction.user.id !== state.getOwnerId()) return false

    const parsed = parseQuestionInteraction(interaction.customId)
    if (parsed?.type !== "custom") return false

    const questionInfo = getQuestionInfo(parsed.requestID, parsed.questionIndex)
    const header = questionInfo?.header ?? "Answer"

    const modal = buildCustomAnswerModal(
      parsed.requestID,
      parsed.questionIndex,
      header,
    )

    try {
      await interaction.showModal(modal)
    } catch (err) {
      log(`[question] showModal failed: ${err}`)
    }
    return true
  })

  discordClient.onModalSubmit((customId, fields, userId) => {
    if (!state.isConnected()) return
    if (userId !== state.getOwnerId()) return

    const parsed = parseQuestionInteraction(customId)
    if (parsed?.type !== "modal") return

    const inputKey = `q_input_${parsed.requestID}_${parsed.questionIndex}`
    const value = fields.get(inputKey)
    if (!value) return

    log(`[question] modal answer requestID=${parsed.requestID} idx=${parsed.questionIndex} value="${value.slice(0, 50)}"`)
    state.setQuestionAnswer(parsed.requestID, parsed.questionIndex, [value])
    tryCompleteQuestion(parsed.requestID)
  })
}
