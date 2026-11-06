<img src="assets/icon.svg" width="64" height="64" alt="CPU Heater Icon">

# CPU Heater · Thermal Paste Conditioner & Safe Release Tool

A full-screen hardware diagnostic and thermal conditioning application that softens thermal interface material (TIM) before CPU cooler removal. 

Specially designed for **AMD AM4/AM3+ PGA sockets** where cold, hardened paste acts like cement and risks ripping the CPU straight out of the socket and bending or destroying socket pins.

---

## Key Features

1. **Automatic Hardware Detection**
   - Automatically inspects `/proc/cpuinfo` to detect processor model, architecture, vendor, core/thread count.
   - Accurately classifies socket type (**PGA** AM4/AM3+, **LGA** AM5/1700/1851, or **HEDT** TR4/sTR5/4677).
   - Automatically locates real hardware thermal sensors via Linux `hwmon` (`k10temp`, `zenpower`, `coretemp`, `cpu_thermal`).

2. **Step-by-Step Profile Wizard**
   - **Step 1:** Confirm CPU Socket architecture with real-time risk explanations.
   - **Step 2:** Cooler baseplate design (Flat Machined Solid Plate, Heatpipe Direct Touch HDT, or Full-Cover HEDT).
   - **Step 3:** Thermal paste compound (Low/Med-viscosity MX-4/NT-H1, High-viscosity MX-6/TF7/Dried OEM, or Phase-Change PTM7950).
   - **Step 4:** Review conditioning curve, peak targets, hold durations, and release temperature.

3. **Dynamic Closed-Loop PID Stresser**
   - Locks CPU temperature to the exact target curve interpolated from `curves.csv`.
   - Modulates workload in real-time across all available CPU threads using duty-cycle pacing.
   - Live stage narration with exact physical action guidance (Ramp &rarr; Soak &rarr; Peak &rarr; Hold &rarr; Cut Load &rarr; Touch & Twist).
   - Top digital stopwatch displaying elapsed time, stage countdown, and total duration.

4. **Multi-Tier Safety Guard System**
   - **Hard Cutoff:** Immediately aborts and cuts load to 0% if CPU temperature exceeds 85°C.
   - **Thermal Runaway Trip:** Aborts if measured temperature exceeds curve target by >14°C.
   - **Sensor Loss Protection:** Aborts safely if hardware sensor stops responding.
   - **Manual Abort:** Instant kill-switch on screen.

5. **Touch & Twist Protocol & Full System Shutdown**
   - Guides the user through proper cooler removal while warm: unlatch retention clips, **gently twist left/right first to shear paste**, never pull straight up.
   - **Full Shutdown Button:** Triggers clean system poweroff (`systemctl poweroff` / `shutdown -h now`) with confirmation and simulation options.

6. **Full-screen Kiosk UI**
   - Industrial cyber-dark dark theme with glowing gauges and real-time interactive canvas graphs.
   - Press **F11** or click the fullscreen button to expand into a true dedicated kiosk interface.

---

## Quick Start

### 1. Launch the Application

```bash
./main.py
```
Or with specific options:
```bash
# Launch on port 8080 and open Chrome in kiosk mode:
./main.py --kiosk

# Headless / custom port without opening local browser:
./main.py --port 9000 --no-browser
```

### 2. Run Tests

```bash
python3 -m unittest discover -s tests -v
```

---

## Temperature Curves (`data/curves.csv`)

The thermal curves are loaded directly from `data/curves.csv`:

| Combo # | Socket + Cooler + TIM Combination | Start (0:00) | Ramp (1:00) | Soak (2:00) | Peak (3:00) | Hold (4:00) | Cut Load (5:00) | Touch & Twist (6:00) |
|---|---|---|---|---|---|---|---|---|
| **1** | PGA (AM4/AM3+) + Flat Plate + Low-Visc (MX-4) | 28°C | 42°C | 52°C | 56°C | 55°C | 48°C (Idle) | 41°C (Safe & Fluid) |
| **2** | PGA (AM4/AM3+) + Flat Plate + High-Visc (MX-6/TF7/Stock) | 28°C | 48°C | 64°C | 72°C | 70°C | 55°C (Idle) | 44°C (Safe & Soft) |
| **3** | PGA (AM4/AM3+) + Flat Plate + Phase-Change (PTM7950) | 28°C | 50°C | 65°C | 70°C | 68°C | 58°C (Fan Off) | 46°C (Liquid Threshold) |
| **4** | PGA (AM4/AM3+) + HDT Pipes + Low/Med-Visc (MX-4/NT-H1) | 28°C | 38°C | 46°C | 50°C | 48°C | 43°C (Idle) | 38°C (Safe & Loose) |
| **5** | PGA (AM4/AM3+) + HDT Pipes + High-Visc / Phase-Change | 28°C | 46°C | 60°C | 66°C | 65°C | 53°C (Idle) | 44°C (Grooves Soft) |
| **6** | LGA (AM5/1700/1851) + Flat Plate + Low/Med-Visc | 25°C | 25°C | 25°C | 25°C | 25°C | 25°C | 25°C (No Heat Needed) |
| **7** | LGA (AM5/1700/1851) + Flat Plate + High-Visc / Dried OEM | 28°C | 40°C | 50°C | 55°C | 52°C | 44°C (Idle) | 39°C (Zero-Pull Release) |
| **8** | LGA (AM5/1700/1851) + Flat Plate + Phase-Change (PTM7950) | 28°C | 48°C | 60°C | 65°C | 63°C | 54°C (Fan Off) | 45°C (Clean Peel) |
| **9** | LGA (AM5/1700/1851) + HDT Pipes + Any Paste/Pad | 25°C | 25°C | 25°C | 25°C | 25°C | 25°C | 25°C (No Heat Needed) |
| **10** | HEDT LGA (sTR5/TR4/4677) + Full-Cover + Any Paste/Pad | 30°C | 46°C | 58°C | 64°C | 62°C | 52°C (Idle) | 43°C (Breaks Suction) |

---

## Project Structure

```
├── main.py                  # Application entry point & CLI
├── data/
│   └── curves.csv           # Thermal curve definitions (editable without code changes)
├── heater/
│   ├── __init__.py          # Package initialization
│   ├── hardware.py          # /proc/cpuinfo inspection & /sys/class/hwmon sensor discovery
│   ├── curves.py            # CSV curve parser, target interpolation & combo resolution
│   ├── stresser.py          # Multiprocess dynamic duty-cycle load generator & thermal simulator
│   ├── controller.py        # Closed-loop PID regulator, safety trip guards & stage narration
│   ├── shutdown.py          # System poweroff trigger & simulation
│   └── server.py            # Built-in zero-dependency HTTP REST API
├── web/
│   ├── index.html           # Full-screen responsive kiosk interface
│   ├── style.css            # Dark thermal cyber telemetry styling
│   └── app.js               # Frontend controller, canvas graphs, telemetry polling
├── tests/
│   └── test_heater.py       # Complete unit test suite (14 tests)
└── assets/
    └── icon.svg             # Application brand icon
```
