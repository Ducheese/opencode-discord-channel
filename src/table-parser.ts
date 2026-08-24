import { EmbedBuilder } from "@discordjs/builders"

const SEPARATOR_PATTERN = /^\|?\s*[-:]+[-| :]*$/
const TABLE_EMBED_COLOR = 0x2b2d31

type ParsedSegment =
  | { type: "text"; content: string }
  | { type: "table"; embed: EmbedBuilder }

export function parseContentWithTables(text: string): ParsedSegment[] {
  const lines = text.split("\n")
  const segments: ParsedSegment[] = []
  let textLines: string[] = []

  let i = 0
  while (i < lines.length) {
    if (
      i + 2 < lines.length &&
      isTableRow(lines[i]) &&
      SEPARATOR_PATTERN.test(lines[i + 1].trim()) &&
      isTableRow(lines[i + 2])
    ) {
      if (textLines.length > 0) {
        segments.push({ type: "text", content: textLines.join("\n") })
        textLines = []
      }

      const headers = parseCells(lines[i])
      i += 2

      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseCells(lines[i]))
        i++
      }

      const embed = buildTableEmbed(headers, rows)
      if (embed) {
        segments.push({ type: "table", embed })
      }
    } else {
      textLines.push(lines[i])
      i++
    }
  }

  if (textLines.length > 0) {
    const remaining = textLines.join("\n").trim()
    if (remaining.length > 0) {
      segments.push({ type: "text", content: remaining })
    }
  }

  return segments
}

export function hasTable(text: string): boolean {
  return parseContentWithTables(text).some((s) => s.type === "table")
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.includes("|") && !SEPARATOR_PATTERN.test(trimmed)
}

function parseCells(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1)
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1)
  return trimmed.split("|").map((c) => c.trim())
}

const MAX_EMBED_FIELDS = 25

function buildTableEmbed(
  headers: string[],
  rows: string[][],
): EmbedBuilder | null {
  if (headers.length === 0 || rows.length === 0) return null

  const embed = new EmbedBuilder().setColor(TABLE_EMBED_COLOR)

  if (headers.length === 2) {
    const fields = rows.slice(0, MAX_EMBED_FIELDS).map((row) => ({
      name: row[0] || "\u200b",
      value: row[1] || "\u200b",
      inline: false,
    }))
    embed.addFields(fields)
  } else {
    const fields = rows.slice(0, MAX_EMBED_FIELDS).map((row) => {
      const pairs = headers
        .map((h, idx) => `**${h}**: ${row[idx] || "-"}`)
        .join("\n")
      return {
        name: row[0] || "\u200b",
        value: pairs,
        inline: rows.length <= 6,
      }
    })
    embed.addFields(fields)
  }

  return embed
}
