/**
 * CPU HEATER · Web Application Controller
 * Handles hardware auto-detection, wizard profile resolution,
 * real-time telemetry polling, canvas rendering, and shutdown execution.
 */

// Application State
const state = {
  detectData: null,
  currentStep: 1,
  selectedSocket: "pga",
  selectedCooler: "flat",
  selectedPaste: "low",
  resolvedComboId: 1,
  resolvedCurve: null,
  activeSession: null,
  pollTimer: null,
  peakTempRecorded: 0,
  history: [],
};

// DOM References
const dom = {
  topStopwatch: document.getElementById("top-stopwatch"),
  swTime: document.getElementById("sw-time"),
  swTotalTime: document.getElementById("sw-total-time"),
  swStageName: document.getElementById("sw-stage-name"),
  swStageCountdown: document.getElementById("sw-stage-countdown"),
  headerSensorLabel: document.getElementById("header-sensor-label"),
  headerSensorTemp: document.getElementById("header-sensor-temp"),
  btnFullscreen: document.getElementById("btn-fullscreen"),

  // Views
  viewWizard: document.getElementById("view-wizard"),
  viewActive: document.getElementById("view-active"),
  viewCompleted: document.getElementById("view-completed"),

  // Auto-Detect Elements
  detCpuModel: document.getElementById("det-cpu-model"),
  detSocketBadge: document.getElementById("det-socket-badge"),
  detThreadsBadge: document.getElementById("det-threads-badge"),
  detSocketReason: document.getElementById("det-socket-reason"),
  detIdleTemp: document.getElementById("det-idle-temp"),
  detSensorName: document.getElementById("det-sensor-name"),
  pgaWarningBox: document.getElementById("pga-warning-box"),

  // Review Elements
  revComboId: document.getElementById("rev-combo-id"),
  revComboName: document.getElementById("rev-combo-name"),
  revPeakTemp: document.getElementById("rev-peak-temp"),
  revReleaseTemp: document.getElementById("rev-release-temp"),
  revTotalTime: document.getElementById("rev-total-time"),
  revStagePills: document.getElementById("rev-stage-pills"),
  previewCanvas: document.getElementById("preview-curve-canvas"),
  chkSimulate: document.getElementById("chk-simulate"),
  selSpeed: document.getElementById("sel-speed"),

  // Active Telemetry Elements
  actStageBadge: document.getElementById("act-stage-badge"),
  actNoteBadge: document.getElementById("act-note-badge"),
  actStageTitle: document.getElementById("act-stage-title"),
  actStageDesc: document.getElementById("act-stage-desc"),
  actDynamicCopy: document.getElementById("act-dynamic-copy"),
  actStageAction: document.getElementById("act-stage-action"),
  actLockStatus: document.getElementById("act-lock-status"),
  actCurrentTemp: document.getElementById("act-current-temp"),
  actTargetTemp: document.getElementById("act-target-temp"),
  actTempBar: document.getElementById("act-temp-bar"),
  actTargetBar: document.getElementById("act-target-bar"),
  actTempDelta: document.getElementById("act-temp-delta"),
  actSensorSource: document.getElementById("act-sensor-source"),
  actLoadPct: document.getElementById("act-load-pct"),
  actLoadBar: document.getElementById("act-load-bar"),
  actWorkerCount: document.getElementById("act-worker-count"),
  actPidDuty: document.getElementById("act-pid-duty"),
  liveCanvas: document.getElementById("live-telemetry-canvas"),

  // Completed Elements
  finPeakTemp: document.getElementById("fin-peak-temp"),
  finFinalTemp: document.getElementById("fin-final-temp"),
  finTotalTime: document.getElementById("fin-total-time"),
  finProfileName: document.getElementById("fin-profile-name"),
  modalShutdown: document.getElementById("modal-shutdown"),
  shutdownStatusMsg: document.getElementById("shutdown-status-msg"),
};

// =============================================================================
// INITIALIZATION
// =============================================================================

document.addEventListener("DOMContentLoaded", async () => {
  setupOptionListeners();
  setupFullscreen();
  await loadHardwareDetection();
  await resolveSelectedProfile();
});

// =============================================================================
// HARDWARE AUTO-DETECTION
// =============================================================================

async function loadHardwareDetection() {
  try {
    const res = await fetch("/api/detect");
    const data = await res.json();
    state.detectData = data;

    const cpu = data.cpu || {};
    const sock = cpu.socket || {};
    const sensor = data.sensor || {};
    const temp = data.sensor_temp || 30.0;

    // Populate auto-detect card
    dom.detCpuModel.textContent = cpu.model || "Unknown CPU";
    dom.detSocketBadge.textContent = `${sock.socket || "Unknown"} (${(sock.class || "PGA").toUpperCase()})`;
    dom.detThreadsBadge.textContent = `${cpu.cores || "?"}C / ${cpu.threads || "?"}T`;
    dom.detSocketReason.textContent = sock.reason || "Auto-detected CPU socket architecture.";
    dom.detIdleTemp.textContent = `${temp.toFixed(1)}°C`;
    dom.detSensorName.textContent = sensor.name || "Hardware Sensor";

    // Header sensor badge
    dom.headerSensorLabel.textContent = sensor.name || "CPU Sensor";
    dom.headerSensorTemp.textContent = `${temp.toFixed(1)}°C`;
    dom.actSensorSource.textContent = sensor.name || "Hardware Sensor";
    dom.actWorkerCount.textContent = `${cpu.threads || 8} Threads Active`;

    // Pre-select detected socket in wizard
    const sockClass = (sock.class || "pga").toLowerCase();
    if (["pga", "lga", "hedt"].includes(sockClass)) {
      state.selectedSocket = sockClass;
      const radio = document.querySelector(`input[name="opt-socket"][value="${sockClass}"]`);
      if (radio) {
        radio.checked = true;
        updateSelectedCardStyles();
      }
    }

    // Toggle PGA warning banner visibility
    updatePgaWarning();
  } catch (err) {
    console.error("Failed to load hardware detection:", err);
    dom.detCpuModel.textContent = "Hardware Detection Offline (Using Defaults)";
  }
}

function updatePgaWarning() {
  if (state.selectedSocket === "pga") {
    dom.pgaWarningBox.classList.remove("hidden");
  } else {
    dom.pgaWarningBox.classList.add("hidden");
  }
}

// =============================================================================
// WIZARD NAVIGATION & PROFILE RESOLUTION
// =============================================================================

function setupOptionListeners() {
  document.querySelectorAll('input[type="radio"]').forEach((radio) => {
    radio.addEventListener("change", async (e) => {
      const name = e.target.name;
      const val = e.target.value;

      if (name === "opt-socket") {
        state.selectedSocket = val;
        updatePgaWarning();
      } else if (name === "opt-cooler") {
        state.selectedCooler = val;
      } else if (name === "opt-paste") {
        state.selectedPaste = val;
      }

      updateSelectedCardStyles();
      await resolveSelectedProfile();
    });
  });

  // Stepper clicks
  document.querySelectorAll(".step-indicator").forEach((el) => {
    el.addEventListener("click", () => {
      const step = parseInt(el.dataset.step, 10);
      goToStep(step);
    });
  });
}

function updateSelectedCardStyles() {
  document.querySelectorAll(".option-card").forEach((card) => {
    const radio = card.querySelector('input[type="radio"]');
    if (radio && radio.checked) {
      card.classList.add("selected");
    } else {
      card.classList.remove("selected");
    }
  });
}

function goToStep(step) {
  state.currentStep = step;

  // Toggle step panels
  for (let i = 1; i <= 4; i++) {
    const p = document.getElementById(`wiz-step-${i}`);
    if (p) {
      if (i === step) p.classList.add("active");
      else p.classList.remove("active");
    }
  }

  // Update Stepper indicators
  document.querySelectorAll(".step-indicator").forEach((el) => {
    const s = parseInt(el.dataset.step, 10);
    el.classList.remove("active", "completed");
    if (s === step) el.classList.add("active");
    else if (s < step) el.classList.add("completed");
  });

  if (step === 4) {
    renderProfileReview();
  }
}

async function resolveSelectedProfile() {
  try {
    const res = await fetch("/api/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        socket: state.selectedSocket,
        cooler: state.selectedCooler,
        paste: state.selectedPaste,
      }),
    });
    const data = await res.json();
    if (data.exists && data.curve) {
      state.resolvedComboId = data.combo_id;
      state.resolvedCurve = data.curve;
      if (state.currentStep === 4) {
        renderProfileReview();
      }
    }
  } catch (err) {
    console.error("Failed to resolve profile:", err);
  }
}

function renderProfileReview() {
  const curve = state.resolvedCurve;
  if (!curve) return;

  dom.revComboId.textContent = `COMBO #${curve.id}`;
  dom.revComboName.textContent = curve.name;

  const peakTemp = Math.max(...curve.temps);
  const releaseTemp = curve.temps[curve.temps.length - 1];
  dom.revPeakTemp.textContent = `${peakTemp}°C`;
  dom.revReleaseTemp.textContent = `${releaseTemp}°C`;
  dom.revTotalTime.textContent = formatTime(curve.duration);

  // Render stage pills
  dom.revStagePills.innerHTML = "";
  for (let i = 0; i < curve.times.length; i++) {
    const pill = document.createElement("div");
    pill.className = "stage-pill-item";
    pill.innerHTML = `
      <div class="p-time">${formatTime(curve.times[i])}</div>
      <div class="p-temp">${curve.temps[i]}°C</div>
      <div class="p-note">${curve.notes[i] || curve.labels[i] || ""}</div>
    `;
    dom.revStagePills.appendChild(pill);
  }

  drawCurvePreview(dom.previewCanvas, curve);
}

// Draw static preview curve on canvas
function drawCurvePreview(canvas, curve) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 20, right: 30, bottom: 25, left: 40 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const duration = curve.duration || 360;
  const minTemp = Math.min(...curve.temps, 20) - 2;
  const maxTemp = Math.max(...curve.temps, 75) + 5;

  const toX = (t) => pad.left + (t / duration) * plotW;
  const toY = (temp) => pad.top + plotH - ((temp - minTemp) / (maxTemp - minTemp)) * plotH;

  // Grid lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  for (let temp = 30; temp <= 80; temp += 10) {
    if (temp >= minTemp && temp <= maxTemp) {
      const y = toY(temp);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${temp}°C`, pad.left - 6, y + 3);
    }
  }

  // Draw gradient fill under curve
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  grad.addColorStop(0, "rgba(255, 107, 53, 0.35)");
  grad.addColorStop(1, "rgba(255, 107, 53, 0.0)");

  ctx.beginPath();
  ctx.moveTo(toX(curve.times[0]), toY(curve.temps[0]));
  for (let i = 1; i < curve.times.length; i++) {
    ctx.lineTo(toX(curve.times[i]), toY(curve.temps[i]));
  }
  ctx.lineTo(toX(curve.times[curve.times.length - 1]), pad.top + plotH);
  ctx.lineTo(toX(curve.times[0]), pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw stroke
  ctx.beginPath();
  ctx.moveTo(toX(curve.times[0]), toY(curve.temps[0]));
  for (let i = 1; i < curve.times.length; i++) {
    ctx.lineTo(toX(curve.times[i]), toY(curve.temps[i]));
  }
  ctx.strokeStyle = "#ff6b35";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Draw points
  for (let i = 0; i < curve.times.length; i++) {
    const x = toX(curve.times[i]);
    const y = toY(curve.temps[i]);
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#ff6b35";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

// =============================================================================
// THERMAL CYCLE EXECUTION & POLLING
// =============================================================================

async function startThermalCycle() {
  const simulate = dom.chkSimulate.checked;
  const speed = parseFloat(dom.selSpeed.value) || 1.0;

  try {
    const res = await fetch("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        combo_id: state.resolvedComboId,
        simulate: simulate,
        speed_factor: speed,
      }),
    });
    const data = await res.json();
    state.activeSession = data;
    state.peakTempRecorded = 0;
    state.history = [];

    // Switch view to active telemetry
    switchView("view-active");
    dom.topStopwatch.classList.remove("hidden");
    dom.topStopwatch.classList.add("active-glow");

    // Begin telemetry poll loop (every 250ms)
    startTelemetryPolling();
  } catch (err) {
    alert("Could not start thermal cycle: " + err.message);
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
    state.activeSession = st;

    // Track peak temp
    if (st.current_temp > state.peakTempRecorded) {
      state.peakTempRecorded = st.current_temp;
    }

    // Header sensor update
    dom.headerSensorTemp.textContent = `${st.current_temp.toFixed(1)}°C`;

    // Stopwatch top bar update
    dom.swTime.textContent = formatTime(st.elapsed);
    dom.swTotalTime.textContent = formatTime(st.duration);
    dom.swStageName.textContent = (st.stage || "HOLD").toUpperCase();
    dom.swStageCountdown.textContent = `${formatTime(st.remaining)} remaining`;

    // Active View Telemetry
    dom.actStageBadge.textContent = st.stage_badge || "Phase Active";
    dom.actNoteBadge.textContent = st.stage_note || st.stage || "";
    dom.actStageTitle.textContent = st.stage_title || "Thermal Regulation";
    dom.actStageDesc.textContent = st.stage_description || "";
    dom.actDynamicCopy.textContent = st.dynamic_status || "Modulating thermal load...";
    dom.actStageAction.textContent = st.stage_action || "Maintain normal operation.";

    // Lock tag
    if (Math.abs(st.temp_error) <= 1.2) {
      dom.actLockStatus.textContent = "TARGET LOCKED";
      dom.actLockStatus.style.color = "var(--color-emerald)";
      dom.actLockStatus.style.background = "rgba(16, 185, 129, 0.15)";
    } else {
      dom.actLockStatus.textContent = "REGULATING LOAD";
      dom.actLockStatus.style.color = "var(--color-cyan)";
      dom.actLockStatus.style.background = "rgba(56, 189, 248, 0.15)";
    }

    // Telemetry Gauges
    dom.actCurrentTemp.textContent = st.current_temp.toFixed(1);
    dom.actTargetTemp.textContent = st.target_temp.toFixed(1);
    dom.actLoadPct.textContent = st.load_pct.toFixed(0);

    const tempPct = Math.min(100, Math.max(0, ((st.current_temp - 20) / 65) * 100));
    const tgtPct = Math.min(100, Math.max(0, ((st.target_temp - 20) / 65) * 100));
    dom.actTempBar.style.width = `${tempPct}%`;
    dom.actTargetBar.style.width = `${tgtPct}%`;
    dom.actLoadBar.style.width = `${st.load_pct}%`;

    const deltaSign = st.temp_error >= 0 ? "+" : "";
    dom.actTempDelta.textContent = `Error: ${deltaSign}${st.temp_error.toFixed(1)}°C`;
    dom.actTempDelta.style.color = Math.abs(st.temp_error) <= 1.5 ? "var(--color-emerald)" : "var(--color-amber)";

    // Update real-time chart
    state.history = st.history || [];
    drawLiveTelemetryChart(dom.liveCanvas, st, state.history);

    // Completion / Abort handlers
    if (st.finished) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      handleCycleFinished(st);
    } else if (st.aborted) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      alert(`Thermal cycle stopped: ${st.abort_reason || "User aborted"}`);
      resetToWizard();
    }
  } catch (err) {
    console.error("Telemetry poll error:", err);
  }
}

async function abortThermalCycle() {
  if (confirm("Are you sure you want to abort the heating cycle? CPU load will immediately drop to 0%.")) {
    try {
      await fetch("/api/stop", { method: "POST" });
      if (state.pollTimer) clearInterval(state.pollTimer);
      resetToWizard();
    } catch (err) {
      alert("Error stopping cycle: " + err.message);
    }
  }
}

function handleCycleFinished(st) {
  dom.topStopwatch.classList.remove("active-glow");
  switchView("view-completed");

  dom.finPeakTemp.textContent = `${state.peakTempRecorded.toFixed(1)}°C`;
  dom.finFinalTemp.textContent = `${st.current_temp.toFixed(1)}°C`;
  dom.finTotalTime.textContent = formatTime(st.duration);
  dom.finProfileName.textContent = st.curve ? st.curve.name : `Combo #${state.resolvedComboId}`;
}

// =============================================================================
// LIVE TELEMETRY CHART
// =============================================================================

function drawLiveTelemetryChart(canvas, st, history) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const pad = { top: 25, right: 35, bottom: 25, left: 45 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  const duration = st.duration || 360;
  const minTemp = 20;
  const maxTemp = 80;

  const toX = (t) => pad.left + (t / duration) * plotW;
  const toY = (temp) => pad.top + plotH - ((temp - minTemp) / (maxTemp - minTemp)) * plotH;

  // Grid
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let temp = 30; temp <= 70; temp += 10) {
    const y = toY(temp);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${temp}°C`, pad.left - 6, y + 3);
  }

  // Draw Reference Target Curve
  const curve = st.curve;
  if (curve && curve.times && curve.times.length) {
    ctx.beginPath();
    ctx.moveTo(toX(curve.times[0]), toY(curve.temps[0]));
    for (let i = 1; i < curve.times.length; i++) {
      ctx.lineTo(toX(curve.times[i]), toY(curve.temps[i]));
    }
    ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw Load Fill
  if (history.length > 1) {
    ctx.beginPath();
    ctx.moveTo(toX(history[0].t), pad.top + plotH);
    for (let i = 0; i < history.length; i++) {
      const loadH = (history[i].load / 100) * (plotH * 0.4);
      ctx.lineTo(toX(history[i].t), pad.top + plotH - loadH);
    }
    ctx.lineTo(toX(history[history.length - 1].t), pad.top + plotH);
    ctx.closePath();
    ctx.fillStyle = "rgba(245, 158, 11, 0.12)";
    ctx.fill();
  }

  // Draw Actual Temperature Line with glow
  if (history.length > 1) {
    ctx.beginPath();
    ctx.moveTo(toX(history[0].t), toY(history[0].temp));
    for (let i = 1; i < history.length; i++) {
      ctx.lineTo(toX(history[i].t), toY(history[i].temp));
    }
    ctx.strokeStyle = "#ff6b35";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(255, 107, 53, 0.6)";
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Draw current head point
    const latest = history[history.length - 1];
    const curX = toX(latest.t);
    const curY = toY(latest.temp);

    ctx.beginPath();
    ctx.arc(curX, curY, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#ff6b35";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // Draw Scrubber at current elapsed time
  const scrubX = toX(st.elapsed);
  ctx.beginPath();
  ctx.moveTo(scrubX, pad.top);
  ctx.lineTo(scrubX, pad.top + plotH);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

// =============================================================================
// SHUTDOWN CONTROLS
// =============================================================================

function confirmShutdown() {
  dom.shutdownStatusMsg.classList.add("hidden");
  dom.modalShutdown.classList.remove("hidden");
}

function closeShutdownModal() {
  dom.modalShutdown.classList.add("hidden");
}

async function executeShutdown(dryRun = false) {
  dom.shutdownStatusMsg.classList.remove("hidden");
  dom.shutdownStatusMsg.textContent = dryRun ? "Simulating system poweroff..." : "Executing poweroff command...";

  try {
    const res = await fetch("/api/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dry_run: dryRun }),
    });
    const data = await res.json();
    dom.shutdownStatusMsg.textContent = data.message || "Shutdown requested.";
    if (data.success && !dryRun) {
      dom.shutdownStatusMsg.textContent = "System is shutting down now. You can turn off your PSU switch once the screen goes dark.";
    }
  } catch (err) {
    dom.shutdownStatusMsg.textContent = "Error executing shutdown: " + err.message;
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function switchView(viewId) {
  document.querySelectorAll(".view-panel").forEach((v) => v.classList.remove("active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("active");
}

function resetToWizard() {
  switchView("view-wizard");
  dom.topStopwatch.classList.add("hidden");
  goToStep(1);
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function setupFullscreen() {
  dom.btnFullscreen.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Fullscreen error:", err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Exit fullscreen error:", err);
      });
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "F11") {
      e.preventDefault();
      dom.btnFullscreen.click();
    }
  });
}
