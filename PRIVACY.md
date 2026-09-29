# HandHistory Bot: Privacy Policy

_Last updated: 29 September 2026_

This policy explains what information the HandHistory Discord bot ("the bot", "we") handles, why, and what happens to it. The bot is operated by the GitHub user [absolutetanka](https://github.com/absolutetanka). Its source code is public in this repository, so you can check exactly what it does.

## Summary

- The bot reads hand descriptions only in channels a server admin has chosen, and when you use `/hand`.
- Your hand text and audio are sent to AI services to be turned into a hand history. **The bot itself does not save them.**
- The bot saves only which channels each server has set up, and who set them up.
- Removing the bot from a server deletes that server's settings.

## What the bot processes

**Hand descriptions and audio.** When you post in a watched channel, or use `/hand`, the bot reads:
- the text of your message or the `description` you typed, and
- any voice note or audio file attached.

It only reads messages in channels a server admin added with `/setup add`, or that the operator configured. It does not read other channels.

**Discord identifiers.** To work, the bot uses Discord IDs: your user ID, the server ID, the channel ID and the message ID.

## What is sent to third parties

To turn your description into a hand history, the bot sends content to these services:

| Service | What is sent | Why |
| --- | --- | --- |
| [OpenRouter](https://openrouter.ai/privacy) and the AI model provider it routes to | Your hand text, or the transcript of your audio | To structure the hand |
| [Groq](https://groq.com/privacy-policy/) | Your voice note or audio file | To transcribe speech to text |
| [Discord](https://discord.com/privacy) | The bot's replies | To post the formatted hand |
| [Railway](https://railway.com/legal/privacy) | Hosting only; see "Logs" below | To run the bot |

**Important:** the bot uses free AI models through OpenRouter. Some free model providers may log prompts or use them to improve their models, under their own policies. **Don't include personal information** (real names, contact details, account details) in hand descriptions.

Your Discord user ID and username are **not** sent to these AI services.

## What the bot stores

**Server settings (kept until removed).** In its database, the bot stores:
- the server ID and the IDs of the channels it watches, and
- the user ID of the admin who added each channel, and when.

These are deleted when an admin runs `/setup remove`, or automatically when the bot is removed from the server.

**Rate limiting (temporary).** To stop any one user or server using up the shared AI quota, the bot keeps a count of recent requests, by user ID and server ID. This is kept in memory only, is never written to disk, and is cleared whenever the bot restarts.

**Logs.** The hosting platform keeps operational logs, such as when the bot started, errors, and message, server or interaction IDs of processed hands. Hand text is not written to these logs in normal operation. Error logs may occasionally include fragments of a failed AI response. Logs are kept according to the hosting provider's retention policy.

**Not stored:** the bot does not keep your hand text, audio, transcripts or formatted results. Once the reply is posted, the bot's copy is discarded. The reply itself stays in Discord like any other message, until someone deletes it.

## Your choices

- **Don't want your hands processed?** Don't post in watched channels and don't use `/hand`.
- **Server admins** can stop the bot watching a channel with `/setup remove`, or remove the bot from the server. Either deletes the related settings.
- **Deletion requests:** to ask about or delete any data linked to you, open an issue at <https://github.com/absolutetanka/poker-hand-history-bot/issues>. Don't include personal details in a public issue; say you'd like to be contacted privately.

## Children

The bot is for Discord users who meet [Discord's minimum age](https://discord.com/terms). Poker content may be restricted where you live; follow your local laws.

## Changes

If this policy changes, the updated version will be published here with a new "Last updated" date. Continuing to use the bot after a change means you accept the updated policy.

## Contact

Questions: <https://github.com/absolutetanka/poker-hand-history-bot/issues>
