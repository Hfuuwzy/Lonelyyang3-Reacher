---
title: DeepSeek Harness 是否开源，以及是否必须使用 DeepSeek API
description: 依据 DeepSeek 官方仓库与文档，核对 dsh 开源状态及模型 API 选项。
date: 2026-09-24
category: AI 与开发工具
tags: [DeepSeek Harness, 开源, LLM, API]
---

# DeepSeek Harness 是否开源，以及是否必须使用 DeepSeek API

**结论先说：** DeepSeek Harness（命令名 `dsh`）是 DeepSeek AI 发布的开源项目，采用 MIT 授权。[官方 README](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/README.md#L5-L15) · [LICENSE](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/LICENSE#L1-L13)

## 快速结论

| 问题 | 结论 |
| --- | --- |
| 开源吗？ | 是。官方仓库称 dsh 为开源 agent harness，许可证为 MIT。 |
| 默认调用需凭据？ | 需要。无凭据会导致默认请求失败，也可改用其他服务。 |
| 默认模型 route？ | `deepseek-official` / `deepseek-flash`；默认引用 `DEEPSEEK_API_KEY`，协议为 Anthropic Messages。 |
| 只能用官方 API？ | 不必。可用 `baseURL` 指向其他 Messages 兼容端点。 |
| 其他 route？ | 内置 `openai`、`anthropic`；也支持自定义 route。 |
| DeepSeek key 通用吗？ | 否。OpenAI、Anthropic 另需各自密钥。 |

## 默认配置与硬性要求

仓库默认配置把 agent 的 provider/model 设为 `deepseek-official` / `deepseek-flash`。[默认模型](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/base/cordis.patch.yml#L80-L86) DeepSeek adapter 的配置 schema 将 `DEEPSEEK_API_KEY` 设为默认凭据引用，并将官方 Messages endpoint 设为 `https://api.deepseek.com/anthropic`；`DEEPSEEK_BASE_URL` 或显式 `baseURL` 可以替换端点。该 adapter 使用 Anthropic Messages-compatible wire format。[adapter 配置](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/README.md#L10-L12) · [`baseURL`](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/config.ts#L299-L302) 若选择这个 route 发请求，源码会优先解析适用于该 endpoint 的账户 token，否则解析配置的 API key；没有可用凭据时返回 `MISSING_CREDENTIAL`，而不是匿名调用。[凭据选择](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/adapter.ts#L83-L88) · [缺少 API key](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/index.ts#L64-L83)

因此要区分两件事：**按默认模型执行任务需要 DeepSeek route 可认证；安装、启动或运行整个 dsh 并不等于必须购买/调用 DeepSeek 托管 API。** 开发文档把 API key 列为 Web、headless、ACP 自动化示例与真实 API 测试的可选项；真实调用仍需有一个当前所选 provider 支持的凭据与 endpoint。[开发文档](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/development.md#L9-L14) Python SDK 的 `sdk-minimal` 示例是 DeepSeek 专用组合，指南要求 DeepSeek-compatible endpoint 和 credential，并示例设置 `DEEPSEEK_API_KEY`；注释中的 `DEEPSEEK_BASE_URL` 可指向 `http://127.0.0.1:8000/v1`，所以即使该默认示例也不意味着 endpoint 必须由 DeepSeek 托管。[SDK 前置条件](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/user/guide/python-sdk.md#L9-L13) · [本地代理示例](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/user/guide/python-sdk.md#L53-L63) · [SDK 默认 provider](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/user/guide/python-sdk.md#L103-L108) Endpoint 改成本地服务后，直接 adapter 仍会向其发送配置凭据；`DEEPSEEK_API_KEY` 只是默认的环境变量引用名称，route 可配置为其他 key 引用。

## OpenAI、Anthropic 与自托管 route

`dsh-llm-pi-ai` 是另一套多 provider adapter。它的配置示例分别使用 `openai` + `OPENAI_API_KEY` 和 `anthropic` + `ANTHROPIC_API_KEY`；官方用户指南也将 `openai`、`anthropic` 列为 dsh 随附的 provider。该 adapter 可在没有配置 route 时保持 dormant，用户添加 route 后才注册；没有设置 `apiKeyEnv` 的 catalog provider 可以使用 pi-ai 自身的环境或凭据发现。[内置 route 与凭据配置](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/README.md#L38-L58) · [dormant adapter](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/base/cordis.patch.yml#L120-L129) · [环境凭据发现](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/src/index.ts#L183-L197)

官方“Configure models”指南明确允许将 relay、公司 gateway、自托管 server 或 catalog 外的服务配置为 custom model API：提供 Provider ID、`baseURL`、protocol、凭据和 model。[custom model API 指南](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/user/guide/providers.md#L21-L27) 源码注册表确认 custom routes 可选择下列三种 wire protocol：[实现映射](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/src/provider.ts#L47-L51)

- `openai-completions`：OpenAI Chat Completions
- `openai-responses`：OpenAI Responses API
- `anthropic-messages`：Anthropic Messages API

所以本地部署可以通过该 adapter 接入，只要端点实现 route 所配置的协议并满足认证方式。注意一个本地 OpenAI-compatible server 若本身不校验 key，pi-ai 的 OpenAI-compatible 实现仍要求 API key 或 `Authorization` header；官方包文档说明可用占位 key 或配置 header。具体兼容性由 endpoint 决定，不应把“协议兼容”误解为“任何本地服务都天然免凭据”。

## `DEEPSEEK_API_KEY` 的适用范围

这不是一个交给所有 LLM provider 共用的全局 key。DeepSeek direct adapter 默认引用它；SDK minimal profile 也选择 `deepseek-official` 并显式设置该引用。[SDK profile](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/sdk-minimal/cordis.patch.yml#L26-L31) 内置 OpenAI/Anthropic route 可以分别使用它们自己的凭据引用，或在配置允许时依赖 pi-ai 的原生凭据发现。

另一个需要注明的例外是 `dsh-web-search-deepseek`：仓库的共享 base bundle 也配置该 DeepSeek-backed search route，并让它复用 `DEEPSEEK_API_KEY`。[base bundle 配置](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/base/cordis.patch.yml#L459-L479) 因此它不只出现在聊天 adapter/SDK 示例中，但它仍然只服务于 DeepSeek 路由，不构成 OpenAI/Anthropic 或整个 dsh runtime 的全局认证要求。

## 版本与范围

- **快照日期：** 2026-09-24。
- **官方仓库当时 `master` HEAD：** [`46a7f68b0922371ce7144b668b90e377d8e799f4`](https://github.com/deepseek-ai/deepseek-harness/commit/46a7f68b0922371ce7144b668b90e377d8e799f4)（commit 时间：2026-09-23）。以下源码引用均固定到此 SHA。
- **开发预览提示：** README 明确标注 developer preview，并警告会有兼容性破坏变更。结论只描述该快照，后续版本可能改变配置或 provider 支持。
- **项目识别：** 本文所指是官方 [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) 仓库及其 `dsh` 命令，不是 Dify，也不是其他相似名称的产品。

## 官方来源

### 固定版本源码与许可

- [README：项目身份、开源声明、文档入口及 developer-preview 警告](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/README.md#L1-L15)
- [LICENSE：MIT License 与授权条件](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/LICENSE#L1-L16)
- [默认模型 route、pi-ai dormant route 与共享 bundle 的 DeepSeek search 凭据](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/base/cordis.patch.yml#L80-L86) · [pi-ai route](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/base/cordis.patch.yml#L120-L129) · [DeepSeek search](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/base/cordis.patch.yml#L459-L479)
- [DeepSeek adapter：默认 key/env 名称、端点与消息协议配置](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/config.ts#L14-L32) · [官方 URL、Messages 兼容端点覆盖与默认解析](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/config.ts#L114-L118) · [baseURL fallback 与校验](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/config.ts#L299-L302) · [缺少 API key 时的 MISSING_CREDENTIAL](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/index.ts#L64-L83) · [账户 token 优先于 API key](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-deepseek/src/adapter.ts#L83-L88)
- [多 provider adapter：OpenAI/Anthropic 示例与 custom gateway 字段](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/README.md#L38-L69) · [本地 OpenAI-compatible route 的认证注意事项](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/README.md#L227-L228) · [provider 原生凭据发现](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/src/index.ts#L183-L197)
- [Protocol 实现导入与受支持 route 映射](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/src/provider.ts#L22-L25) · [Chat Completions、Responses、Anthropic Messages](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/llm/llm-pi-ai/src/provider.ts#L47-L51)
- [SDK minimal bundle 的 DeepSeek route 与 key 引用](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/packages/bundle/sdk-minimal/cordis.patch.yml#L26-L31)

### DeepSeek 官方文档

- [Configure models：内置 provider、custom/self-hosted endpoint 与三个协议](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)
- [Python SDK：默认 SDK profile、DeepSeek-compatible endpoint 与凭据配置](https://deepseek-harness.github.io/deepseek-harness/en/guide/python-sdk)
- [Development guide：API key 对示例和真实 API 测试是 optional](https://github.com/deepseek-ai/deepseek-harness/blob/46a7f68b0922371ce7144b668b90e377d8e799f4/docs/development.md#L9-L14)
