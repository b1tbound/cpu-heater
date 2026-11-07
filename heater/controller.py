"""Closed-loop PID thermal controller, safety guards, and stage narration."""
from __future__ import annotations

import collections
import logging
import threading
import time
from typing import Callable, Optional

from heater.curves import Curve
from heater.hardware import Sensor, find_sensor
from heater.stresser import SimulatedSensor, StressEngine

logger = logging.getLogger("heater.controller")

# Detailed explanations for each phase of the warming cycle
STAGE_GUIDES = {
    "Start": {
        "title": "Baseline & System Initialization",
        "badge": "Phase 0 · Calibration",
        "description": "Checking baseline idle temperature and sensor responsiveness. Preparing worker threads for controlled thermal activation.",
        "action": "Ensure chassis fans are running normally and cooler retention screws or clips are still fully secured.",
    },
    "Ramp": {
        "title": "Controlled Thermal Ramp",
        "badge": "Phase 1 · Thermal Activation",
        "description": "Gradually increasing CPU execution intensity. Heat begins conducting through the integrated heat spreader (IHS) into the cooler coldplate.",
        "action": "Do not touch or unlatch the cooler yet. Let the heat penetrate the thermal interface layer uniformly.",
    },
    "Soak": {
        "title": "Thermal Soak & Penetration",
        "badge": "Phase 2 · Heat Penetration",
        "description": "Deep heat soaking into the cooler baseplate and mounting hardware. The carrier oils in high-viscosity paste begin softening.",
        "action": "The coldplate is absorbing thermal energy. Internal paste tension is breaking down.",
    },
    "Peak": {
        "title": "Peak Viscosity Breakdown",
        "badge": "Phase 3 · Maximum Fluidity",
        "description": "Reaching maximum target conditioning temperature. Thermal paste viscosity drops to its fluid state; phase-change pads liquefy past their phase threshold.",
        "action": "Thermal bond is at maximum elasticity. The controller maintains safe limits below silicon throttle caps.",
    },
    "Hold": {
        "title": "Saturation & Stress Relaxation",
        "badge": "Phase 4 · Thermal Equilibrium",
        "description": "Stabilizing heat throughout the copper coldplate, heatpipes, and socket retention bracket to ensure zero cold-sticking spots.",
        "action": "Preparing for cooling down into the safe touch-handling temperature range.",
    },
    "Cut Load": {
        "title": "Load Cut & Convective Cool-Down",
        "badge": "Phase 5 · Controlled Decay",
        "description": "CPU stresser cut to 0% idle load. Fan airflow and natural thermal dissipation steadily bring temperature down to the safe touch-and-twist zone.",
        "action": "Prepare your screwdriver or latch release tools. The system will be ready for shutdown shortly.",
    },
    "Touch & Twist": {
        "title": "Safe Touch & Twist Window",
        "badge": "Phase 6 · Ready for Removal",
        "description": "Thermal paste is soft, fluid, and safe to separate without damaging socket pins or ripping out PGA CPUs. Complete cycle achieved!",
        "action": "Shut down the PC using the button below, switch off the PSU, unlatch cooler, and GENTLY TWIST clockwise and counter-clockwise before lifting!",
    },
}


class ThermalPID:
    """PID controller with low-pass derivative filtering, deadband, and slew-rate limiting."""

    def __init__(
        self,
        kp: float = 0.045,
        ki: float = 0.008,
        kd: float = 0.090,
        filter_tau: float = 0.8,
        deadband: float = 0.5,
        max_slew_up: float = 0.15,    # Max 15% load increase per second
        max_slew_down: float = 0.25,  # Max 25% load decrease per second
    ):
        self.kp = kp
        self.ki = ki
        self.kd = kd
        self.filter_tau = filter_tau
        self.deadband = deadband
        self.max_slew_up = max_slew_up
        self.max_slew_down = max_slew_down

        self.integral = 0.0
        self.last_load = 0.0
        self.filtered_temp: float | None = None
        self.last_filtered_temp: float | None = None
        self.last_time = time.time()

    def reset(self):
        self.integral = 0.0
        self.last_load = 0.0
        self.filtered_temp = None
        self.last_filtered_temp = None
        self.last_time = time.time()

    def update(self, current: float, target: float, dt: float | None = None) -> tuple[float, float, float, float]:
        now = time.time()
        if dt is None:
            dt = max(0.05, min(2.0, now - self.last_time))
        self.last_time = now

        # Low-pass filter measured temperature to eliminate sensor quantization noise & jitter
        if self.filtered_temp is None:
            self.filtered_temp = current
            self.last_filtered_temp = current

        alpha = dt / (dt + self.filter_tau)
        self.filtered_temp += alpha * (current - self.filtered_temp)

        error = target - self.filtered_temp

        # Deadband handling: smooth quadratic attenuation inside deadband to avoid hunting
        if abs(error) <= self.deadband:
            effective_error = (error / self.deadband) * (abs(error) / self.deadband) * self.deadband
        else:
            effective_error = error

        # Proportional term
        p = self.kp * effective_error

        # Integral term with anti-windup clamping
        # Only integrate when error is within reasonable window to prevent windup
        if abs(error) < 14.0:
            self.integral += self.ki * effective_error * dt
            self.integral = max(0.0, min(0.85, self.integral))
        i = self.integral

        # Derivative term: calculated on process variable (negative dT/dt)
        # Prevents derivative kick and acts as an anticipatory brake on thermal momentum
        d_temp = (self.filtered_temp - self.last_filtered_temp) / dt if dt > 0 else 0.0
        self.last_filtered_temp = self.filtered_temp
        d = -self.kd * d_temp

        # Feedforward baseline: gentle thermal support if target > ambient
        ff = max(0.0, min(0.30, 0.005 * (target - 28.0))) if target > 32.0 else 0.0

        raw_output = p + i + d + ff
        clamped_output = max(0.0, min(1.0, raw_output))

        # Slew-rate limiter: prevents bang-bang oscillation and thermal hunting
        if raw_output <= 0.0:
            # Immediate drop to 0% if target is far below current (cooling or emergency)
            load = 0.0
        else:
            # Allow faster ramp when far below target
            slew_up = (self.max_slew_up * 2.5 if error > 6.0 else self.max_slew_up) * dt
            slew_down = (self.max_slew_down * 2.0 if error < -3.0 else self.max_slew_down) * dt

            if clamped_output > self.last_load:
                load = min(clamped_output, self.last_load + slew_up)
            else:
                load = max(clamped_output, self.last_load - slew_down)

        load = max(0.0, min(1.0, load))
        self.last_load = load
        return load, p, i, d


class ThermalCycleSession:
    """Controls an active thermal cycle session, running a background regulation thread."""

    def __init__(
        self,
        curve: Curve,
        sensor: Optional[Sensor] = None,
        stresser: Optional[StressEngine] = None,
        simulate: bool = False,
        speed_factor: float = 1.0,  # 1.0 for real time, higher for fast test runs
    ):
        self.curve = curve
        self.simulate = simulate
        self.speed_factor = max(0.1, float(speed_factor))

        if simulate or sensor is None:
            self.sensor = SimulatedSensor(ambient=27.0)
            self.is_simulated = True
        else:
            self.sensor = sensor
            self.is_simulated = False

        self.stresser = stresser or StressEngine()
        self.pid = ThermalPID()

        self.is_running = False
        self.is_finished = False
        self.is_aborted = False
        self.abort_reason: Optional[str] = None

        self.start_wall_time = 0.0
        self.elapsed_seconds = 0.0
        self.current_temp = 0.0
        self.target_temp = 0.0
        self.current_load = 0.0
        self.current_stage = "Start"
        self.current_stage_idx = 0
        self.stage_note = ""
        self.dynamic_status = "Initializing..."

        # Live history for charting (stores last 600 data points)
        self.history = collections.deque(maxlen=600)

        self._thread: Optional[threading.Thread] = None
        self._stop_requested = threading.Event()
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            if self.is_running:
                return
            self.is_running = True
            self.is_finished = False
            self.is_aborted = False
            self.abort_reason = None
            self._stop_requested.clear()
            self.start_wall_time = time.time()
            self.elapsed_seconds = 0.0
            self.pid.reset()
            self.history.clear()

            if not self.is_simulated:
                self.stresser.start()

            self._thread = threading.Thread(target=self._run_loop, daemon=True, name="thermal-controller")
            self._thread.start()

    def stop(self, reason: str = "User stopped session"):
        with self._lock:
            if not self.is_running:
                return
            self._stop_requested.set()
            self.is_aborted = True
            self.abort_reason = reason
            self.dynamic_status = f"Stopped: {reason}"

        if not self.is_simulated:
            self.stresser.set_load(0.0)
            self.stresser.stop()

        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.5)
        self.is_running = False

    def get_status(self) -> dict:
        with self._lock:
            remaining = max(0.0, self.curve.duration - self.elapsed_seconds)
            progress_pct = min(100.0, (self.elapsed_seconds / self.curve.duration) * 100.0) if self.curve.duration else 100.0
            guide = STAGE_GUIDES.get(self.current_stage, STAGE_GUIDES["Start"])

            return {
                "running": self.is_running,
                "finished": self.is_finished,
                "aborted": self.is_aborted,
                "abort_reason": self.abort_reason,
                "simulated": self.is_simulated,
                "elapsed": round(self.elapsed_seconds, 1),
                "remaining": round(remaining, 1),
                "duration": self.curve.duration,
                "progress_pct": round(progress_pct, 1),
                "current_temp": round(self.current_temp, 1),
                "target_temp": round(self.target_temp, 1),
                "temp_error": round(self.current_temp - self.target_temp, 1),
                "load_pct": round(self.current_load * 100.0, 1),
                "stage": self.current_stage,
                "stage_idx": self.current_stage_idx,
                "stage_note": self.stage_note,
                "stage_title": guide["title"],
                "stage_badge": guide["badge"],
                "stage_description": guide["description"],
                "stage_action": guide["action"],
                "dynamic_status": self.dynamic_status,
                "curve": self.curve.to_dict(),
                "history": list(self.history)[-120:],  # last 2 minutes for light payloads
            }

    def _determine_stage_info(self, t: float) -> tuple[str, int, str]:
        """Returns (stage_label, stage_idx, note) for elapsed time t."""
        idx = self.curve.stage_index(t)
        # curves labels list: 0 -> Start, 1 -> Ramp, 2 -> Soak, 3 -> Peak, 4 -> Hold, 5 -> Cut Load, 6 -> Touch & Twist
        label = self.curve.labels[idx] if idx < len(self.curve.labels) else "Touch & Twist"
        note = self.curve.notes[idx] if idx < len(self.curve.notes) else ""
        return label, idx, note

    def _format_dynamic_copy(self, stage: str, temp_diff: float, target: float, current: float, load_pct: float) -> str:
        if stage == "Cut Load":
            return f"Thermal soak completed. CPU load cut to 0% idle — cooling toward safe Touch & Twist temperature ({round(target, 1)}°C)."
        if stage == "Touch & Twist":
            return f"Target temperature reached ({round(current, 1)}°C). Paste is warm and fluid. Ready for system shutdown and cooler removal."
        if abs(temp_diff) <= 1.2:
            return f"Locked on target ({round(target, 1)}°C). Modulating load at {round(load_pct)}% to sustain thermal equilibrium."
        if temp_diff < -1.2:
            return f"Below target by {round(abs(temp_diff), 1)}°C. Elevating load to {round(load_pct)}% to ramp temperature upward."
        return f"Exceeding target by {round(temp_diff, 1)}°C. Throttling load to {round(load_pct)}% to let cooler dissipate heat."

    def _run_loop(self):
        last_tick = time.time()
        err_consecutive = 0

        try:
            while not self._stop_requested.is_set():
                now = time.time()
                real_dt = now - last_tick
                last_tick = now
                scaled_dt = real_dt * self.speed_factor

                self.elapsed_seconds += scaled_dt
                if self.elapsed_seconds >= self.curve.duration:
                    self.elapsed_seconds = self.curve.duration

                # Calculate target temp from curve
                tgt = self.curve.target(self.elapsed_seconds)
                self.target_temp = tgt
                stage_label, stage_idx, note = self._determine_stage_info(self.elapsed_seconds)
                self.current_stage = stage_label
                self.current_stage_idx = stage_idx
                self.stage_note = note

                # Read temperature
                try:
                    if self.is_simulated and isinstance(self.sensor, SimulatedSensor):
                        cur_temp = self.sensor.update(self.current_load, dt=scaled_dt)
                    else:
                        cur_temp = self.sensor.read()
                    err_consecutive = 0
                except Exception as ex:
                    err_consecutive += 1
                    logger.warning(f"Sensor read failure ({err_consecutive}): {ex}")
                    if err_consecutive >= 4:
                        self.stop("Hardware temperature sensor stopped responding. Aborted for safety.")
                        break
                    cur_temp = self.current_temp or 30.0

                self.current_temp = cur_temp

                # Safety guard: maximum absolute temperature cutoff (85°C)
                if cur_temp > 85.0:
                    self.stop(f"EMERGENCY CUTOFF: CPU temperature ({cur_temp:.1f}°C) exceeded 85°C limit!")
                    break

                # Safety guard: runaway threshold (+14°C above target if target > 40°C)
                if tgt > 40.0 and (cur_temp - tgt) > 14.0:
                    self.stop(f"SAFETY TRIP: Temperature ({cur_temp:.1f}°C) exceeded target ({tgt:.1f}°C) by over 14°C.")
                    break

                # Determine load
                if stage_label in ("Cut Load", "Touch & Twist") or self.curve.no_heat:
                    # In Cut Load / Touch & Twist, force 0% stresser load
                    target_load = 0.0
                    self.pid.reset()
                else:
                    target_load, _, _, _ = self.pid.update(cur_temp, tgt, dt=scaled_dt)

                self.current_load = target_load
                if not self.is_simulated:
                    self.stresser.set_load(target_load)

                # Formulate dynamic status copy
                temp_diff = cur_temp - tgt
                self.dynamic_status = self._format_dynamic_copy(
                    stage_label, temp_diff, tgt, cur_temp, target_load * 100.0
                )

                # Record history point
                self.history.append({
                    "t": round(self.elapsed_seconds, 1),
                    "temp": round(cur_temp, 1),
                    "target": round(tgt, 1),
                    "load": round(target_load * 100.0, 1),
                })

                # Check completion
                if self.elapsed_seconds >= self.curve.duration:
                    with self._lock:
                        self.is_finished = True
                        self.is_running = False
                        self.dynamic_status = "Cycle complete! System ready for shutdown and cooler twist removal."
                    if not self.is_simulated:
                        self.stresser.set_load(0.0)
                        self.stresser.stop()
                    break

                # Wait before next sample / control tick (200ms)
                time.sleep(0.2)

        finally:
            if not self.is_simulated:
                try:
                    self.stresser.set_load(0.0)
                    self.stresser.stop()
                except Exception:
                    pass
            self.is_running = False
