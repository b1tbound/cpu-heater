"""Temperature curves loaded from data/curves.csv and the wizard -> combo mapping."""
from __future__ import annotations

import csv
import re
from dataclasses import dataclass

TEMP_RE = re.compile(r"(-?\d+(?:\.\d+)?)\s*°?\s*C", re.I)
HEADER_RE = re.compile(r"^\s*(\d+):(\d{2})\s*(?:\((.*)\))?\s*$")
NOTE_RE = re.compile(r"\(([^)]*)\)")

# (socket class, cooler type, paste type) -> combo number in curves.csv
COMBO_MAP: dict[str, int] = {
    "pga/flat/low": 1,
    "pga/flat/high": 2,
    "pga/flat/pcm": 3,
    "pga/hdt/low": 4,
    "pga/hdt/high": 5,
    "pga/hdt/pcm": 5,
    "lga/flat/low": 6,
    "lga/flat/high": 7,
    "lga/flat/pcm": 8,
    "lga/hdt/low": 9,
    "lga/hdt/high": 9,
    "lga/hdt/pcm": 9,
    "hedt/fullcover/low": 10,
    "hedt/fullcover/high": 10,
    "hedt/fullcover/pcm": 10,
}


@dataclass
class Curve:
    id: int
    name: str
    times: list[float]  # seconds
    temps: list[float]  # °C
    labels: list[str]   # label of each timestamp column, e.g. "Ramp"
    notes: list[str]    # parenthesised note in each cell, e.g. "Idle"

    @property
    def duration(self) -> float:
        return self.times[-1]

    @property
    def no_heat(self) -> bool:
        return max(self.temps) - min(self.temps) < 0.5

    @property
    def stage_count(self) -> int:
        return len(self.times) - 1

    def target(self, t: float) -> float:
        """Linearly interpolated target temperature at time t (seconds)."""
        if t <= self.times[0]:
            return self.temps[0]
        for i in range(1, len(self.times)):
            if t <= self.times[i]:
                t0, t1 = self.times[i - 1], self.times[i]
                f = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
                return self.temps[i - 1] + f * (self.temps[i] - self.temps[i - 1])
        return self.temps[-1]

    def stage_index(self, t: float) -> int:
        """1-based stage index. Stage i spans times[i-1]..times[i] and is named by labels[i]."""
        for i in range(1, len(self.times)):
            if t < self.times[i]:
                return i
        return self.stage_count

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "times": self.times,
            "temps": self.temps,
            "labels": self.labels,
            "notes": self.notes,
            "duration": self.duration,
            "no_heat": self.no_heat,
        }


def load_curves(path: str) -> dict[int, Curve]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.reader(f) if r and any(c.strip() for c in r)]
    if not rows:
        raise ValueError(f"{path} is empty")

    header = rows[0]
    time_cols: list[tuple[int, int, str]] = []
    for idx, h in enumerate(header):
        m = HEADER_RE.match(h)
        if m:
            time_cols.append((idx, int(m[1]) * 60 + int(m[2]), (m[3] or "").strip()))
    if len(time_cols) < 2:
        raise ValueError("curves.csv needs at least two 'M:SS (Label)' columns")

    curves: dict[int, Curve] = {}
    for row in rows[1:]:
        try:
            cid = int(row[0])
        except (ValueError, IndexError):
            continue
        temps, notes = [], []
        for idx, _t, _label in time_cols:
            cell = row[idx] if idx < len(row) else ""
            m = TEMP_RE.search(cell)
            if not m:
                raise ValueError(f"combo {cid}: can't read a temperature from {cell!r}")
            temps.append(float(m[1]))
            n = NOTE_RE.search(cell)
            notes.append(n[1].strip() if n else "")
        curves[cid] = Curve(
            id=cid,
            name=row[1].strip() if len(row) > 1 else f"Combo {cid}",
            times=[float(t) for _i, t, _l in time_cols],
            temps=temps,
            labels=[label for _i, _t, label in time_cols],
            notes=notes,
        )
    return curves


def resolve_combo(socket: str, cooler: str, paste: str) -> int | None:
    return COMBO_MAP.get(f"{socket}/{cooler}/{paste}")
