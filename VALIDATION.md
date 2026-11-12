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

## Multiline inbound text regression (2026-11-12)

Incoming text reused the identifier validator, which rejected LF, CR and tabs. The adapter then logged an invalid inbound event and emitted nothing, even though the SDK had acknowledged the callback. Text now permits LF, CR and tabs while retaining the nonempty/60000-character limit and rejecting other C0 controls and DEL. Identity fields retain their existing strict validator.

Verified on macOS with Node v24.20.0 and pnpm 10.34.5 through the Harness toolchain entry, in an isolated plugin checkout:

- Before the fix: three normalization cases (LF, CRLF, tab) failed with `Invalid Feishu field`; the adapter regression delivered no event for a multiline `ask_owner` prompt.
- `exec vitest run --maxWorkers=1`: all 3 files / 62 tests passed after the fix, including malformed text and identity rejection.
- `run build`: passed; the rebuilt portable runtime differs only in text validation and contains no temporary diagnostics.
- `run typecheck`: blocked by existing local SDK declaration mismatches (`ChannelProvider`, `registerChannel` and related exports). Repeating with the original source/tests produced the same errors; this is not a passing typecheck.

A subsequent real Feishu DM test passed. The multiline prompt created a task, `ask_owner` sent the two-choice card, and clicking the second option resumed and completed the same task. The reply delivery record reported success. Quoted replies and broader platform acceptance remain separate checks.

## Card callback timestamp regression (2026-11-12)

Feishu specifies `card.action.trigger` header `create_time` in microseconds. See the [button callback example](https://open.larkenterprise.com/document/feishu-cards/card-json-v2-components/interactive-components/button). The adapter had passed it to JavaScript `Date` as milliseconds, producing a far-future click time. It now converts card callback times to milliseconds; message timestamps continue to use milliseconds.

On macOS with Node v24.20.0 and pnpm 10.34.5 through the Harness toolchain entry, the isolated checkout reproduced the incorrect `+058834-03-31T10:21:46.375Z` for `1794462286906375`. After the fix, SDK-flattened and nested callbacks both yield `2026-11-12T05:44:46.906Z`; invalid and missing times retain the current-time fallback. All 3 test files / 67 tests passed and the standalone runtime build passed. The existing local SDK declaration mismatch still prevents a passing typecheck as recorded above.

A synthetic replay through the built provider adapter, with only the network gateway replaced, confirmed both callback shapes and ordinary message milliseconds on the emitted events. This replay does not connect to Feishu.

The rebuilt plugin was installed locally and reported running. The channel reconnected with its pairing retained, and the companion health check passed. A new real button click after this timestamp fix remains unverified. Existing persisted timestamps were not migrated.

## Native interaction cards (unreleased)

Synthetic local tests cover bounded form callbacks, source identity, native single/multi/text fields, approval choices, shared-card PATCH, post PUT, and API failures. The host remains responsible for authorization, message references, replay and current state. Cards are sent with `update_multi: true`; Feishu limits card updates to 14 days and requires the sending application identity. Text edits have a maximum of 20 edits and an administrator-controlled time window. `reject_always` has no distinct channel verdict and is not presented as a persistent denial.

The source build and tests use Node v24.20.0 and pnpm 10.34.5. All 73 tests across three files pass. The standard `prepareSdk` command resolves declarations built from the modified AGH source checkout, and typecheck passes against those declarations. Real Feishu/Lark tenant, native form rendering, callbacks, approval decisions and cross-client card updates remain to be verified for this change. Earlier live observations above do not verify this change.

Official references: [form container](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/form-container), [update sent card](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/patch), and [edit message](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/update).

Callback `{}` acknowledges transport after volatile queue admission, not backend acceptance. A crash before acceptance requires user retry. Closed card state follows backend success, not this acknowledgment. Native text and custom fields are capped at 1,000 characters, with the authenticated AGH fallback shown for longer answers.

## Native selector rejection repair (2026-11-12)

After the authorized AGH runtime update restored managed watches, the existing unanswered task reached
the real Feishu create-message endpoint. PID-isolated stages showed HTTP 400 and API 230099; the
sanitized parser response mentioned `select_static`, `label`, and card parsing. This is live evidence,
unlike the earlier discarded mock API-999 log.

The official JSON 2.0 [single-selector](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/single-select-dropdown-menu)
and [multi-selector](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/interactive-components/multi-select-dropdown-menu)
schemas support `placeholder`, not the input component's `label`. Selectors now use that supported field;
text/free-text inputs retain their labels, bindings and callbacks.

Through the pinned Harness entry on macOS/Node v24.20.0/pnpm 10.34.5: 3 files / 73 tests passed,
including selector-schema and callback regressions; plugin typecheck and standalone build passed.
Temporary adapter/gateway file diagnostics and their helper were removed before this clean build.
Real card delivery references and remaining user-operated callback acceptance are recorded in the
deployment execution record; deterministic tests alone do not certify client interaction.
