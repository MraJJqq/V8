# VEGAS V8

VEGAS V8 is rebuilt from the Media library's complete seven-system website package. All seven systems, their runtime files, local dependencies, visual assets and operating rules are migrated together.

## 七大系统

1. **K线系统**：Gate USDT 永续合约 K线、历史补齐、实时更新、缓存和 Vegas EMA。
2. **统一视窗与手势系统**：五个周期共用一套页面级视窗状态；周期和品种切换不创建独立缩放状态。
3. **滚动行情卡片系统**：27 个本地卡片、Gate 行情、点选、拖动和轮播。
4. **Logo 与倒计时系统**：27 个本地 SVG 标识、淡入淡出切换和周期倒计时。
5. **五周期系统**：**1H、2H、4H、8H、D**；2H 由 Gate 原始 1H K线按 UTC 两小时边界聚合。
6. **V12 信号与底部滚动系统**：读取 V12 公共信号 JSON；V8 只展示信号，不复制信号生成、扫描或推送。
7. **全屏幕动态系统**：统一负责动态视口高度、横竖屏布局和安全区域适配。

## 数据与资源边界

- K线与卡片行情：Gate USDT 永续合约。
- 正式信号：`https://raw.githubusercontent.com/MraJJqq/v12/main/v12/public-signals.json`。
- 27 个品种 Logo、字体、图标、CSS、模块和页面资源均在本仓库本地保存。
- 背景原始素材保留在 `Backgrounds/`；网页实际使用的背景副本位于 `assets/backgrounds/`。
- 五个周期共用同一套视窗状态，不得拆分为各周期独立视窗。

## 目录

- `index.html`：V8 网页入口。
- `assets/`、`cards/`、`kline/`、`modules/`：七大系统运行代码和本地依赖。
- `Backgrounds/`、`Brand/`、`Logos/`、`Cards/`、`Charts/`、`References/`、`Templates/`、`UI/`：完整配套素材与规范。
- `docs/SEVEN-SYSTEMS.md`：七大系统职责、运行流程和集成契约。
- `tools/validate_v8.py`：静态完整性检查。

GitHub Pages 由 `.github/workflows/pages.yml` 自动部署。

<!-- Media cache release sync trigger -->
