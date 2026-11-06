"""Comprehensive unit tests for CPU Heater."""
import json
import time
import unittest
from urllib.request import Request, urlopen

from heater.controller import STAGE_GUIDES, ThermalCycleSession, ThermalPID
from heater.curves import COMBO_MAP, Curve, load_curves, resolve_combo
from heater.hardware import clean_model, detect_socket
from heater.server import HeaterApp, make_request_handler, run_server
from heater.shutdown import trigger_shutdown
from heater.stresser import SimulatedSensor


class TestCurves(unittest.TestCase):
    def setUp(self):
        self.curves = load_curves("data/curves.csv")

    def test_curves_loaded(self):
        self.assertEqual(len(self.curves), 10)
        c1 = self.curves[1]
        self.assertIn("PGA", c1.name)
        self.assertEqual(c1.times[0], 0.0)
        self.assertEqual(c1.times[-1], 360.0)
        self.assertEqual(c1.temps[0], 28.0)
        self.assertEqual(c1.temps[3], 56.0)  # Peak at 3:00

    def test_interpolation(self):
        c1 = self.curves[1]
        # At t = 0: 28°C
        self.assertEqual(c1.target(0), 28.0)
        # At t = 30 (halfway between 0:00 28°C and 1:00 42°C): 35.0°C
        self.assertAlmostEqual(c1.target(30), 35.0)
        # At t = 60: 42°C
        self.assertEqual(c1.target(60), 42.0)
        # At t = 90 (halfway between 1:00 42°C and 2:00 52°C): 47.0°C
        self.assertAlmostEqual(c1.target(90), 47.0)
        # Past end: should clamp to last temp (41°C)
        self.assertEqual(c1.target(400), 41.0)

    def test_stage_index(self):
        c1 = self.curves[1]
        self.assertEqual(c1.stage_index(0), 1)
        self.assertEqual(c1.stage_index(59), 1)
        self.assertEqual(c1.stage_index(61), 2)
        self.assertEqual(c1.stage_index(360), 6)

    def test_resolve_combo_all_mapped(self):
        sockets = ["pga", "lga", "hedt"]
        coolers = ["flat", "hdt", "fullcover"]
        pastes = ["low", "high", "pcm"]

        # Ensure known combos map to valid curves
        self.assertEqual(resolve_combo("pga", "flat", "low"), 1)
        self.assertEqual(resolve_combo("pga", "flat", "high"), 2)
        self.assertEqual(resolve_combo("pga", "flat", "pcm"), 3)
        self.assertEqual(resolve_combo("pga", "hdt", "low"), 4)
        self.assertEqual(resolve_combo("pga", "hdt", "high"), 5)
        self.assertEqual(resolve_combo("lga", "flat", "low"), 6)
        self.assertEqual(resolve_combo("lga", "flat", "high"), 7)
        self.assertEqual(resolve_combo("lga", "flat", "pcm"), 8)
        self.assertEqual(resolve_combo("lga", "hdt", "low"), 9)
        self.assertEqual(resolve_combo("hedt", "fullcover", "low"), 10)


class TestHardwareDetection(unittest.TestCase):
    def test_clean_model(self):
        self.assertEqual(
            clean_model("AMD Ryzen 7 1700 Eight-Core Processor"),
            "AMD Ryzen 7 1700",
        )
        self.assertEqual(
            clean_model("Intel(R) Core(TM) i9-14900K CPU @ 3.20GHz"),
            "Intel Core i9-14900K",
        )

    def test_socket_detection(self):
        # AMD AM4 (PGA)
        res = detect_socket("AMD Ryzen 7 1700")
        self.assertEqual(res["class"], "pga")
        self.assertEqual(res["socket"], "AM4")

        # AMD AM5 (LGA)
        res = detect_socket("AMD Ryzen 7 7800X3D")
        self.assertEqual(res["class"], "lga")
        self.assertEqual(res["socket"], "AM5")

        # Intel LGA1700
        res = detect_socket("Intel Core i7-13700K")
        self.assertEqual(res["class"], "lga")
        self.assertEqual(res["socket"], "LGA1700")

        # Intel LGA1851
        res = detect_socket("Intel Core Ultra 7 265K")
        self.assertEqual(res["class"], "lga")
        self.assertEqual(res["socket"], "LGA1851")

        # Threadripper (HEDT)
        res = detect_socket("AMD Ryzen Threadripper 3970X")
        self.assertEqual(res["class"], "hedt")


class TestControllerAndStresser(unittest.TestCase):
    def test_simulated_sensor(self):
        sim = SimulatedSensor(ambient=25.0, tdp_gain=50.0, thermal_mass=2.0)
        self.assertEqual(sim.read(), 25.0)
        # Apply 100% load and step forward
        temp = sim.update(1.0, dt=1.0)
        self.assertGreater(temp, 25.0)

    def test_pid_clamping(self):
        pid = ThermalPID()
        # When far below target, load should clamp to 1.0
        load, p, i, d = pid.update(current=25.0, target=70.0)
        self.assertLessEqual(load, 1.0)
        self.assertGreaterEqual(load, 0.0)

        # When far above target, load should clamp to 0.0
        load, p, i, d = pid.update(current=80.0, target=40.0)
        self.assertEqual(load, 0.0)

    def test_session_lifecycle(self):
        curves = load_curves("data/curves.csv")
        session = ThermalCycleSession(curves[1], simulate=True, speed_factor=60.0)
        session.start()
        time.sleep(0.3)
        st = session.get_status()
        self.assertTrue(st["running"])
        self.assertGreater(st["elapsed"], 0)
        self.assertIn("stage", st)
        session.stop()
        st2 = session.get_status()
        self.assertFalse(st2["running"])
        self.assertTrue(st2["aborted"])


class TestShutdown(unittest.TestCase):
    def test_dry_run_shutdown(self):
        ok, msg = trigger_shutdown(dry_run=True)
        self.assertTrue(ok)
        self.assertIn("Simulation mode", msg)


class TestWebServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = run_server(port=8899, data_path="data/curves.csv", web_dir="web")
        import threading
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_api_detect(self):
        with urlopen("http://127.0.0.1:8899/api/detect") as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read().decode())
            self.assertIn("cpu", data)
            self.assertIn("sensor", data)
            self.assertIn("curves", data)

    def test_api_resolve(self):
        req = Request(
            "http://127.0.0.1:8899/api/resolve",
            data=json.dumps({"socket": "pga", "cooler": "flat", "paste": "high"}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read().decode())
            self.assertEqual(data["combo_id"], 2)

    def test_api_start_stop(self):
        # Start a simulation session
        req = Request(
            "http://127.0.0.1:8899/api/start",
            data=json.dumps({"combo_id": 1, "simulate": True, "speed_factor": 10.0}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read().decode())
            self.assertTrue(data["running"])

        # Check status
        with urlopen("http://127.0.0.1:8899/api/status") as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read().decode())
            self.assertTrue(data["running"])

        # Stop
        req_stop = Request("http://127.0.0.1:8899/api/stop", data=b"{}", headers={"Content-Type": "application/json"})
        with urlopen(req_stop) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read().decode())
            self.assertFalse(data["running"])

    def test_api_shutdown_dryrun(self):
        req = Request(
            "http://127.0.0.1:8899/api/shutdown",
            data=json.dumps({"dry_run": True}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read().decode())
            self.assertTrue(data["success"])


if __name__ == "__main__":
    unittest.main()
