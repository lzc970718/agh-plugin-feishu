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
