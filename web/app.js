/**
 * CPU HEATER · Terminal Client Script
 * Zero-gradient brutalist UI with autoscan hardware probe animation,
 * step-by-step interactive questionnaire, and clean telemetry chart.
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
  scanFinished: false,
};

const dom = {
  // Screens
  viewAutoscan: document.getElementById("view-autoscan"),
  viewWizard: document.getElementById("view-wizard"),
  viewActive: document.getElementById("view-active"),
  viewCompleted: document.getElementById("view-completed"),

  // Topbar
  stopwatchContainer: document.getElementById("stopwatch-container"),
  swTime: document.getElementById("sw-time"),
  swTotal: document.getElementById("sw-total"),
  swStageBadge: document.getElementById("sw-stage-badge"),
  hwSensorPill: document.getElementById("hw-sensor-pill"),

  // Autoscan
  scanLogFeed: document.getElementById("scan-log-feed"),
  scanFill: document.getElementById("scan-progress-fill"),

  // Wizard
  wizStepTag: document.getElementById("wiz-step-tag"),
  promptSocketDetected: document.getElementById("prompt-socket-detected"),
  reviewProfileSummary: document.getElementById("review-profile-summary"),
  sumCombo: document.getElementById("sum-combo"),
  sumPeak: document.getElementById("sum-peak"),
  sumRelease: document.getElementById("sum-release"),
  sumDuration: document.getElementById("sum-duration"),
  chkSim: document.getElementById("chk-sim"),

  // Active
  actStageTag: document.getElementById("act-stage-tag"),
  actLockStatus: document.getElementById("act-lock-status"),
  actStageTitle: document.getElementById("act-stage-title"),
  actDynamicCopy: document.getElementById("act-dynamic-copy"),
  actUserAction: document.getElementById("act-user-action"),
  actCurTemp: document.getElementById("act-cur-temp"),
  actTgtTemp: document.getElementById("act-tgt-temp"),
  actLoadVal: document.getElementById("act-load-val"),
  barCurTemp: document.getElementById("bar-cur-temp"),
  barTgtTemp: document.getElementById("bar-tgt-temp"),
  barLoadVal: document.getElementById("bar-load-val"),
  canvas: document.getElementById("clean-telemetry-canvas"),

  // Completed
  finPeak: document.getElementById("fin-peak"),
  finFinal: document.getElementById("fin-final"),
  finDur: document.getElementById("fin-dur"),
  shutdownStatusText: document.getElementById("shutdown-status-text"),
};

// =============================================================================
// INIT & KEYBOARD CONTROLS
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  setupKeyboardShortcuts();
  runAutoscanSequence();
});

function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (e) => {
    // If on scan screen, Enter skips
    if (!state.scanFinished && dom.viewAutoscan.classList.contains("active")) {
      if (e.key === "Enter" || e.key === " ") {
        completeScan();
        return;
      }
    }

    // Number hotkeys for wizard options [1, 2, 3]
    if (dom.viewWizard.classList.contains("active")) {
      const activeStep = document.querySelector(".step-pane.active");
      if (activeStep) {
        const id = activeStep.id;
        if (id === "step-pane-1") {
          if (e.key === "1") selectSocket("pga");
          if (e.key === "2") selectSocket("lga");
          if (e.key === "3") selectSocket("hedt");
        } else if (id === "step-pane-2") {
          if (e.key === "1") selectCooler("flat");
          if (e.key === "2") selectCooler("hdt");
          if (e.key === "3") selectCooler("fullcover");
        } else if (id === "step-pane-3") {
          if (e.key === "1") selectPaste("low");
          if (e.key === "2") selectPaste("high");
          if (e.key === "3") selectPaste("pcm");
        } else if (id === "step-pane-4") {
          if (e.key === "Enter") startHeatingCycle();
        }
      }
    }
  });
}

// =============================================================================
// SCREEN 0: AUTOSCAN PROBE ANIMATION
// =============================================================================

async function runAutoscanSequence() {
  const logs = [
    { text: "> Probing CPU registers & /proc/cpuinfo...", pct: 15, delay: 250 },
    { text: "> Reading socket physical topology...", pct: 35, delay: 350 },
    { text: "> Inspecting Linux /sys/class/hwmon thermal controllers...", pct: 60, delay: 300 },
    { text: "> Querying k10temp, coretemp, and ACPI zones...", pct: 85, delay: 300 },
    { text: "> Hardware probe complete.", pct: 100, delay: 200 },
  ];

  let fetchPromise = fetch("/api/detect").then((r) => r.json()).catch(() => null);

  for (let step of logs) {
    if (state.scanFinished) break;
    appendLog(step.text);
    dom.scanFill.style.width = `${step.pct}%`;
    await sleep(step.delay);
  }

  const data = await fetchPromise;
  if (data) {
    state.detectData = data;
    const cpu = data.cpu || {};
    const sock = cpu.socket || {};
    const sensor = data.sensor || {};
    const temp = data.sensor_temp || 30.0;

    appendLog(`> DETECTED CPU: ${cpu.model || "Unknown"} (${cpu.cores}C/${cpu.threads}T)`, "log-highlight");
    appendLog(`> DETECTED SOCKET: ${sock.socket || "Unknown"} [${(sock.class || "PGA").toUpperCase()}]`, "log-highlight");
    if (sock.class === "pga") {
      appendLog(`> WARNING: PGA socket detected! Cold paste pull-out hazard active.`, "log-warn");
    }
    appendLog(`> ACTIVE SENSOR: ${sensor.name} @ ${temp.toFixed(1)}°C`, "log-highlight");

    dom.hwSensorPill.textContent = `${sensor.name}: ${temp.toFixed(1)}°C`;

    // Preselect detected socket
    const sockClass = (sock.class || "pga").toLowerCase();
    if (["pga", "lga", "hedt"].includes(sockClass)) {
      state.socket = sockClass;
      dom.promptSocketDetected.textContent = `> Auto-detected: ${cpu.model} sits in an ${sock.socket} (${sock.class.toUpperCase()}) socket.`;
    }
  }

  await sleep(600);
  completeScan();
}

function appendLog(line, className = "") {
  const el = document.createElement("div");
  el.className = "log-line" + (className ? " " + className : "");
  el.textContent = line;
  dom.scanLogFeed.appendChild(el);
  dom.scanLogFeed.scrollTop = dom.scanLogFeed.scrollHeight;
}

function completeScan() {
  if (state.scanFinished) return;
  state.scanFinished = true;
  switchScreen("view-wizard");
  goToWizardStep(1);
}

// =============================================================================
// SCREEN 1: STEP-BY-STEP QUESTIONNAIRE
// =============================================================================

function goToWizardStep(step) {
  dom.wizStepTag.textContent = `STEP ${step} OF 3`;
  for (let i = 1; i <= 4; i++) {
    const pane = document.getElementById(`step-pane-${i}`);
    if (pane) {
      if (i === step) pane.classList.add("active");
      else pane.classList.remove("active");
    }
  }

  if (step === 4) {
    dom.wizStepTag.textContent = `CONFIRMATION`;
    resolveAndShowSummary();
  }
}

function selectSocket(sock) {
  state.socket = sock;
  goToWizardStep(2);
}

function selectCooler(cooler) {
  state.cooler = cooler;
  goToWizardStep(3);
}

function selectPaste(paste) {
  state.paste = paste;
  goToWizardStep(4);
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
      dom.reviewProfileSummary.textContent = `> Resolved Profile: Combo #${curve.id} — ${curve.name}`;
      dom.sumCombo.textContent = `Combo #${curve.id} (${curve.name})`;
      dom.sumPeak.textContent = `${Math.max(...curve.temps)}°C`;
      dom.sumRelease.textContent = `${curve.temps[curve.temps.length - 1]}°C (Touch & Twist)`;
      dom.sumDuration.textContent = formatTime(curve.duration);
    }
  } catch (err) {
    console.error("Resolve error:", err);
  }
}

// =============================================================================
// SCREEN 2: ACTIVE STRESSER & TELEMETRY
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

    // Switch screen to active
    switchScreen("view-active");
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

    // Top Stopwatch
    dom.swTime.textContent = formatTime(st.elapsed);
    dom.swTotal.textContent = formatTime(st.duration);
    dom.swStageBadge.textContent = `[${(st.stage || "HOLD").toUpperCase()}]`;
    dom.hwSensorPill.textContent = `SENSOR: ${st.current_temp.toFixed(1)}°C`;

    // Active Dashboard Texts
    dom.actStageTag.textContent = `STAGE ${st.stage_idx || 1}/6: ${(st.stage || "").toUpperCase()}`;
    dom.actLockStatus.textContent = Math.abs(st.temp_error) <= 1.2 ? "[ TARGET LOCKED ]" : "[ REGULATING LOAD ]";
    dom.actLockStatus.style.color = Math.abs(st.temp_error) <= 1.2 ? "var(--accent-green)" : "var(--accent-cyan)";

    dom.actStageTitle.textContent = (st.stage_title || "THERMAL REGULATION").toUpperCase();
    dom.actDynamicCopy.textContent = `> ${st.dynamic_status || "Modulating thermal load..."}`;
    dom.actUserAction.textContent = st.stage_action || "Keep cooler secured.";

    // Metric digits
    dom.actCurTemp.textContent = st.current_temp.toFixed(1);
    dom.actTgtTemp.textContent = st.target_temp.toFixed(1);
    dom.actLoadVal.textContent = st.load_pct.toFixed(0);

    // Meters
    const curPct = Math.min(100, Math.max(0, ((st.current_temp - 20) / 65) * 100));
    const tgtPct = Math.min(100, Math.max(0, ((st.target_temp - 20) / 65) * 100));
    dom.barCurTemp.style.width = `${curPct}%`;
    dom.barTgtTemp.style.width = `${tgtPct}%`;
    dom.barLoadVal.style.width = `${st.load_pct}%`;

    // Draw clean chart
    state.history = st.history || [];
    drawCleanChart(dom.canvas, st, state.history);

    // End conditions
    if (st.finished) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      handleFinished(st);
    } else if (st.aborted) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      alert(`Heating cycle aborted: ${st.abort_reason || "User stopped"}`);
      restartToWizard();
    }
  } catch (err) {
    console.error("Telemetry error:", err);
  }
}

async function abortCycle() {
  if (confirm("ABORT HEATING CYCLE? CPU load will instantly drop to 0%.")) {
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
  switchScreen("view-completed");
  dom.stopwatchContainer.classList.add("hidden");

  dom.finPeak.textContent = `${state.peakTemp.toFixed(1)}°C`;
  dom.finFinal.textContent = `${st.current_temp.toFixed(1)}°C`;
  dom.finDur.textContent = formatTime(st.duration);
}

// =============================================================================
// SCREEN 3: COMPLETION & SHUTDOWN
// =============================================================================

async function triggerPoweroff() {
  if (!confirm("EXECUTE IMMEDIATE SYSTEM SHUTDOWN NOW?\nSave all other work before proceeding.")) {
    return;
  }

  dom.shutdownStatusText.classList.remove("hidden");
  dom.shutdownStatusText.textContent = "> Sending system poweroff command (systemctl poweroff / shutdown)...";

  try {
    const res = await fetch("/api/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: false }),
    });
    const data = await res.json();
    dom.shutdownStatusText.textContent = `> ${data.message || "Poweroff signal sent."}`;
  } catch (err) {
    dom.shutdownStatusText.textContent = `> Poweroff error: ${err.message}`;
  }
}

// =============================================================================
// BRUTALIST MONOCHROME TELEMETRY CHART
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
  const pad = { top: 15, right: 25, bottom: 20, left: 35 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const duration = st.duration || 360;
  const minTemp = 20;
  const maxTemp = 80;

  const toX = (t) => pad.left + (t / duration) * plotW;
  const toY = (temp) => pad.top + plotH - ((temp - minTemp) / (maxTemp - minTemp)) * plotH;

  // Horizontal Grid Lines
  ctx.strokeStyle = "#1a1a1a";
  ctx.lineWidth = 1;
  for (let t = 30; t <= 70; t += 20) {
    const y = toY(t);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = "#444444";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${t}°C`, pad.left - 4, y + 3);
  }

  // Target Curve (Cyan Dashed)
  const curve = st.curve;
  if (curve && curve.times && curve.times.length) {
    ctx.beginPath();
    ctx.moveTo(toX(curve.times[0]), toY(curve.temps[0]));
    for (let i = 1; i < curve.times.length; i++) {
      ctx.lineTo(toX(curve.times[i]), toY(curve.temps[i]));
    }
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Load Bars (Orange outline / low alpha)
  if (history.length > 1) {
    ctx.beginPath();
    ctx.moveTo(toX(history[0].t), pad.top + plotH);
    for (let i = 0; i < history.length; i++) {
      const loadH = (history[i].load / 100) * (plotH * 0.35);
      ctx.lineTo(toX(history[i].t), pad.top + plotH - loadH);
    }
    ctx.lineTo(toX(history[history.length - 1].t), pad.top + plotH);
    ctx.fillStyle = "rgba(255, 85, 0, 0.15)";
    ctx.fill();
  }

  // Actual Temperature Line (Solid Crisp White)
  if (history.length > 1) {
    ctx.beginPath();
    ctx.moveTo(toX(history[0].t), toY(history[0].temp));
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(toX(history[i].t), toY(history[i].temp));
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Cursor point
    const cur = history[history.length - 1];
    ctx.beginPath();
    ctx.arc(toX(cur.t), toY(cur.temp), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  // Vertical Scrubber Line
  const scrubX = toX(st.elapsed);
  ctx.beginPath();
  ctx.moveTo(scrubX, pad.top);
  ctx.lineTo(scrubX, pad.top + plotH);
  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 1;
  ctx.stroke();
}

// =============================================================================
// HELPERS
// =============================================================================

function switchScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = document.getElementById(screenId);
  if (target) target.classList.add("active");
}

function restartToWizard() {
  switchScreen("view-wizard");
  dom.stopwatchContainer.classList.add("hidden");
  goToWizardStep(1);
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
