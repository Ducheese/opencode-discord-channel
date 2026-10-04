# opencode-discord-channel

An [OpenCode](https://opencode.ai) plugin that automatically bridges a configured Discord channel to the most recently used main OpenCode session. Chat with your AI coding assistant from Discord with full bidirectional messaging, interactive question prompts, and agent switching.

## Features

- **Bidirectional messaging** -- Discord messages are forwarded to your OpenCode session; AI responses are sent back to Discord.
- **Question sync** -- When OpenCode asks a question (e.g. file selection, confirmation), it appears in Discord as an interactive embed with a select menu. Pick an answer or type a custom one via modal. The question message auto-deletes after you answer.
- **Agent switching** -- Switch between agents using the `/agents` slash command in Discord. The agent selector auto-deletes after selection or when the next message arrives.
- **Automatic connection** -- The bot connects on plugin startup. The Discord target always follows the main session where you most recently sent a prompt; switching sessions does not reconnect the Discord gateway.
- **Slash commands** -- `/agents` shows the agent selector.
- **Owner-only access** -- Only messages from the configured owner ID are forwarded to the session.
- **Long message splitting** -- Responses over 2000 characters are split intelligently, preserving code block formatting.
- **Typing indicator** -- Discord shows "typing..." while the AI generates a response.
- **Persistent config** -- Bot token, owner ID, channel ID, and latest main session are saved in a config file.

## Quick Start

**1. Install the plugin**

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-discord-channel"]
}
```

**2. Configure your bot token**

Create `~/.config/opencode/discord-channel.json`:

```json
{
  "botToken": "your-bot-token-here",
  "ownerId": "your-discord-user-id"
}
```

See [Discord Bot Setup](#discord-bot-setup) below if you don't have a bot yet.

**3. Set the channel and start OpenCode**

Add `defaultChannelId` to `~/.config/opencode/discord-channel.json`. The plugin connects automatically at startup. Send a prompt in any main OpenCode session to make it the Discord target. The selected session is saved and reused after restart until another main session receives a prompt.

```json
{
  "botToken": "your-bot-token-here",
  "ownerId": "your-discord-user-id",
  "defaultChannelId": "your-discord-channel-id"
}
```

## Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application.
2. Navigate to the **Bot** section and click **Reset Token** to get your bot token.
3. Under **Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**.
4. Copy your bot token into the config file.
5. To get your Discord User ID: go to **User Settings > Advanced > Enable Developer Mode**, then right-click your username and select **Copy User ID**.
6. Invite the bot to your server using the OAuth2 URL generator with these permissions: **Send Messages**, **Read Message History**, **View Channels**, **Use Application Commands**.

## Configuration

### Config File (Recommended)

`~/.config/opencode/discord-channel.json`:

```json
{
  "botToken": "your-bot-token-here",
  "ownerId": "your-discord-user-id",
  "defaultChannelId": "your-discord-channel-id"
}
```

### Environment Variables

```bash
export DISCORD_BOT_TOKEN="your-bot-token-here"
export DISCORD_OWNER_ID="your-discord-user-id"
```

Environment variables take priority over the config file.

The selected main session, its last-message timestamp, and working directory are stored as `activeSessionId`, `activeSessionAt`, and `activeSessionDirectory` in the same config file.

## Commands

### Discord Slash Commands

| Command | Description |
|---|---|
| `/agents` | Show agent selector dropdown. |

`/agents` is registered as a guild command when the bot connects.

## How It Works

1. The plugin connects to the configured Discord channel at startup.
2. A prompt you send in an OpenCode main session makes that session the current Discord target.
3. Mention the bot in the connected Discord channel; the plugin forwards the message to the current target session.
4. OpenCode processes it and generates a response, which is sent back to Discord, split across multiple messages if needed.
5. If OpenCode asks a question (file picker, confirmation, etc.), it appears as an interactive embed in Discord.
6. You answer via select menu or type a custom response. The question cleans up after itself.

If no target session has been saved yet, the bot connects but ignores incoming chat until you send a prompt in an OpenCode main session. Subagent sessions never change the target.

## Architecture

| Module | Responsibility |
|---|---|
| `index.ts` | Plugin entry point. Connects the bot at startup, tracks the latest main session, and wires question replies and agent switching. |
| `bridge-inbound.ts` | Discord to OpenCode. Processes messages, select menu interactions, button clicks, and modal submissions. |
| `bridge-outbound.ts` | OpenCode to Discord. Handles events (message updates, session idle, questions, typing status). |
| `discord-client.ts` | Discord.js wrapper. Manages connection, message sending, interaction handlers, and slash command registration. |
| `question-display.ts` | Renders OpenCode questions as Discord embeds with select menus, custom answer buttons, and modals. |
| `agent-display.ts` | Renders agent selector as Discord embed with select menu. Filters out internal agents. |
| `state.ts` | Connection state, Discord target session, turn and injected-text tracking, pending questions, and agent menu message tracking. |
| `config.ts` | Config file read/write (`~/.config/opencode/discord-channel.json`). |
| `system-prompt.ts` | Injects Discord formatting instructions into the system prompt. |
| `message-splitter.ts` | Splits long messages at code block and paragraph boundaries. |
| `types.ts` | Shared TypeScript type definitions. |

## Security

- Only messages from the configured owner ID are processed. All other messages are ignored.
- The bot token is never logged or included in error messages.
- The bridge connects to a single channel at a time.
- Config is stored in the user's home directory with standard file permissions.

## Development

```bash
git clone https://github.com/CTHua/opencode-discord-channel.git
cd opencode-discord-channel
pnpm install
pnpm test
pnpm run build   # outputs to dist/
```

Requires [Bun](https://bun.sh) for building and testing.

## License

MIT
