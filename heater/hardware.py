"""Hardware detection: CPU identity, socket class and CPU temperature sensor on Linux and Windows."""
from __future__ import annotations

import glob
import os
import platform
import re
import subprocess
from dataclasses import dataclass


def _read(path: str, default: str | None = None) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read().strip()
    except OSError:
        return default


# --------------------------------------------------------------------------- CPU


def clean_model(name: str) -> str:
    s = re.sub(r"\((?:R|TM)\)", "", name, flags=re.I)
    s = re.sub(r"\bCPU\b", "", s)
    s = re.sub(r"@.*$", "", s)
    s = re.sub(r"\b[\w]+-Core Processor\b", "", s, flags=re.I)
    s = re.sub(r"\bProcessor\b", "", s, flags=re.I)
    s = re.sub(r"\bwith Radeon.*$", "", s, flags=re.I)
    return re.sub(r"\s+", " ", s).strip()


def _cpu_info_windows() -> dict:
    model = ""
    vendor = "Unknown"
    threads = os.cpu_count() or 1
    cores = threads

    # Query WMI via powershell or wmic
    try:
        cmd = [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Processor | Select-Object -Property Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors | ConvertTo-Json",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            import json
            data = json.loads(res.stdout)
            if isinstance(data, list):
                data = data[0]
            model = data.get("Name", "")
            vendor_raw = data.get("Manufacturer", "")
            if "AMD" in vendor_raw or "Advanced Micro" in vendor_raw:
                vendor = "AMD"
            elif "Intel" in vendor_raw:
                vendor = "Intel"
            else:
                vendor = vendor_raw
            cores = data.get("NumberOfCores") or threads
            threads = data.get("NumberOfLogicalProcessors") or threads
    except Exception:
        # Fallback to environment variables
        model = os.environ.get("PROCESSOR_IDENTIFIER", "")

    name = clean_model(model) or platform.processor() or "Unknown CPU"
    return {
        "model": name,
        "raw_model": model,
        "vendor": vendor,
        "family": None,
        "threads": threads,
        "cores": cores,
        "socket": detect_socket(name, vendor, None),
    }


def _cpu_info_linux() -> dict:
    model = vendor = ""
    family = None
    cores: set[tuple[str | None, str | None]] = set()
    phys = core = None
    for line in (_read("/proc/cpuinfo", "") or "").splitlines() + [""]:
        if ":" not in line:
            if phys is not None or core is not None:
                cores.add((phys, core))
            phys = core = None
            continue
        key, val = (s.strip() for s in line.split(":", 1))
        if key == "model name" and not model:
            model = val
        elif key == "vendor_id" and not vendor:
            vendor = val
        elif key == "cpu family" and family is None and val.isdigit():
            family = int(val)
        elif key == "physical id":
            phys = val
        elif key == "core id":
            core = val
    threads = os.cpu_count() or 1
    vendor_name = {"AuthenticAMD": "AMD", "GenuineIntel": "Intel"}.get(vendor, vendor or "Unknown")
    name = clean_model(model) or "Unknown CPU"
    return {
        "model": name,
        "raw_model": model,
        "vendor": vendor_name,
        "family": family,
        "threads": threads,
        "cores": len(cores) or threads,
        "socket": detect_socket(name, vendor_name, family),
    }


def cpu_info() -> dict:
    if platform.system() == "Windows":
        return _cpu_info_windows()
    return _cpu_info_linux()


def _sock(cls: str, socket: str, confidence: str, reason: str) -> dict:
    return {"class": cls, "socket": socket, "confidence": confidence, "reason": reason}


def detect_socket(model: str, vendor: str = "", family: int | None = None) -> dict:
    """Best-effort socket classification: pga | lga | hedt | bga | unknown."""
    low = clean_model(model).lower()

    # ---- AMD
    if "threadripper" in low:
        m = re.search(r"threadripper\s+(pro\s+)?(\d)\d{3}", low)
        gen = int(m[2]) if m else 0
        sock = {1: "TR4", 2: "TR4", 3: "sTRX4", 5: "sWRX8", 7: "sTR5", 9: "sTR5"}.get(gen, "TR4 / sTRX4 / sTR5")
        if m and m[1] and gen == 3:
            sock = "sWRX8"
        return _sock("hedt", sock, "high", "Threadripper sits in a large LGA socket under a full-cover cold plate.")
    if "epyc" in low:
        return _sock("hedt", "SP3 / SP5", "medium", "EPYC uses a large server LGA socket.")
    if "ryzen" in low:
        if re.search(r"ryzen\s+(ai\b|z\d)", low):
            return _sock("bga", "Soldered (mobile)", "high", "Mobile Ryzen is soldered to the board — there's no socket to pull it out of.")
        m = re.search(r"ryzen\s+\d\s+(?:pro\s+)?(\d)\d{3}([a-z0-9]*)", low)
        if m:
            gen, suffix = int(m[1]), m[2]
            if re.match(r"^(u|h|c)", suffix) or gen == 6:
                return _sock("bga", "Soldered (mobile)", "high", "Mobile Ryzen is soldered to the board — there's no socket to pull it out of.")
            if 1 <= gen <= 5:
                return _sock("pga", "AM4", "high", f"Ryzen {gen}000-series desktop chips use AM4. The pins are on the CPU, so it can be ripped out with the cooler.")
            if gen in (7, 8, 9):
                return _sock("lga", "AM5", "high", f"Ryzen {gen}000-series desktop chips use AM5. The pins live in the socket and the CPU is clamped down.")
    if re.search(r"athlon\s+(?:gold\s+|silver\s+|pro\s+)?\d{3,4}ge?\b", low):
        return _sock("pga", "AM4", "medium", "Desktop Athlon APUs use AM4 — pins on the CPU.")
    if re.search(r"\bfx-|phenom|athlon\s+(ii|x[24])|\ba\d{1,2}-\d{4}", low):
        return _sock("pga", "AM3+ / FM2+", "high", "This AMD generation uses a PGA socket — pins on the CPU.")
    if vendor == "AMD":
        if family == 0x17:
            return _sock("pga", "AM4", "medium", "Zen / Zen 2 desktop chips are AM4 (PGA).")
        if family == 0x1A:
            return _sock("lga", "AM5", "medium", "Zen 5 desktop chips are AM5 (LGA).")
        if family in (0x10, 0x15, 0x16):
            return _sock("pga", "AM3+ / FM2+", "medium", "Older AMD desktop chips use PGA sockets.")

    # ---- Intel
    if "xeon" in low:
        if re.search(r"xeon\s+w[3579]-\d{4}", low) or re.search(r"platinum|gold|silver|bronze|\bmax\b", low):
            return _sock("hedt", "LGA4677", "medium", "Workstation/server Xeons use a large LGA socket.")
        return _sock("lga", "LGA (Xeon)", "medium", "This Xeon uses an LGA socket — pins in the motherboard.")
    m = re.search(r"core\s+ultra\s+\d\s+(\d)\d{2}([a-z]*)", low)
    if m:
        if m[1] == "2" and m[2] in ("", "k", "kf", "f", "t"):
            return _sock("lga", "LGA1851", "high", "Core Ultra 200S desktop chips use LGA1851.")
        return _sock("bga", "Soldered (mobile)", "high", "Mobile Core Ultra is soldered to the board.")
    m = re.search(r"\bi[3579]-(\d{4,5})([a-z]*\d?)", low)
    if m:
        num, suffix = m[1], m[2]
        gen = int(num[:2]) if len(num) == 5 else int(num[0])
        if re.match(r"^(u|h|p|y|m|g\d)", suffix):
            return _sock("bga", "Soldered (mobile)", "high", "Mobile Intel chips are soldered to the board.")
        if suffix.startswith("x"):
            return _sock("lga", "LGA2011 / LGA2066", "high", "Intel X-series uses a large LGA socket with a standard cooler.")
        sock = ("LGA1700" if gen >= 12 else "LGA1200" if gen >= 10 else "LGA1151" if gen >= 6
                else "LGA1150" if gen >= 4 else "LGA1155" if gen >= 2 else "LGA1156")
        return _sock("lga", sock, "high", f"{gen}th-gen Intel Core desktop chips use {sock}. Pins are in the socket.")
    m = re.search(r"\bcore\s+[357]\s+\d{3}([a-z]*)", low)
    if m:
        if m[1].startswith(("u", "h")):
            return _sock("bga", "Soldered (mobile)", "high", "Mobile Intel chips are soldered to the board.")
        return _sock("lga", "LGA1700", "medium", "Intel Core (Series 1) desktop chips use LGA1700.")
    if "core2" in low.replace(" ", "") or re.search(r"pentium|celeron", low):
        return _sock("lga", "LGA", "medium", "Intel desktop chips have used LGA sockets since 2004.")
    if vendor == "Intel":
        return _sock("lga", "LGA", "low", "Intel desktop chips use LGA sockets.")

    return _sock("unknown", "Unknown", "low", "Couldn't identify the socket automatically — please pick it below.")


# --------------------------------------------------------------------------- sensors


@dataclass
class Sensor:
    name: str
    paths: list[str]

    def read(self) -> float:
        vals = []
        for p in self.paths:
            v = _read(p)
            if v is None:
                continue
            try:
                vals.append(int(v) / 1000.0)
            except ValueError:
                pass
        if not vals:
            raise OSError(f"could not read {self.name}")
        return max(vals)

    def describe(self) -> dict:
        return {"name": self.name, "simulated": False}


class WindowsSensor:
    """Windows WMI / OpenHardwareMonitor / LibreHardwareMonitor sensor query."""

    def __init__(self, name: str):
        self.name = name

    def read(self) -> float:
        # Try MSAcpi_ThermalZoneTemperature via powershell
        cmd = [
            "powershell",
            "-NoProfile",
            "-Command",
            "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -ExpandProperty CurrentTemperature | Measure-Object -Maximum).Maximum",
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
            if res.returncode == 0 and res.stdout.strip():
                # Kelvin * 10
                kelvin_10 = float(res.stdout.strip())
                if kelvin_10 > 2000:
                    celsius = (kelvin_10 - 2732) / 10.0
                    if 15.0 < celsius < 120.0:
                        return celsius
        except Exception:
            pass
        raise OSError("Windows sensor read failed")

    def describe(self) -> dict:
        return {"name": self.name, "simulated": False}


def _hwmons() -> list[tuple[str, dict[str, str]]]:
    out = []
    for d in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
        name = _read(os.path.join(d, "name"), "") or ""
        temps: dict[str, str] = {}
        for inp in sorted(glob.glob(os.path.join(d, "temp*_input"))):
            label = _read(inp[: -len("_input")] + "_label") or os.path.basename(inp)[: -len("_input")]
            temps[label] = inp
        out.append((name, temps))
    return out


def _plausible(sensor: Sensor) -> bool:
    try:
        return 1.0 < sensor.read() < 125.0
    except OSError:
        return False


def find_sensor():
    if platform.system() == "Windows":
        try:
            ws = WindowsSensor("WMI ThermalZone")
            ws.read()
            return ws
        except Exception:
            return None

    candidates: list[Sensor] = []
    hw = _hwmons()
    for name, temps in hw:
        if name in ("k10temp", "zenpower"):
            for lab in ("Tdie", "Tctl"):
                if lab in temps:
                    candidates.append(Sensor(f"{name} · {lab}", [temps[lab]]))
    for name, temps in hw:
        if name == "coretemp":
            pkg = [p for lab, p in temps.items() if lab.lower().startswith("package id")]
            core = [p for lab, p in temps.items() if lab.lower().startswith("core")]
            if pkg:
                candidates.append(Sensor("coretemp · Package", pkg))
            if core:
                candidates.append(Sensor("coretemp · hottest core", core))
    for name, temps in hw:
        if name in ("cpu_thermal", "cpu-thermal", "soc_thermal") and temps:
            candidates.append(Sensor(name, list(temps.values())[:1]))

    zones = []
    for z in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
        ztype = _read(os.path.join(z, "type"), "") or ""
        zones.append((ztype, os.path.join(z, "temp")))
    for want in ("x86_pkg_temp", "cpu", "acpitz"):
        for ztype, path in zones:
            if ztype.lower().startswith(want):
                candidates.append(Sensor(f"thermal zone · {ztype}", [path]))

    for s in candidates:
        if _plausible(s):
            return s
    return None
