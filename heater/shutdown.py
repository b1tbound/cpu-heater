"""System shutdown helper for the completion screen on Linux and Windows."""
from __future__ import annotations

import logging
import os
import platform
import subprocess
from typing import Tuple

logger = logging.getLogger("heater.shutdown")


def trigger_shutdown(dry_run: bool = False) -> Tuple[bool, str]:
    """Issues system shutdown command to turn off machine after cycle completes.

    Supports Linux (systemctl poweroff / shutdown) and Windows (shutdown /s /t 0).
    Returns (success, message).
    """
    if dry_run:
        return True, "Simulation mode: system poweroff command simulated successfully."

    is_windows = platform.system() == "Windows"

    if is_windows:
        commands = [
            ["shutdown", "/s", "/t", "0"],
            ["shutdown", "-s", "-t", "0"],
        ]
    else:
        commands = [
            ["systemctl", "poweroff"],
            ["poweroff"],
            ["shutdown", "-h", "now"],
            ["sudo", "-n", "systemctl", "poweroff"],
        ]

    errors = []
    for cmd in commands:
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=5,
            )
            if res.returncode == 0:
                logger.info(f"Executed shutdown command: {' '.join(cmd)}")
                return True, f"Shutdown initiated via {' '.join(cmd)}"
            errors.append(f"{' '.join(cmd)}: {res.stderr.strip() or res.stdout.strip() or 'exited ' + str(res.returncode)}")
        except FileNotFoundError:
            continue
        except Exception as ex:
            errors.append(f"{' '.join(cmd)}: {ex}")

    msg = f"Could not trigger immediate poweroff automatically on {platform.system()}. You may need administrator privileges. Details: " + " | ".join(errors)
    logger.warning(msg)
    return False, msg
