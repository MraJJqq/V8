# VEGAS V6

## Runtime
- The 27-symbol catalog, Gate contract derivation, and logo asset mapping are maintained in one local catalog shared by the card and logo modules.
- Internal ES-module imports use canonical URLs so one shared module is not instantiated again under a different query string.
- 页面编排采用统一的模块生命周期、轮播、淡入淡出、交互锁与前后台暂停管理；仅适配 Gate 数据源。
- Logo、周期选择、滚动卡片、V12 信号栏及共享生命周期模块均为 V6 仓库内的本地文件。
- K 线数据只使用 Gate USDT 永续合约；不加载其他交易所客户端或行情存储。

## K-line and cache
- 统一周期标准：1H、2H、4H、8H、D。27 个品种均按这五个周期读取、缓存和续传全部可取得历史数据。
- 2H 由 Gate 原始 1H K 线按 UTC 两小时边界聚合；开高低收分别取首根开盘、两根最高、两根最低、末根收盘。历史闭合 2H 必须由两根连续 1H 组成，当前未闭合周期可显示实时部分数据。EMA 使用统一 K 线计算流程。
- 历史补齐由独立队列逐项执行，与当前选中品种、7 秒轮播、图表重绘和手势生命周期解耦。
- IndexedDB 缓存键按 Gate 数据源、合约、周期隔离；历史补齐与轮播/图表交互分离。
- Gate REST 用于历史与校准，Gate futures candlesticks WebSocket 用于当前周期实时更新。

## Shared viewport
- Period switching, K-line gestures, card-driven symbol selection, automatic symbol rotation and page reload use one shared K-line viewport state.
- The state is page-wide, not stored separately per symbol or timeframe; bar width and the timestamp anchor are mapped onto the newly selected candles.
- The current viewport is saved on page hide/reload and restored on reload. Cards only rotate/select symbols and do not own a separate K-line zoom state.

## Rotation and interactions
- 刷新后随机排列 27 个品种，并避免与上次刷新首个品种重复。
- K 线/Logo 按 V5 编排层节奏轮播；K 线手势或卡片拖动期间暂停轮播。
- 卡片点选切换当前品种；周期模块将选择同步给 K 线和 Logo 倒计时。
- 卡片行情来自 Gate futures tickers；V12 信号栏读取 V12 公共信号文件。

## 全屏幕动态系统
- 全部页面板块统一适配实际视窗尺寸，支持动态视口高度、横竖屏和安全区域。
- K线画布继续由 ResizeObserver 与 DPR 独立调整；K线数据、手势缩放和视窗状态逻辑不变。
- 周期切换控件按可用高度适配；横屏使用独立尺寸规则。
- 周期切换 iframe 只加载自身响应式样式，不再加载整份主页面全屏适配 CSS；主页面仍统一负责 iframe 的位置与尺寸。
- 27 张卡片根据实际卡片视区调整尺寸，小屏减少同时可见数量，优先保持文字可读；卡片选择、拖动、轮播和报价逻辑不变。
- Logo、背景和底部信号栏沿用原有视觉资产与动画，只调整可用尺寸和边界。
- 安全区域由各自所属的页面/模块边界处理，避免同一模块重复叠加底部 inset。

## Performance and recovery
- IndexedDB is the primary historical cache. If it is temporarily unavailable, V6 switches to an in-memory cache so the active page can continue; it retries IndexedDB access after 15 seconds. In-memory fallback is temporary and does not survive a page reload. When IndexedDB recovers, reads and writes merge the temporary cache back into the persistent record.
- Gate historical requests retain bounded exponential retry, and gap repair only requests missing timestamp ranges. Cache-write and cache-open failures are surfaced through runtime diagnostics.
- Card quote text is only written to the DOM when the displayed value changes; unchanged viewport dimensions do not trigger another card layout pass.
- Card observers disconnect on pagehide and reattach on pageshow, including back-forward cache restoration.
- Card quote polling retries transient failures up to three times with bounded backoff. Background suspension, request aborts, and the existing five-minute refresh cadence remain unchanged.
- Runtime errors and unhandled promise rejections are logged with the V6 prefix for diagnosis.
