# AGH 飞书渠道插件

[English](README.md) | 简体中文

## 市场与 Git 安装

官方市场收录后，可从“插件 → 市场”安装。也可使用下方 Git 来源检查、审阅并安装此版本：

```sh
agh plugins add git:https://github.com/lzc970718/agh-plugin-feishu.git#v0.1.3
```

发行提交包含完整 `dist/` 和图标，不需要用户构建或安装依赖。最低 AGH 合同版本为 0.1.0，且必须支持统一渠道桥和 Extension API ^5.8.0。


`@agnes/channel-feishu` 0.1.3，独立的平台适配器，需包含统一渠道桥、Extension API 5.8.0 的 AGH。通过官方 Node SDK 1.76.0 长连接接收消息，不需要公网入站端口。支持飞书，平台区域可选国际版 Lark。安装不会自动连接账号。

## 安装

分发文件为 `agnes-channel-feishu-0.1.3.tgz`。在 AGH「插件 → 从来源安装」选择本地 tgz，检查并审阅网络、凭据与受管服务权限，信任并启用；也可在终端运行 `agh plugins add <tgz路径>` 完成审阅。不要打包 node_modules、开发 SDK 链接或机器配置。

同一 tgz 不包含 Windows 原生二进制，可由匹配版本的 Windows/macOS/Linux Harness 加载。宿主本身要使用对应系统构建，不能把 Windows local 目录复制给 Mac。

## 飞书开放平台设置

1. 在飞书开放平台创建**企业自建应用**，启用机器人能力；本插件不使用群自定义 Webhook 机器人。
2. 在权限管理按后台当前名称开通：读取用户发给机器人的单聊消息（`im:message.p2p_msg:readonly`）、接收群内 @机器人消息（`im:message.group_at_msg:readonly`）、以应用身份发送消息（`im:message:send_as_bot`）、消息资源读取/上传下载相关权限（`im:resource`）。若要接收所有群消息，另按官方要求申请对应敏感权限；不建议为测试默认申请全量群消息。
3. 事件订阅采用**长连接接收事件**，订阅 `im.message.receive_v1`。发布应用版本并设置可用范围，将机器人加入需要的群。可先在开发者后台保存长连接模式；如果平台要求有连接才能保存，先完成下面的 AGH 凭据与连接配置，再回后台确认模式及订阅并发布。
4. 记录「凭证与基础信息」中的 **App ID**（通常以 `cli_` 开头）和 **App Secret**，分别保存到 AGH 凭据管理，选择 `feishu` 或已审核的 `generic` 命名空间。App ID 不是机器人 open_id，Secret 不应写到插件目录或非敏感配置。
5. 插件会使用应用凭据获取 tenant_access_token，再调用机器人信息接口确认本应用机器人 open_id，用于准确识别群 @。因此应用必须已启用机器人能力。

官方文档与 SDK 参考见 PROVENANCE.md。应用权限、发布状态、租户可见范围和长连接设置应以你所在平台后台为准；Lark 使用相应国际版开发者后台及应用凭据。

## 在 AGH 中配置与绑定

1. 打开一个真实会话；新会话草稿先发送第一条消息。点击输入框旁「渠道绑定」，选择「飞书」。也可在「插件 → 渠道」新增连接并选已有会话。
2. `appId` 选择已保存的飞书 App ID 凭据，`appSecret` 选择对应 App Secret。平台区域默认 `feishu`；国际版选择 `lark`。工作区、智能体、实例标识跟随会话，由底座派生。
3. 保存并完成原生审批，等待长连接建立。向飞书机器人私聊发一句话，或在群里 @机器人发消息。
4. 在同一弹窗刷新聊天目标，明确确认同步并绑定。只有绑定之后的新消息转发，绑定前的历史不补发。已有连接可在渠道总览编辑、解绑、换绑。
5. AGH 用户文本会由机器人以“来自 AGH 的用户消息”标注发送，智能体回复也会发送。平台用户消息不回送平台，避免回环。当前出站身份是应用机器人，不是用户账号。

群聊默认 requireMention 为 true。allowFrom 使用发送者的飞书 **open_id**（`ou_...`），不是昵称、邮箱或 App ID。未绑定聊天不自动创建 AGH 会话。

## 支持范围

- 入站：私聊、群聊真实 @；文本、post 富文本及其图片、文件、语音文件、视频文件、表情附件。纯附件消息不会因无文字而丢失。
- 附件：通过固定的飞书/Lark 消息资源 API 获取真实字节，提交底座的原生 file/image 准入。单消息合计最多 20 MiB、最多 50 个附件；部分失败保留成功文件并显示固定原因，不泄漏下载 key、token 或后端原文。
- PNG/JPEG 会作为图片输入；其他媒体按文件保存。大截图、格式或模型限制可能由底座降级为普通附件；保存成功不代表模型原生理解音视频。当前 AGH 用户附件出站仍遵循底座的“在 AGH 中查看”提示，不上传到飞书。
- 出站：文本及文字降级内容；单段最多 8000 Unicode 字符，长消息分段，稳定 deliveryKey 对应平台发送 uuid。发送 API 的去重有效期由平台决定，不能宣称永久 exactly-once；发生不确定结果时不盲目自行重发。
- 不提供：线程独立绑定、消息原地编辑、卡片按钮审批、目录同步、主动上传平台文件。交互审批留在 AGH。回复会沿用普通群聊作用域，不承诺话题线程隔离。
- 随包提供 assets/feishu.png 飞书图标，构建时嵌入渠道声明；运行时不远程加载图标。

## 生命周期与失败

每实例拥有独立 token、socket 和聊天目标。停用/卸载/凭据替换会中止请求和连接，旧连接回调不得投递到新实例。SDK 负责自动重连和 ping 超时检测；断开/重连期间禁止伪造发送成功。当前桥合同没有即时 WS 状态通知口，短暂的 SDK 内部重连可能比页面状态更新更早，不能仅凭“已连接”认定平台投递成功。

资源下载禁止自动跳转，避免把 Bearer token 发到其他来源；如果平台资源接口返回跳转，会以 REDIRECT 明确报错，需针对实际平台路径复核，不能直接关闭保护。下载失败还会显示 HTTP、NETWORK、LIMIT 等固定原因。机器人信息/事件格式无效时拒绝建立或投递，不猜测身份。

凭据改变后 token 和机器人身份重新获取。关闭无法完成时按底座受管生命周期报告未知，而不是假装停止。卸载后的实例覆盖配置、目标与绑定由底座清理；凭据和会话历史保留。

## 开发

先使用与宿主相同版本的公开作者 SDK。源码预览可运行 `node prepare.mjs` 建立本地引用（默认使用相邻 agnes-harness，可用 AGH_SOURCE 指向其他源码位置），这些机器专属开发链接和 tsconfig paths 不随包发布。

```sh
npm ci
npm run prepareSdk
npm run typecheck
npm test
npm run build
npm pack --dry-run
npm pack
```

宿主仓内验证使用 `mise exec -- node tools/toolchain/run.mjs ...` 固定 Node/pnpm，当前开发 Node 为 v24.20.0。build.mjs 输出 ESM，外置宿主 channel-contract/protocol，不捆绑 runner、SDK 客户端发现或原生系统模块；NOTICE 来自实际 esbuild 输入依赖。

测试使用合成账号和网关。真实飞书企业权限、长连接、群 @、资源 API、休眠/唤醒、限流仍须按 VALIDATION.md 由实际部署账号验收。macOS/Linux 未在本次 Windows 环境中实机验证。

## 长连接投递约束

飞书官方要求事件回调快速返回，插件在消息进入每实例最多 64 项的内存处理队列后即确认接收，不等待附件下载完成，避免超过平台 3 秒回调期限。队列不跨进程持久化；进程崩溃可能丢失已经确认但尚未导入 AGH 的排队事件，不能宣称平台到 AGH 全链路 exactly-once。队列满时同步拒绝入队，由平台重投机制处理。处理中的下载遵循取消与字节预算。

同一飞书应用的多个长连接是集群分发，不是广播。请不要用同一个 App ID 在多个独立 AGH 实例/客户端同时接收，并期待每个连接都能得到全部消息。一个机器人连接可按底座规则绑定多个不同聊天目标；不同企业或机器人应使用各自应用凭据。参考：https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-

## 渠道名称语言

0.1.2 起使用 AGH Extension API 5.8.0 的 manifest.displayNames，英文界面显示 Feishu，中文界面显示 飞书。渠道身份与现有实例、绑定保持不变。请先更新到包含该能力的 Harness，再更新插件。
