# Provenance

Independent Apache-2.0 Feishu platform adapter authored against AGH Extension API 5.7.0, 2026-11-06. It consumes the public @agnes/plugin-runtime/channel-contract and @agnes/protocol exports. No generic channel runner, daemon discovery, credentials-file reader or private Host implementation is copied or shipped.

Official transport dependency: @larksuiteoapi/node-sdk 1.76.0, pinned in package-lock.json. Runtime NOTICE is generated from esbuild's actual dependency graph and preserves package license texts. Build-only tools and SDK development links are excluded from the tarball.

Primary references used for implementation:
- Official Node SDK source and documentation: https://github.com/larksuite/node-sdk
- Event handling and WSClient: https://open.feishu.cn/document/server-side-sdk/nodejs-sdk/handling-events
- Incoming message event: https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
- Message sending: https://open.feishu.cn/document/server-docs/im-v1/message/create
- Message-resource download: https://open.feishu.cn/document/server-docs/im-v1/message-resource/get
- Bot metadata: https://open.feishu.cn/document/client-docs/bot-v3/obtain-bot-info
- WSClient cancellation and handshake cleanup fixes: https://github.com/larksuite/node-sdk/issues/197

The implementation uses the SDK's public onReady/onError/reconnect callbacks, close({force:true}), handshake timeout and ping watchdog. Platform HTTP/media calls are explicit fixed-origin requests with cancellation, response budgets, redirect refusal and masked errors. Reference documentation is not proof of live tenant acceptance; see VALIDATION.md.

Bundle compatibility: the generated ESM entry provides Node createRequire, __filename and __dirname for dependencies that retain CommonJS assumptions. No upstream SDK source file is modified. The SDK may report its own supported version fallback when its original package directory is not shipped; exact dependency version is recorded in build-info.json and the lockfile.

## Feishu icon

User-provided brand image downloaded and stored as `assets/feishu.png` on 2026-11-06. Source: https://p2.qhimg.com/dm/72_72_100/t11eec6e52f751fdb17b9141be4.png . Brand rights remain with their respective owner. The original PNG is packaged locally and embedded as a data URI in the channel manifest; no runtime remote image request.
