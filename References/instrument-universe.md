# V6 品种与交易所映射

唯一品种清单来源：`V6/modules/shared/universe-v6.js`。Gate 永续合约映射来源：`V6/modules/shared/gate-universe.js`。共 27 个品种。

V12 公共信号使用逻辑合约代码（例如 `AAPLUSDT`）；V6 的 K 线和卡片行情使用 Gate USDT 永续合约代码（例如 `AAPL_USDT`）。两种代码用途不同，不得互换。

| 显示代码 | V12 信号代码 | Gate USDT 永续合约 |
|---|---|---|
| AAPL | AAPLUSDT | AAPL_USDT |
| MSFT | MSFTUSDT | MSFT_USDT |
| GOOGL | GOOGLUSDT | GOOGL_USDT |
| AMZN | AMZNUSDT | AMZN_USDT |
| NVDA | NVDAUSDT | NVDA_USDT |
| TSLA | TSLAUSDT | TSLA_USDT |
| META | METAUSDT | META_USDT |
| INTC | INTCUSDT | INTC_USDT |
| QCOM | QCOMUSDT | QCOM_USDT |
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
| CBRS | CBRSUSDT | CBRS_USDT |
| SPCX | SPCXUSDT | SPCX_USDT |
| BTC | BTCUSDT | BTC_USDT |
| HYPE | HYPEUSDT | HYPE_USDT |
| XAU | XAUUSDT | XAU_USDT |
| CL | CLUSDT | CL_USDT |

分类边界：前 23 个为“美股巨头”，后 4 个为“核心能源”。SKHYNIX 的 V12 代码为 `SKHYUSDT`，显示代码仍为 `SKHYNIX`。