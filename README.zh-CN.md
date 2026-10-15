# Agent Exchange 接入示例

**让你的 Agent 在预算内获取数据、使用工具。**

这是独立的 Node.js 22+ 示例项目，无第三方依赖，演示外部 Agent 如何完成第一笔交易。提供买方客户端、卖方发布示例、合成数据及英文接入文档。

**开发者预览 · 虚拟积分 · 平台手续费为零**

[![示例测试](https://github.com/1024959525-boop/agent-exchange-examples/actions/workflows/examples.yml/badge.svg)](https://github.com/1024959525-boop/agent-exchange-examples/actions/workflows/examples.yml)

这个目录不包含交易平台服务端，也不提供公网交易服务。使用者需要单独运行平台，或取得已有平台实例的访问权限。`http://127.0.0.1:3100` 指向使用者自己的电脑，海外用户无法通过这个地址访问你的电脑。

[English](README.md) · [第一笔交易完整指南](docs/first-trade.md) · [API 说明](docs/api.md)

## 完成第一笔交易

1. 使用 Node.js 22 或更新版本，下载示例代码并进入目录，无需安装依赖。
2. 在平台的 Agent 管理页面创建买方 Agent 的 API Key。密钥只在创建时展示，请保存到本地环境文件。
3. 复制配置，填写平台地址和密钥。

```sh
git clone https://github.com/1024959525-boop/agent-exchange-examples.git
cd agent-exchange-examples
cp .env.example .env.local
node --env-file=.env.local first-trade.mjs
```

默认只验证连接、查看商品和预估费用，不创建订单。确认后运行：

```sh
node --env-file=.env.local first-trade.mjs --execute
```

默认示例购买 40 积分的数据，再调用 12 积分的统计工具，总计 52 积分。全新演示买方余额从 1000 变为 948，结果为总和 296、平均值 296 / 3。已有消费时，余额以实际账本为准。

使用运营者提供的测试账号或注册自己的账号，选择有权操作的买方 Agent，并创建独立密钥。新 Agent 如无积分，请运营者发放测试积分。单笔额度至少 40、当日剩余额度和可用余额至少 52，并确保 worker 正常运行。账号与登录凭证由运营者私下提供，本示例仓库不公布登录信息。

脚本会在交易前打印 run ID，并在 `.agent-market-runs/` 保存不含密钥的恢复记录。网络中断后使用原 ID 继续：

```sh
node --env-file=.env.local first-trade.mjs --execute --run-id 原来的_RUN_ID
```

新 ID 会产生一笔新的购买。工具失败或结果未知时不会自动重新调用；此前已成功交付的数据仍然收费。不要删除尚未完成的恢复记录。

## 卖方发布数据

将 `.env.local` 切换为卖方 Agent 的密钥，再运行：

```sh
node --env-file=.env.local seller.mjs \
  --file fixtures/sample-data.json \
  --name "Synthetic regional demand" \
  --description "Synthetic sample, not real market research" \
  --license "MIT synthetic example data" \
  --price 20 \
  --version 1.0.0
```

默认仅预览。增加 `--execute` 才会提交，商品需由管理员审核后上架。样本是合成数据，不是真实市场调研；请只上传有权公开和授权使用的内容。

## 测试与公开代码

```sh
npm test
npm run pack
```

测试使用独立模拟服务，不消耗平台积分。打包仅选择已审核的示例文件，输出 `../release/agent-exchange-examples.tar.gz`。按[发布到 GitHub 的指南](docs/publish-on-github.md)建立单独仓库；不要上传整个平台目录。

这个客户端按确定流程执行，不内置模型，不承诺解决任意自然语言目标。示例使用虚拟积分，不包含真实支付、提现、MCP 或 A2A 接入。`.env.local`、密钥、数据库、真实数据和运行记录都不应公开。
