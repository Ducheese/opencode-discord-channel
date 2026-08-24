import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ModalBuilder,
  TextInputBuilder,
} from "@discordjs/builders"
import { ButtonStyle, TextInputStyle } from "discord-api-types/v10"
import type { QuestionInfo } from "./types"

const QUESTION_SELECT_PREFIX = "q_select_"
const QUESTION_CUSTOM_PREFIX = "q_custom_"
const QUESTION_MODAL_PREFIX = "q_modal_"
const QUESTION_INPUT_PREFIX = "q_input_"
const MAX_SELECT_OPTIONS = 25
const QUESTION_EMBED_COLOR = 0x5865f2

export function buildQuestionEmbed(
  question: QuestionInfo,
  questionIndex: number,
  totalQuestions: number,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(QUESTION_EMBED_COLOR)
    .setDescription(question.question)

  const title =
    totalQuestions > 1
      ? `${question.header} (${questionIndex + 1}/${totalQuestions})`
      : question.header
  embed.setTitle(title)

  return embed
}

export function buildQuestionComponents(
  question: QuestionInfo,
  requestID: string,
  questionIndex: number,
): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = []

  if (question.options.length > 0) {
    const capped = question.options.slice(0, MAX_SELECT_OPTIONS)
    const options = capped.map((opt) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(opt.label)
        .setValue(opt.label)
        .setDescription(opt.description.slice(0, 100)),
    )

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`${QUESTION_SELECT_PREFIX}${requestID}_${questionIndex}`)
      .setPlaceholder("Select an answer...")
      .addOptions(options)

    if (question.multiple) {
      selectMenu.setMinValues(1)
      selectMenu.setMaxValues(capped.length)
    }

    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
    )
  }

  const showCustom = question.custom !== false
  if (showCustom) {
    const customButton = new ButtonBuilder()
      .setCustomId(`${QUESTION_CUSTOM_PREFIX}${requestID}_${questionIndex}`)
      .setLabel("Type your own answer")
      .setStyle(ButtonStyle.Secondary)

    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(customButton),
    )
  }

  return rows
}

export function buildCustomAnswerModal(
  requestID: string,
  questionIndex: number,
  header: string,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${QUESTION_MODAL_PREFIX}${requestID}_${questionIndex}`)
    .setTitle(header.slice(0, 45))

  const textInput = new TextInputBuilder()
    .setCustomId(`${QUESTION_INPUT_PREFIX}${requestID}_${questionIndex}`)
    .setLabel("Your answer")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(textInput),
  )

  return modal
}

export function parseQuestionInteraction(customId: string): {
  type: "select" | "custom" | "modal"
  requestID: string
  questionIndex: number
} | null {
  for (const [prefix, type] of [
    [QUESTION_SELECT_PREFIX, "select"],
    [QUESTION_CUSTOM_PREFIX, "custom"],
    [QUESTION_MODAL_PREFIX, "modal"],
  ] as const) {
    if (!customId.startsWith(prefix)) continue
    const rest = customId.slice(prefix.length)
    const lastUnderscore = rest.lastIndexOf("_")
    if (lastUnderscore === -1) return null
    const requestID = rest.slice(0, lastUnderscore)
    const questionIndex = parseInt(rest.slice(lastUnderscore + 1), 10)
    if (isNaN(questionIndex)) return null
    return { type, requestID, questionIndex }
  }
  return null
}
