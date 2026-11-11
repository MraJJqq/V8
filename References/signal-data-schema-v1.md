# V12 Public Signals 数据接口参考

来源：V12 `v12/public-signals.json`。本文件只描述接口结构，不保存某次扫描的动态信号快照。

## 顶层字段

- `source`：数据源标识（VEGAS V12）。
- `schema_version`：接口版本。
- `signal_day`：信号日期。
- `scan_status`：扫描状态。
- `symbols_ok` / `symbols_total`：成功处理数量与总数量。
- `symbols`：本次覆盖的品种代码列表。
- `signals`：正式信号记录数组。
- `started_at` / `finished_at`：扫描起止时间。
- `scan_timeframes`：使用的周期列表。

## 正式信号记录字段

- `symbol`：V12 逻辑合约代码，例如 `AAPLUSDT`；与 V6 品种清单中的逻辑代码匹配。
- `formal_signal`：是否为正式信号。
- `candle_timestamp_ms`：信号 K 线时间戳（毫秒）。
- `filter_side`：过滤线收盘位置。
- `tunnels`：触发的 Vegas 隧道名称数组。

## 数据边界

- V12 负责数据获取、规则计算、扫描和发布正式信号。
- V6 只读取 V12 公共 JSON，验证完整扫描和 27 品种覆盖后展示。
- V6 的 Gate K 线合约映射是独立字段，不应把 V12 的逻辑代码直接当作 Gate 原生合约代码。
- 不复制动态 JSON 快照、信号计算代码、密钥或推送状态。