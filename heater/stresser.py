"""CPU stress generation and dynamic load control."""
from __future__ import annotations

import hashlib
import math
import multiprocessing as mp
import os
import signal
import subprocess
import time
from typing import Optional


def _cpu_worker(load_pct: mp.Value, stop_event: mp.Event, worker_id: int):
    """Worker process that modulates CPU load using duty-cycle pacing."""
    # Ignore SIGINT in worker; parent controls lifecycle
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    period = 0.05  # 50ms control slice
    data = b"thermal-paste-conditioner-" * 32

    while not stop_event.is_set():
        duty = float(load_pct.value)
        if duty <= 0.001:
            time.sleep(period)
            continue
        if duty >= 0.999:
            t_slice_end = time.perf_counter() + period
            while time.perf_counter() < t_slice_end:
                # Intensive math and hashing
                hashlib.sha256(data).digest()
                math.sin(12345.6789)
            continue

        work_duration = period * duty
        sleep_duration = period * (1.0 - duty)
        t_slice_end = time.perf_counter() + work_duration
        while time.perf_counter() < t_slice_end:
            hashlib.sha256(data).digest()
            math.sin(12345.6789)
        time.sleep(sleep_duration)


class StressEngine:
    """Manages multi-core load generation with real-time duty cycle adjustment."""

    def __init__(self, thread_count: Optional[int] = None):
        self.thread_count = thread_count or os.cpu_count() or 4
        self._ctx = mp.get_context("fork" if hasattr(os, "fork") else "spawn")
        self._load_val = self._ctx.Value("d", 0.0)
        self._stop_event = self._ctx.Event()
        self._processes: list[mp.Process] = []
        self._is_running = False

    @property
    def is_running(self) -> bool:
        return self._is_running

    @property
    def current_load(self) -> float:
        """Current target load fraction (0.0 to 1.0)."""
        return float(self._load_val.value)

    def start(self):
        if self._is_running:
            return
        self._stop_event.clear()
        self._load_val.value = 0.0
        self._processes = []
        for i in range(self.thread_count):
            p = self._ctx.Process(
                target=_cpu_worker,
                args=(self._load_val, self._stop_event, i),
                daemon=True,
                name=f"heater-worker-{i}",
            )
            p.start()
            self._processes.append(p)
        self._is_running = True

    def set_load(self, load_pct: float):
        """Set dynamic target load, clamped between 0.0 and 1.0."""
        clamped = max(0.0, min(1.0, float(load_pct)))
        self._load_val.value = clamped

    def stop(self):
        if not self._is_running:
            return
        self._stop_event.set()
        self._load_val.value = 0.0
        for p in self._processes:
            p.join(timeout=0.5)
            if p.is_alive():
                try:
                    os.kill(p.pid, signal.SIGKILL)
                except OSError:
                    pass
        self._processes.clear()
        self._is_running = False


class SimulatedSensor:
    """Thermal response model for safe demo/testing and calibration."""

    def __init__(self, ambient: float = 28.0, tdp_gain: float = 48.0, thermal_mass: float = 22.0):
        self.ambient = ambient
        self.temp = ambient
        self.tdp_gain = tdp_gain  # Steady-state temp rise at 100% load
        self.thermal_mass = thermal_mass  # Time constant in seconds
        self._last_time = time.time()
        self.name = "Simulated Thermal Model"

    def read(self) -> float:
        return round(self.temp, 2)

    def update(self, load_pct: float, dt: Optional[float] = None) -> float:
        now = time.time()
        delta = dt if dt is not None else max(0.001, min(2.0, now - self._last_time))
        self._last_time = now

        # Equilibrium temp at current load
        target_eq = self.ambient + (load_pct * self.tdp_gain)
        # First-order thermal lag: dT/dt = (target_eq - T) / tau
        alpha = 1.0 - math.exp(-delta / self.thermal_mass)
        self.temp += (target_eq - self.temp) * alpha
        # Add slight natural jitter
        jitter = (math.sin(now * 3.7) + math.cos(now * 7.1)) * 0.08
        return round(self.temp + jitter, 2)

    def describe(self) -> dict:
        return {"name": self.name, "simulated": True}
