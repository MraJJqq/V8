import { INSTRUMENTS } from "../shared/universe-v6.js";

export function createSignalTicker({
  container,
  track,
  instruments = INSTRUMENTS,
  documentRef = typeof document === "undefined" ? null : document,
  ResizeObserverImpl = typeof ResizeObserver === "undefined" ? null : ResizeObserver,
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id)
} = {}) {
  container ||= documentRef?.getElementById("signal-ticker");
  track ||= documentRef?.getElementById("signal-track");
  if (!container || !track || !documentRef) throw new TypeError("Signal ticker elements are required");

  let destroyed = false;
  let paused = false;
  let frame = 0;
  let observer = null;
  let lastRenderKey = null;
  let animationReady = false;
  let lastCycleWidth = 0;
  let lastDuration = 0;
  const groups = [
    ["美股巨头", instruments.filter(item => item.category === "美股巨头")],
    ["核心能源", instruments.filter(item => item.category === "核心能源")]
  ];

  function layout() {
    if (destroyed) return;
    const cycle = track.querySelector(".signal-cycle");
    if (!cycle) return;
    const width = cycle.getBoundingClientRect().width;
    if (!width) return;

    const viewport = container.clientWidth;
    while (track.scrollWidth < viewport + width) track.append(cycle.cloneNode(true));

    const duration = Math.max(18, width / 36);
    if (width !== lastCycleWidth) {
      track.style.setProperty("--signal-distance", width + "px");
      lastCycleWidth = width;
    }
    if (duration !== lastDuration) {
      track.style.setProperty("--signal-duration", duration + "s");
      lastDuration = duration;
    }

    // Keep one animation timeline alive; resize/layout must not restart the marquee.
    if (!animationReady) {
      track.style.animation = "signal-marquee var(--signal-duration) linear infinite";
      animationReady = true;
    }
    track.style.animationPlayState = paused ? "paused" : "running";
  }

  function scheduleLayout() {
    if (destroyed || frame) return;
    frame = requestFrame(() => {
      frame = 0;
      layout();
    });
  }

  function render(payload) {
    if (destroyed) return;

    let mode = "unavailable";
    let symbolsByGroup = [];
    if (payload) {
      const valid = payload.source === "VEGAS V12" &&
        (payload.scan_status === "complete" || payload.scan_status === "complete_with_warmup_warning") &&
        payload.symbols_ok === instruments.length &&
        payload.symbols_total === instruments.length &&
        Array.isArray(payload.signals);

      if (!valid) {
        mode = "waiting";
      } else {
        mode = "ready";
        const validContracts = new Set(instruments.map(item => item.contract));
        const formalContracts = new Set(
          payload.signals
            .filter(signal => signal?.formal_signal === true)
            .map(signal => String(signal.symbol || "").trim().toUpperCase())
            .filter(contract => validContracts.has(contract))
        );
        symbolsByGroup = groups.map(([, members]) =>
          members.filter(item => formalContracts.has(item.contract)).map(item => item.symbol)
        );
      }
    }

    const renderKey = mode + ":" + symbolsByGroup.map(symbols => symbols.join(",")).join("|");
    if (renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;

    const cycle = documentRef.createElement("div");
    cycle.className = "signal-cycle";

    if (mode === "unavailable" || mode === "waiting") {
      const node = documentRef.createElement("span");
      node.className = "signal-empty";
      node.textContent = mode === "unavailable" ? "V12 数据暂不可用" : "等待 V12 完整扫描";
      cycle.append(node);
    } else {
      groups.forEach(([title], groupIndex) => {
        const group = documentRef.createElement("div");
        group.className = "signal-group";
        const heading = documentRef.createElement("span");
        heading.className = "signal-heading";
        heading.textContent = title;
        group.append(heading);

        const content = documentRef.createElement("div");
        content.className = "signal-content";
        const symbols = symbolsByGroup[groupIndex];
        if (!symbols.length) {
          const empty = documentRef.createElement("span");
          empty.className = "signal-empty";
          empty.textContent = "▰ No change ▰";
          content.append(empty);
        } else {
          const chunkSize = title === "美股巨头" ? 3 : symbols.length;
          for (let index = 0; index < symbols.length; index += chunkSize) {
            const row = documentRef.createElement("span");
            row.className = "signal-row";
            row.textContent = symbols.slice(index, index + chunkSize).map(symbol => "▰ " + symbol + " ▰").join("   ");
            content.append(row);
          }
        }
        group.append(content);
        cycle.append(group);
      });
    }

    // Replace content only when the visible signal state actually changes.
    track.replaceChildren(cycle);
    lastCycleWidth = 0;
    lastDuration = 0;
    scheduleLayout();
  }

  function setPaused(value) {
    paused = Boolean(value);
    track.style.animationPlayState = paused ? "paused" : "running";
  }

  if (ResizeObserverImpl) {
    observer = new ResizeObserverImpl(scheduleLayout);
    observer.observe(container);
  } else if (typeof window !== "undefined") {
    window.addEventListener("resize", scheduleLayout, { passive: true });
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    observer?.disconnect();
    if (!observer && typeof window !== "undefined") window.removeEventListener("resize", scheduleLayout);
    if (frame) cancelFrame(frame);
    frame = 0;
    track.replaceChildren();
  }

  return Object.freeze({ render, setPaused, layout: scheduleLayout, destroy });
}
