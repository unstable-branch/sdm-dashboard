import importlib.util
import tempfile
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("sdm_setup", Path(__file__).parents[1] / "sdm_setup.py")
setup = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(setup)
DIGEST = "sha256:" + "a" * 64
IMAGES = {"SDM_FRONTEND_DIGEST": DIGEST, "SDM_API_DIGEST": DIGEST, "SDM_PLUMBER_DIGEST": DIGEST, "SDM_PLUMBER_VARIANT": "cpu"}

class ImageMetadataTests(unittest.TestCase):
    def test_requires_immutable_digests(self):
        with self.assertRaises(setup.SetupError): setup.validate_images({"SDM_FRONTEND_DIGEST": "latest"})
    def test_accepts_immutable_metadata(self): setup.validate_images(IMAGES)

class AcceleratorTests(unittest.TestCase):
    NVIDIA_IMAGES = IMAGES | {"SDM_PLUMBER_VARIANT": "cuda"}
    def test_auto_falls_back_to_cpu_when_probe_fails(self):
        selected, note = setup.select_accelerator("auto", {"nvidia": True, "amd": False}, self.NVIDIA_IMAGES, lambda *_: (False, "runtime unavailable"))
        self.assertEqual(selected, "cpu"); self.assertIn("CPU fallback", note)
    def test_manual_accelerator_probe_failure_is_an_error(self):
        with self.assertRaisesRegex(setup.SetupError, "runtime probe failed"):
            setup.select_accelerator("nvidia", {"nvidia": True, "amd": False}, self.NVIDIA_IMAGES, lambda *_: (False, "no runtime"))
    def test_manual_accelerator_requires_matching_image_metadata(self):
        with self.assertRaisesRegex(setup.SetupError, "image metadata selects cpu"):
            setup.select_accelerator("nvidia", {"nvidia": True, "amd": False}, IMAGES)
    def test_manual_cpu_skips_gpu_probe(self):
        self.assertEqual(setup.select_accelerator("cpu", {"nvidia": True, "amd": True}, IMAGES)[0], "cpu")

class ConfigTests(unittest.TestCase):
    def test_secret_generation_is_complete_and_unique(self):
        one, two = setup.secret_values(), setup.secret_values()
        self.assertEqual(len(one["DATA_ENCRYPTION_KEY"]), 64)
        self.assertNotEqual(one["JWT_SECRET"], two["JWT_SECRET"])
    def test_write_env_missing_preserves_existing_secret_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"; path.write_text("JWT_SECRET=keep-me\n")
            added = setup.write_env_missing(path, {"JWT_SECRET": "replace", "CSRF_SECRET": "new"}, False)
            self.assertEqual(added, ["CSRF_SECRET"])
            self.assertIn("JWT_SECRET=keep-me", path.read_text())
            self.assertEqual(setup.write_env_missing(path, {"CSRF_SECRET": "new"}, False), [])
    def test_dry_run_does_not_write(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            self.assertEqual(setup.write_env_missing(path, {"JWT_SECRET": "new"}, True), ["JWT_SECRET"])
            self.assertFalse(path.exists())
    def test_database_url_uses_existing_postgres_password(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"; path.write_text("POSTGRES_PASSWORD=keep-me\n")
            values = setup.deployment_values(path, "cpu")
            self.assertIn("postgresql://sdm:keep-me@postgres", values["DATABASE_URL"])
            self.assertEqual(values["SDM_PLUMBER_VARIANT"], "cpu")

class PreflightTests(unittest.TestCase):
    def test_reports_docker_and_compose_failures(self):
        old_which, old_memory, old_disk, old_ports = setup.shutil.which, setup.host_memory, setup.shutil.disk_usage, setup.port_free
        try:
            setup.shutil.which = lambda _: None; setup.host_memory = lambda: setup.MIN_MEMORY_BYTES
            setup.shutil.disk_usage = lambda _: type("Disk", (), {"free": setup.MIN_DISK_BYTES})()
            setup.port_free = lambda _: True
            with tempfile.TemporaryDirectory() as directory:
                report = setup.preflight(Path(directory), IMAGES)
            self.assertFalse(report["ok"]); self.assertIn("Docker CLI not found", report["errors"])
        finally:
            setup.shutil.which, setup.host_memory, setup.shutil.disk_usage, setup.port_free = old_which, old_memory, old_disk, old_ports

if __name__ == "__main__": unittest.main()
