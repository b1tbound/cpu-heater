/**
 * CPU HEATER · Clean Frontend Controller
 * Socket is auto-detected directly. User only selects cooler base and thermal paste.
 */

const state = {
  detectData: null,
  socket: "pga",
  cooler: "flat",
  paste: "low",
  comboId: 1,
  curve: null,
  session: null,
  pollTimer: null,
  peakTemp: 0,
  history: [],
  scanCompleted: false,
};

const illustrations = {
  cooler_flat: `
    <rect x="45" y="70" width="110" height="60" rx="4" stroke="#ffffff" stroke-width="1.8" />
    <line x1="45" y1="130" x2="155" y2="130" stroke="#ffffff" stroke-width="3" />
    <text x="100" y="105" text-anchor="middle" fill="#f4f4f5" font-size="12" font-family="Inter, sans-serif" font-weight="600">FLAT BASE</text>
  `,
  cooler_hdt: `
    <rect x="45" y="70" width="110" height="60" rx="4" stroke="#71717a" stroke-width="1.5" />
    <line x1="60" y1="50" x2="60" y2="130" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
    <line x1="85" y1="50" x2="85" y2="130" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
    <line x1="115" y1="50" x2="115" y2="130" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
    <line x1="140" y1="50" x2="140" y2="130" stroke="#ffffff" stroke-width="4" stroke-linecap="round" />
    <text x="100" y="150" text-anchor="middle" fill="#a1a1aa" font-size="11" font-family="Inter, sans-serif">HEATPIPES</text>
  `,
  cooler_fullcover: `
    <rect x="25" y="45" width="150" height="110" rx="8" stroke="#ffffff" stroke-width="2" />
    <rect x="45" y="60" width="110" height="80" rx="4" stroke="#71717a" stroke-width="1.5" />
    <text x="100" y="105" text-anchor="middle" fill="#f4f4f5" font-size="12" font-family="Inter, sans-serif" font-weight="600">FULL-COVER</text>
  `,
  paste_tim: `
    <rect x="50" y="80" width="100" height="40" rx="4" stroke="#71717a" stroke-width="1.5" />
    <path d="M 60 100 Q 100 85 140 100" stroke="#ffffff" stroke-width="2.5" fill="none" />
    <text x="100" y="145" text-anchor="middle" fill="#f4f4f5" font-size="12" font-family="Inter, sans-serif" font-weight="600">PASTE</text>
  `,
};

// DOM references
const dom = {
  // Screens
  viewAutoscan: document.getElementById("view-autoscan"),
  viewWizard: document.getElementById("view-wizard"),
  viewActive: document.getElementById("view-active"),
  viewCompleted: document.getElementById("view-completed"),

  // Top header
  headerCpuTag: document.getElementById("header-cpu-tag"),
  stopwatchContainer: document.getElementById("stopwatch-container"),
  swTime: document.getElementById("sw-time"),
  swTotal: document.getElementById("sw-total"),
  swStageBadge: document.getElementById("sw-stage-badge"),
  swRemaining: document.getElementById("sw-remaining"),
  hwSensorTemp: document.getElementById("hw-sensor-temp"),

  // Scan items
  scanItemCpu: document.getElementById("scan-item-cpu"),
  scanItemSocket: document.getElementById("scan-item-socket"),
  scanItemSensor: document.getElementById("scan-item-sensor"),
  scanValCpu: document.getElementById("scan-val-cpu"),
  scanValSocket: document.getElementById("scan-val-socket"),
  scanValSensor: document.getElementById("scan-val-sensor"),
  scanAnimStatus: document.getElementById("scan-anim-status"),
  chipCenterText: document.getElementById("chip-center-text"),

  // Wizard
  visualSvg: document.getElementById("visual-svg"),
  visualCaptionTitle: document.getElementById("visual-caption-title"),
  sumProfileName: document.getElementById("sum-profile-name"),
  sumPeakTemp: document.getElementById("sum-peak-temp"),
  sumReleaseTemp: document.getElementById("sum-release-temp"),
  sumDuration: document.getElementById("sum-duration"),
  chkSim: document.getElementById("chk-sim"),

  // Active
  actStageStep: document.getElementById("act-stage-step"),
  actStageTitle: document.getElementById("act-stage-title"),
  actDynamicCopy: document.getElementById("act-dynamic-copy"),
  actUserAction: document.getElementById("act-user-action"),
  actCurTemp: document.getElementById("act-cur-temp"),
  actTgtTemp: document.getElementById("act-tgt-temp"),
  actLoadVal: document.getElementById("act-load-val"),
  telemetryCanvas: document.getElementById("telemetry-canvas"),

  // Completed
  finPeak: document.getElementById("fin-peak"),
  finFinal: document.getElementById("fin-final"),
  finDur: document.getElementById("fin-dur"),
  shutdownStatusText: document.getElementById("shutdown-status-text"),
};

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  runAutoscan();
});

// =============================================================================
// SCREEN 0: AUTOSCAN
// =============================================================================

async function runAutoscan() {
  try {
    const res = await fetch("/api/detect");
    const data = await res.json();
    state.detectData = data;

    const cpu = data.cpu || {};
    const sock = cpu.socket || {};
    const sensor = data.sensor || {};
    const temp = data.sensor_temp || 30.0;

    // CPU
    await sleep(300);
    dom.scanValCpu.textContent = cpu.model || "Unknown";
    dom.scanItemCpu.classList.remove("pending");
    dom.scanItemCpu.classList.add("done");
    dom.headerCpuTag.textContent = cpu.model || "Ready";

    // Socket
    await sleep(300);
    const sockName = sock.socket ? `${sock.socket} (${(sock.class || "PGA").toUpperCase()})` : "AM4";
    dom.scanValSocket.textContent = sockName;
    dom.scanItemSocket.classList.remove("pending");
    dom.scanItemSocket.classList.add("done");
    dom.chipCenterText.textContent = sock.socket || "CPU";

    // Sensor
    await sleep(300);
    dom.scanValSensor.textContent = `${temp.toFixed(1)}°C (${sensor.name || "Sensor"})`;
    dom.scanItemSensor.classList.remove("pending");
    dom.scanItemSensor.classList.add("done");
    dom.hwSensorTemp.textContent = `${temp.toFixed(1)}°C`;

    dom.scanAnimStatus.textContent = "Ready";

    // Auto-lock socket from detection
    const sockClass = (sock.class || "pga").toLowerCase();
    if (["pga", "lga", "hedt"].includes(sockClass)) {
      state.socket = sockClass;
    }

    await sleep(500);
    completeScan();
  } catch (err) {
    console.error("Autoscan error:", err);
    completeScan();
  }
}

function completeScan() {
  if (state.scanCompleted) return;
  state.scanCompleted = true;
  switchView("view-wizard");
  goToWizardStep("cooler");
}

// =============================================================================
// SCREEN 1: 2-STEP QUESTIONNAIRE (COOLER -> PASTE -> REVIEW)
// =============================================================================

function goToWizardStep(stepName) {
  const steps = ["cooler", "paste", "review"];
  steps.forEach((name) => {
    const pane = document.getElementById(`step-pane-${name}`);
    if (pane) {
      if (name === stepName) pane.classList.add("active");
      else pane.classList.remove("active");
    }
  });

  updateIllustration(stepName);

  if (stepName === "review") {
    resolveAndShowSummary();
  }
}

function updateIllustration(stepName) {
  if (stepName === "cooler") {
    dom.visualSvg.innerHTML = illustrations.cooler_flat;
    dom.visualCaptionTitle.textContent = "Cooler Base";
  } else if (stepName === "paste") {
    dom.visualSvg.innerHTML = illustrations.paste_tim;
    dom.visualCaptionTitle.textContent = "Thermal Paste";
  } else if (stepName === "review") {
    dom.visualSvg.innerHTML = illustrations.cooler_flat;
    dom.visualCaptionTitle.textContent = "Ready";
  }
}

function selectCooler(cooler) {
  state.cooler = cooler;
  if (cooler === "flat") dom.visualSvg.innerHTML = illustrations.cooler_flat;
  else if (cooler === "hdt") dom.visualSvg.innerHTML = illustrations.cooler_hdt;
  else if (cooler === "fullcover") dom.visualSvg.innerHTML = illustrations.cooler_fullcover;
  goToWizardStep("paste");
}

function selectPaste(paste) {
  state.paste = paste;
  goToWizardStep("review");
}

async function resolveAndShowSummary() {
  try {
    const res = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socket: state.socket,
        cooler: state.cooler,
        paste: state.paste,
      }),
    });
    const data = await res.json();
    state.comboId = data.combo_id || 1;
    state.curve = data.curve;

    const curve = data.curve;
    if (curve) {
      dom.sumProfileName.textContent = curve.name;
      dom.sumPeakTemp.textContent = `${Math.max(...curve.temps)}°C`;
      dom.sumReleaseTemp.textContent = `${curve.temps[curve.temps.length - 1]}°C`;
      dom.sumDuration.textContent = formatTime(curve.duration);
    }
  } catch (err) {
    console.error("Resolve error:", err);
  }
}

// =============================================================================
// SCREEN 2: ACTIVE TEMPERATURE LOCK
// =============================================================================

async function startHeatingCycle() {
  const simulate = dom.chkSim.checked;

  try {
    const res = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        combo_id: state.comboId,
        simulate: simulate,
        speed_factor: 1.0,
      }),
    });
    const data = await res.json();
    state.session = data;
    state.peakTemp = 0;
    state.history = [];

    switchView("view-active");
    dom.stopwatchContainer.classList.remove("hidden");

    startTelemetryPolling();
  } catch (err) {
    alert("Could not start heating cycle: " + err.message);
  }
}

function startTelemetryPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollTelemetry, 250);
  pollTelemetry();
}

async function pollTelemetry() {
  try {
    const res = await fetch("/api/status");
    const st = await res.json();
    state.session = st;

    if (st.current_temp > state.peakTemp) {
      state.peakTemp = st.current_temp;
    }

    // Top Header
    dom.swTime.textContent = formatTime(st.elapsed);
    dom.swTotal.textContent = formatTime(st.duration);
    dom.swStageBadge.textContent = st.stage || "Hold";
    dom.swRemaining.textContent = `${formatTime(st.remaining)} left`;
    dom.hwSensorTemp.textContent = `${st.current_temp.toFixed(1)}°C`;

    // Active Left Pane
    dom.actStageStep.textContent = `Stage ${st.stage_idx || 1} of 6 \u00b7 ${st.stage}`;
    dom.actStageTitle.textContent = st.stage_title || "Heating";
    dom.actDynamicCopy.textContent = st.dynamic_status || "Modulating load...";
    dom.actUserAction.textContent = st.stage_action || "Keep cooler secured.";

    // Metric Digits
    dom.actCurTemp.textContent = st.current_temp.toFixed(1);
    dom.actTgtTemp.textContent = st.target_temp.toFixed(1);
    dom.actLoadVal.textContent = st.load_pct.toFixed(0);

    // Render Canvas Chart
    state.history = st.history || [];
    drawCleanChart(dom.telemetryCanvas, st, state.history);

    // Completion / Abort
    if (st.finished) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      handleFinished(st);
    } else if (st.aborted) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      alert(`Cycle stopped: ${st.abort_reason || "Stopped"}`);
      restartToWizard();
    }
  } catch (err) {
    console.error("Telemetry poll error:", err);
  }
}

async function abortCycle() {
  if (confirm("Stop heating? CPU load will immediately drop to 0%.")) {
    try {
      await fetch("/api/stop", { method: "POST" });
      if (state.pollTimer) clearInterval(state.pollTimer);
      restartToWizard();
    } catch (err) {
      alert("Abort failed: " + err.message);
    }
  }
}

function handleFinished(st) {
  switchView("view-completed");
  dom.stopwatchContainer.classList.add("hidden");

  dom.finPeak.textContent = `${state.peakTemp.toFixed(1)}°C`;
  dom.finFinal.textContent = `${st.current_temp.toFixed(1)}°C`;
  dom.finDur.textContent = formatTime(st.duration);
}

// =============================================================================
// SCREEN 3: SHUTDOWN
// =============================================================================

async function triggerPoweroff() {
  if (!confirm("Shut down computer now?")) {
    return;
  }

  dom.shutdownStatusText.classList.remove("hidden");
  dom.shutdownStatusText.textContent = "Shutting down system...";

  try {
    const res = await fetch("/api/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: false }),
    });
    const data = await res.json();
    dom.shutdownStatusText.textContent = data.message || "Poweroff command sent.";
  } catch (err) {
    dom.shutdownStatusText.textContent = `Shutdown error: ${err.message}`;
  }
}

// =============================================================================
// CANVAS CHART
// =============================================================================

function drawCleanChart(canvas, st, history) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 15, right: 20, bottom: 25, left: 35 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const duration = st.duration || 360;
  const minTemp = 20;
  const maxTemp = 80;

  const toX = (t) => pad.left + (t / duration) * plotW;
  const toY = (temp) => pad.top + plotH - ((temp - minTemp) / (maxTemp - minTemp)) * plotH;

  // Horizontal Grid Lines
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  for (let t = 30; t <= 70; t += 20) {
    const y = toY(t);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = "#71717a";
    ctx.font = "11px 'JetBrains Mono', monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${t}°C`, pad.left - 6, y + 4);
  }

  // Target Curve (Dashed line)
  const curve = st.curve;
  if (curve && curve.times && curve.times.length) {
    ctx.beginPath();
    ctx.moveTo(toX(curve.times[0]), toY(curve.temps[0]));
    for (let i = 1; i < curve.times.length; i++) {
      ctx.lineTo(toX(curve.times[i]), toY(curve.temps[i]));
    }
    ctx.strokeStyle = "#71717a";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Actual Temperature Line
  if (history.length > 1) {
    ctx.beginPath();
    ctx.moveTo(toX(history[0].t), toY(history[0].temp));
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(toX(history[i].t), toY(history[i].temp));
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    const cur = history[history.length - 1];
    ctx.beginPath();
    ctx.arc(toX(cur.t), toY(cur.temp), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  // Scrubber Line
  const scrubX = toX(st.elapsed);
  ctx.beginPath();
  ctx.moveTo(scrubX, pad.top);
  ctx.lineTo(scrubX, pad.top + plotH);
  ctx.strokeStyle = "#3f3f46";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// =============================================================================
// HELPERS
// =============================================================================

function switchView(viewId) {
  document.querySelectorAll(".view-panel").forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");
}

function restartToWizard() {
  switchView("view-wizard");
  dom.stopwatchContainer.classList.add("hidden");
  goToWizardStep("cooler");
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
