# Validation and acceptance

This file distinguishes deterministic verification from live platform evidence. No real Feishu/Lark credential is embedded or required for unit tests.

## Deterministic checks

- Public ChannelProvider validation and registerChannel(empty instances).
- Object/string event content, p2p/group identity, exact bot mentions, media and rich text.
- Actual PNG/file bytes, partial media failure, no synthetic attachment:// references.
- Instance isolation, retired callbacks, cancellation, request draining and credential replacement.
- Stable segmented send uuid, unconfirmed target refusal and unsupported editing refusal.
- Fixed Feishu/Lark API origins, encoded path segments, redirect refusal, byte caps, token lifecycle, connect cancellation and redacted errors.

Final command results and package smoke evidence are appended after execution.

## Deployment acceptance still required

Use an actual published enterprise self-built application. Verify bot enablement, visibility and scopes; connect with the official long connection; send a DM, group @ and no-mention message; confirm/bind the observed target through AGH; test incoming PNG/JPEG, post images, PDF/document, voice/video and partial failure; check new AGH user text and assistant output; disconnect/reconnect and sleep/wake; change credentials; move/unbind; uninstall/reinstall with an empty instance list. Test platform rate limits and uncertain sends without claiming indefinite API deduplication. Native approvals stay in AGH.

This development machine is Windows x64. macOS/Linux portability is a code/property assessment, not a live test. Real Feishu and international Lark accounts and their resource endpoints are not certified by fake gateway tests or offline package installation.

## Executed on 2026-11-06

Runtime: Node v24.20.0, pnpm 10.34.5 through the Harness pinned toolchain entry.

- prepareSdk and typecheck: passed. Portable source tsconfig has no machine-specific paths; generated SDK path mappings live in ignored tsconfig.local.json.
- npm test: 3 files, 32 tests passed, covering event normalization, adapter behavior, HTTP boundaries, official SDK callback admission, cached-token cancellation and constructor-failure deadline cleanup.
- npm run build: passed. Direct ESM import of the built artifact passed after adding CommonJS require/filename/dirname compatibility for the official SDK and its dependencies.
- Built Feishu converter to native Core attachment admission with in-memory test storage: three originals (PNG, video and document) were saved and read back byte-for-byte; pending receipts zero; no dangling attachment:// references.
- Final tgz installed through actual AGH CLI in an isolated temporary home alongside DingTalk; native channels.catalog reported Feishu with bindingAvailable=true and required appId/appSecret credentials. Headless Chrome confirmed both dynamic channel entries, the Feishu configuration dialog, session-derived context and grouped overview. The owned test daemon/browser were disposed.
- Tarball audit: runtime JS, build metadata, README, validation/provenance and licenses only; no node_modules, SDK links, tsconfig paths, Windows binaries, native .node modules, generic AGH runner or SDK discovery implementation.

These checks do not certify a real Feishu/Lark tenant, app permissions, actual media resource endpoints, model understanding or macOS/Linux execution. The deployment checklist above remains open. Event admission uses a bounded volatile queue; a process crash can lose acknowledged work not yet imported into AGH.

## Marketplace release 0.1.3 (2026-11-09)

- Executed on Node v24.20.0 with the AGH repository toolchain entry.
- prepareSdk, typecheck, tests and the independent runtime build passed.
- Unit tests: 32 passed. Legacy 5.7 error-message assertions in DingTalk/Feishu were aligned with the existing 5.8 implementation requirement.
- Release files are explicitly staged; generated SDK paths, node_modules, backup directories, local logs and prior archives are excluded.
- This release changes distribution metadata, portable development configuration, documentation and version stamps; it does not add platform capabilities or establish new live-account/macOS/Linux acceptance.

## Quoted replies, Markdown and cards (unreleased)

Deterministic checks added (fake gateway, no credential):

- `parent_id` becomes `quotedMessageId`; absent or malformed ids are omitted.
- Text is sent as `msg_type: post` with a single `md` element and keeps the per-part `uuid`.
- Card blocks are sent as `msg_type: interactive` schema 2.0 cards; each button callback value is `{ id, t, c }` with `c` the chat the card was sent to (`slot:<requestSeq>:<id>` for bound-session slot cards). Cards above `cardBytes` are refused.
- `card.action.trigger` (SDK-flattened and nested shapes) becomes a `cardAction` event with `cardBizId` equal to the card's message id; a click is accepted only when `c` equals the clicked chat (a forwarded card, a value without `c` and a bare-string value are dropped with a warning, so a card never answers another chat's request); the chat is confirmed, with the observed chat type, else `t` for a chat the plugin has not seen; the long-connection callback is answered with `{}` and the card is not changed.
- `onSlotAction` parses `slot:<requestSeq>:<actionId>`. Approval and table blocks keep their previous text rendering now that the platform no longer degrades them.

Real-tenant checks still open:

- Enable the card callback for the app in the Feishu/Lark developer console with long-connection delivery, and publish the app version. Without it clicks never arrive.
- Confirm a post `md` message renders bold, lists, code and links in a DM and a group, and that quoted-reply `parent_id` arrives for p2p and group messages.
- Confirm a schema 2.0 card with a header-less layout and callback buttons renders, that a click reaches AGH, and that the `{}` reply shows no error toast and leaves the card unchanged.
- Confirm the callback `context.open_message_id` equals the `message_id` returned by the send call, and check click behavior after a reconnect and after clicking an already-answered card.
- Check the 30000-byte card limit and rate limits with real traffic.
