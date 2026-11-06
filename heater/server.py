"""HTTP backend server for CPU Heater web UI."""
from __future__ import annotations

import json
import logging
import mimetypes
import os
import sys
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from heater.controller import ThermalCycleSession
from heater.curves import load_curves, resolve_combo
from heater.hardware import cpu_info, find_sensor
from heater.shutdown import trigger_shutdown
from heater.stresser import StressEngine

logger = logging.getLogger("heater.server")


class HeaterApp:
    def __init__(self, data_path: str = "data/curves.csv", web_dir: str = "web"):
        self.data_path = data_path
        self.web_dir = os.path.abspath(web_dir)
        self.curves = load_curves(self.data_path)
        self.hardware_info = cpu_info()
        self.sensor = find_sensor()
        self.stresser = StressEngine(thread_count=self.hardware_info.get("threads", 4))
        self.active_session: ThermalCycleSession | None = None

    def get_detect_payload(self) -> dict:
        return {
            "cpu": self.hardware_info,
            "sensor": self.sensor.describe() if self.sensor else {"name": "Simulated (No HW Sensor)", "simulated": True},
            "sensor_temp": round(self.sensor.read(), 1) if self.sensor else 28.0,
            "curves": {cid: c.to_dict() for cid, c in self.curves.items()},
        }

    def start_session(self, combo_id: int, simulate: bool = False, speed_factor: float = 1.0) -> dict:
        if combo_id not in self.curves:
            raise ValueError(f"Unknown combo ID {combo_id}")

        if self.active_session and self.active_session.is_running:
            self.active_session.stop("Restarted with new configuration")

        curve = self.curves[combo_id]
        sensor = None if simulate else self.sensor
        session = ThermalCycleSession(
            curve=curve,
            sensor=sensor,
            stresser=self.stresser,
            simulate=simulate,
            speed_factor=speed_factor,
        )
        session.start()
        self.active_session = session
        return session.get_status()

    def get_status_payload(self) -> dict:
        if self.active_session:
            return self.active_session.get_status()
        sensor_temp = round(self.sensor.read(), 1) if self.sensor else 28.0
        return {
            "running": False,
            "finished": False,
            "aborted": False,
            "current_temp": sensor_temp,
            "target_temp": 0.0,
            "elapsed": 0.0,
            "remaining": 0.0,
            "duration": 0.0,
            "progress_pct": 0.0,
            "load_pct": 0.0,
            "stage": "Idle",
            "stage_idx": 0,
            "stage_title": "Ready to Begin",
            "stage_badge": "Idle",
            "stage_description": "Configure cooler and thermal paste in the wizard to start heating cycle.",
            "stage_action": "Complete the setup wizard.",
            "dynamic_status": "Idle. Awaiting configuration.",
            "history": [],
        }

    def stop_session(self) -> dict:
        if self.active_session and self.active_session.is_running:
            self.active_session.stop("User requested stop")
        return self.get_status_payload()


def make_request_handler(app: HeaterApp):
    class HeaterHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=app.web_dir, **kwargs)

        def log_message(self, format, *args):
            # Suppress normal static asset noise in stdout
            pass

        def _send_json(self, data: dict, status: int = 200):
            payload = json.dumps(data, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(payload)

        def _read_body_json(self) -> dict:
            length = int(self.headers.get("Content-Length", 0))
            if length == 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8"))

        def do_OPTIONS(self):
            self.send_response(HTTPStatus.NO_CONTENT)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/detect":
                self._send_json(app.get_detect_payload())
                return
            if parsed.path == "/api/status":
                self._send_json(app.get_status_payload())
                return
            if parsed.path.startswith("/assets/"):
                # Serve from project root assets/
                asset_file = os.path.join(os.path.dirname(app.web_dir), parsed.path.lstrip("/"))
                if os.path.exists(asset_file) and os.path.isfile(asset_file):
                    ctype, _ = mimetypes.guess_type(asset_file)
                    with open(asset_file, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", ctype or "application/octet-stream")
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return

            super().do_GET()

        def do_POST(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/resolve":
                try:
                    body = self._read_body_json()
                    sock = body.get("socket", "pga")
                    cooler = body.get("cooler", "flat")
                    paste = body.get("paste", "low")
                    cid = resolve_combo(sock, cooler, paste)
                    curve = app.curves.get(cid) if cid else None
                    self._send_json({
                        "combo_id": cid,
                        "curve": curve.to_dict() if curve else None,
                        "exists": cid is not None,
                    })
                except Exception as ex:
                    self._send_json({"error": str(ex)}, status=400)
                return

            if parsed.path == "/api/start":
                try:
                    body = self._read_body_json()
                    cid = int(body.get("combo_id", 1))
                    simulate = bool(body.get("simulate", False))
                    speed = float(body.get("speed_factor", 1.0))
                    status = app.start_session(cid, simulate=simulate, speed_factor=speed)
                    self._send_json(status)
                except Exception as ex:
                    self._send_json({"error": str(ex)}, status=400)
                return

            if parsed.path == "/api/stop":
                self._send_json(app.stop_session())
                return

            if parsed.path == "/api/shutdown":
                try:
                    body = self._read_body_json()
                    dry_run = bool(body.get("dry_run", False))
                    success, msg = trigger_shutdown(dry_run=dry_run)
                    self._send_json({"success": success, "message": msg})
                except Exception as ex:
                    self._send_json({"success": False, "message": str(ex)}, status=500)
                return

            self.send_error(HTTPStatus.NOT_FOUND, "Endpoint not found")

    return HeaterHandler


def run_server(port: int = 8080, data_path: str = "data/curves.csv", web_dir: str = "web") -> ThreadingHTTPServer:
    app = HeaterApp(data_path=data_path, web_dir=web_dir)
    handler = make_request_handler(app)
    server = ThreadingHTTPServer(("0.0.0.0", port), handler)
    logger.info(f"CPU Heater server listening on http://0.0.0.0:{port}")
    return server
