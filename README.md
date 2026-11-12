# AGH Feishu channel

English | [简体中文](README.zh-CN.md)

![Feishu](assets/feishu.png)

`@agnes/channel-feishu` **0.1.3**. Feishu and Lark WebSocket channel using the AGH channel bridge.

## Requirements

AGH contract version >=0.1.0 **with the unified channel bridge and Extension API ^5.13.0**, and Node.js >=24.10. The AGH contract version alone does not establish channel-bridge support; the plugin API range is checked during installation. This is an independent plugin, not a bundled Assistant runtime.

## Install

Once listed, install through **Plugins → Market** and review its permissions. You can also inspect and install this release directly:

```sh
agh plugins add git:https://github.com/lzc970718/agh-plugin-feishu.git#v0.1.3
```

Tags resolve to immutable Git commits. Release commits include the complete `dist/` runtime, local icon and third-party notices; consumers do not need npm install or a sibling AGH checkout. A `.tgz` archive can also be installed from **Plugins → Add plugin**. Inspect the requested network, credential, storage and managed-service capabilities before trusting and enabling it.

## Connect a conversation

Create and publish a Feishu/Lark application with a bot, enable the message-received event over a persistent connection, enable the card callback (`card.action.trigger`, "card interaction") with the same persistent-connection delivery so button clicks reach AGH, and grant the required messaging/resource permissions. Save app ID and app secret in AGH credentials. Select the correct Feishu/Lark region.

1. Create an AGH conversation, then choose **Channels → Feishu** beside the composer.
2. Select saved credentials and provider options, save the connection and complete native approval. Instance identity, workspace and agent follow the conversation.
3. Send a new message to the configured bot (mention it in supported groups), then refresh the observed chat targets in AGH.
4. Select and explicitly confirm the target. Only new messages after binding are synchronized. Manage, unbind or move connections from **Plugins → Channels**.

The host owns authorization, credentials, session routing, lifecycle, bindings and delivery receipts. AGH-originated user text is forwarded with a source marker by the bot, not impersonated as a platform user. Native approvals stay in AGH. Replies to a quoted message carry the quoted message id, text is sent as Markdown, and messages with buttons are sent as interactive cards. See the [Chinese guide](README.zh-CN.md) for platform setup, attachment limits, recovery and supported features.

## Development

The committed runtime is usable without development dependencies. For a source build use Node.js 24.20.0 and `npm ci --ignore-scripts`, then `npm run build`. To typecheck and test, first build the matching [AGH source](https://github.com/AgnesAI-Labs/agnes-harness) with its documented toolchain, set `AGH_SOURCE` to that checkout, and run:

```sh
npm run prepareSdk
npm run typecheck
npm test
npm run build
```

`prepareSdk` generates ignored local SDK links and `tsconfig.local.json`. Never commit local type mappings, credentials, account exports or machine configuration. Review the rebuilt `dist/` and `NOTICE` before committing a release. Keep package, provider and channel manifest versions aligned, then create a matching `vX.Y.Z` tag.

## Validation and license

See [VALIDATION.md](VALIDATION.md) for executed checks and untested environments, [CHANGELOG.md](CHANGELOG.md) for release changes, and [PROVENANCE.md](PROVENANCE.md) for source and icon attribution. Windows has been exercised locally; macOS/Linux and platform-account coverage are described in the validation record, not implied by pure JavaScript packaging.

Apache-2.0. Bundled dependency licenses are retained in [NOTICE](NOTICE). Platform trademarks belong to their respective owners; this independent adapter is not an endorsement by Feishu.
