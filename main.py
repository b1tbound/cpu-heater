#!/usr/bin/env python3
"""CPU Heater - Thermal Paste Conditioning & Safe Release Tool.

Auto-detects CPU socket architecture, guides through cooler & TIM selection,
and locks temperatures using dynamic closed-loop CPU load modulation.
"""
from __future__ import annotations

import argparse
import logging
import os
import shutil
import signal
import subprocess
import sys
import time
import webbrowser

from heater.hardware import cpu_info, find_sensor
from heater.server import run_server

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("cpu-heater")


def parse_args():
    parser = argparse.ArgumentParser(
        description="CPU Heater - Thermal paste conditioner with dynamic load lock."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Port to bind the HTTP server to (default: 8080)",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not automatically launch a browser window.",
    )
    parser.add_argument(
        "--kiosk",
        action="store_true",
        help="Launch Chrome/Chromium in full-screen kiosk mode.",
    )
    parser.add_argument(
        "--curves",
        default="data/curves.csv",
        help="Path to curves.csv definition file (default: data/curves.csv)",
    )
    return parser.parse_args()


def launch_browser(url: str, kiosk: bool = False):
    """Attempts to open browser in kiosk or dedicated app window mode."""
    # Find chrome/chromium for true kiosk/app window
    browsers = ["google-chrome", "chromium-browser", "chromium", "firefox"]
    browser_bin = None
    for b in browsers:
        path = shutil.which(b)
        if path:
            browser_bin = path
            break

    if browser_bin and ("chrome" in browser_bin or "chromium" in browser_bin):
        args = [browser_bin]
        if kiosk:
            args.extend(["--kiosk", url])
        else:
            args.extend([f"--app={url}"])
        try:
            logger.info(f"Launching dedicated browser window: {' '.join(args)}")
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception as ex:
            logger.warning(f"Failed to launch Chrome app mode: {ex}")

    # Fallback to default browser
    logger.info(f"Opening {url} in default web browser")
    webbrowser.open(url)


def main():
    args = parse_args()

    # Hardware detection summary on startup
    info = cpu_info()
    sensor = find_sensor()

    print("=" * 64)
    print("  🔥 CPU HEATER · Thermal Conditioner & Safe Release Tool")
    print("=" * 64)
    print(f"  CPU Model    : {info.get('model')} ({info.get('vendor')})")
    print(f"  Topology     : {info.get('cores')} Cores / {info.get('threads')} Threads")
    sock = info.get("socket", {})
    print(f"  Socket Type  : {sock.get('socket')} [{sock.get('class', '').upper()}] (Confidence: {sock.get('confidence')})")
    if sock.get("class") == "pga":
        print("  ⚠️  PGA ALERT : CPU pins are on the chip! High risk of pin pull-out.")
    sensor_name = sensor.describe()["name"] if sensor else "Simulated"
    sensor_temp = f"{sensor.read():.1f}°C" if sensor else "28.0°C"
    print(f"  Sensor Found : {sensor_name} (Current: {sensor_temp})")
    print(f"  Curves Data  : {args.curves}")
    print("-" * 64)

    server = run_server(port=args.port, data_path=args.curves, web_dir="web")
    url = f"http://localhost:{args.port}"
    print(f"  Web Interface ready at: {url}")
    print("  Press Ctrl+C to terminate the server.\n" + "=" * 64)

    if not args.no_browser:
        launch_browser(url, kiosk=args.kiosk)

    # Signal handlers
    def shutdown_signal(sig, frame):
        print("\nShutting down CPU Heater server...")
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown_signal)
    signal.signal(signal.SIGTERM, shutdown_signal)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
