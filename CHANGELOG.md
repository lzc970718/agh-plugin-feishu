# Changelog

## Unreleased

- Convert card callback timestamps from Feishu's microseconds to milliseconds before reporting the click time.
- Preserve line breaks and tabs in incoming text messages instead of silently rejecting multiline prompts; identifier validation remains strict.

- Quoted replies: the quoted message id (`parent_id`) is reported as `quotedMessageId`.
- Markdown: text is sent as a `post` message with one `md` element instead of plain text.
- Cards: card blocks are sent as interactive cards with buttons; clicks arrive as `card.action.trigger` over the long connection and are reported as card actions. Bound-session slot cards route through `onSlotAction`.
- Declares `card` capability and the `cardAction` event; requires Extension API ^5.13.0. The Feishu app must enable the card callback with long-connection delivery.

## 0.1.3 — 2026-11-09

- Prepare the independent Feishu channel for Git-based AGH marketplace installation.
- Provide English/Chinese package metadata, repository links, keywords and explicit AGH/Extension API requirements.
- Commit the complete portable runtime and local icon with third-party notices.
- Keep generated SDK type mappings out of tracked files; installation requires no local AGH source tree.
- Preserve existing transport, credential, binding and attachment behavior.
