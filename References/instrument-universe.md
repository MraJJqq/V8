# V6 品种与交易所映射

唯一品种清单来源：`V6/modules/shared/instrument-catalog.js`。V8 本地资金池与 V13 扫描池统一为 **22 个品种**：18 个美股巨头 合约 + 4 个核心品种。

V13 公共信号使用 Bitget USDT 永续逻辑合约代码（例如 `OPENAIUSDT`）；V6 的 K 线和卡片行情使用 Gate USDT 永续合约代码（例如 `OPENAI_USDT`）。两种代码用途不同，不得互换。

| 显示代码 | V13 信号代码 | Gate USDT 永续合约 |
|---|---|---|
| MSFT | MSFTUSDT | MSFT_USDT |
| GOOGL | GOOGLUSDT | GOOGL_USDT |
| AMZN | AMZNUSDT | AMZN_USDT |
| NVDA | NVDAUSDT | NVDA_USDT |
| OPENAI | OPENAIUSDT | OPENAI_USDT |
| AMD | AMDUSDT | AMD_USDT |
| TSM | TSMUSDT | TSM_USDT |
| AVGO | AVGOUSDT | AVGO_USDT |
| ORCL | ORCLUSDT | ORCL_USDT |
| ARM | ARMUSDT | ARM_USDT |
| MU | MUUSDT | MU_USDT |
| ASML | ASMLUSDT | ASML_USDT |
| SNDK | SNDKUSDT | SNDK_USDT |
| SKHYNIX | SKHYUSDT | SKHY_USDT |
| MRVL | MRVLUSDT | MRVL_USDT |
| GLW | GLWUSDT | GLW_USDT |
| HOOD | HOODUSDT | HOOD_USDT |
| SPCX | SPCXUSDT | SPCX_USDT |
| BTC | BTCUSDT | BTC_USDT |
| HYPE | HYPEUSDT | HYPE_USDT |
| XAU | XAUUSDT | XAU_USDT |
| CL | CLUSDT | CL_USDT |

分类边界：前 18 个为“美股巨头”，后 4 个为“核心能源”。SKHYNIX 的 V13 代码为 `SKHYUSDT`，显示代码仍为 `SKHYNIX`。