import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("sdm_setup", Path(__file__).parents[1] / "sdm_setup.py")
setup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(setup)
DIGESTS = {name: "sha256:" + char * 64 for name, char in zip(("frontend", "api", "cpu", "cuda", "rocm"), "abcde")}
IMAGES = {
    "SDM_RELEASE_VERSION": "2.0.0-beta.6",
    "SDM_FRONTEND_DIGEST": DIGESTS["frontend"],
    "SDM_API_DIGEST": DIGESTS["api"],
    "SDM_PLUMBER_CPU_DIGEST": DIGESTS["cpu"],
    "SDM_PLUMBER_CUDA_DIGEST": DIGESTS["cuda"],
    "SDM_PLUMBER_ROCM_DIGEST": DIGESTS["rocm"],
    "SDM_PLUMBER_VARIANT": "cpu",
    "SDM_PLUMBER_DIGEST": DIGESTS["cpu"],
}


class ImageMetadataTests(unittest.TestCase):
    def test_requires_all_dedicated_immutable_digests(self):
        broken = IMAGES.copy()
        del broken["SDM_PLUMBER_ROCM_DIGEST"]
        with self.assertRaisesRegex(setup.SetupError, "SDM_PLUMBER_ROCM_DIGEST"):
            setup.validate_images(broken)

    def test_requires_strict_release_version_metadata(self):
        with self.assertRaisesRegex(setup.SetupError, "SDM_RELEASE_VERSION"):
            setup.validate_images(IMAGES | {"SDM_RELEASE_VERSION": "beta-six"})

    def test_rejects_active_digest_that_does_not_match_selected_variant(self):
        broken = IMAGES | {"SDM_PLUMBER_VARIANT": "cuda", "SDM_PLUMBER_DIGEST": DIGESTS["cpu"]}
        with self.assertRaisesRegex(setup.SetupError, "must match"):
            setup.validate_images(broken)

    def test_accepts_coherent_metadata(self):
        setup.validate_images(IMAGES)


class AcceleratorTests(unittest.TestCase):
    def test_auto_selects_gpu_using_dedicated_digest(self):
        seen = []
        selected, _ = setup.select_accelerator(
            "auto", {"nvidia": True, "amd": False}, IMAGES,
            lambda accelerator, images: (seen.append(setup.accelerator_image(images, accelerator)) is None, "ok"),
        )
        self.assertEqual(selected, "nvidia")
        self.assertEqual(seen, [f"ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-cuda@{DIGESTS['cuda']}"])

    def test_auto_falls_back_to_cpu_digest_when_probe_fails(self):
        selected, note = setup.select_accelerator("auto", {"nvidia": True, "amd": False}, IMAGES, lambda *_: (False, "runtime unavailable"))
        self.assertEqual(selected, "cpu")
        self.assertIn("CPU fallback", note)
        rendered = setup.selected_images_env(IMAGES, selected)
        self.assertIn(f"SDM_PLUMBER_DIGEST={DIGESTS['cpu']}", rendered)

    def test_manual_accelerator_probe_failure_is_an_error(self):
        with self.assertRaisesRegex(setup.SetupError, "runtime probe failed"):
            setup.select_accelerator("nvidia", {"nvidia": True, "amd": False}, IMAGES, lambda *_: (False, "no runtime"))

    def test_runtime_probe_constructs_real_cuda_command_and_reports_failure(self):
        command = setup.runtime_probe_command("nvidia", "cuda-image")
        self.assertEqual(command, [
            "docker", "run", "--rm", "--gpus", "all", "--entrypoint", "Rscript", "cuda-image", "-e",
            "stopifnot(torch::cuda_is_available()); x <- torch::torch_tensor(c(1), device = 'cuda'); stopifnot(x$device$type == 'cuda'); print(x$item())",
        ])
        result = type("Result", (), {"returncode": 1, "stdout": "", "stderr": "tensor failed"})()
        ok, detail = setup.runtime_probe("nvidia", IMAGES, lambda *_args, **_kwargs: result)
        self.assertFalse(ok)
        self.assertEqual(detail, "tensor failed")

    def test_runtime_probe_constructs_real_rocm_command_and_reports_success(self):
        command = setup.runtime_probe_command("amd", "rocm-image")
        self.assertEqual(command, [
            "docker", "run", "--rm", "--device", "/dev/kfd", "--device", "/dev/dri", "--entrypoint", "/opt/venv/bin/python3", "rocm-image", "-c",
            "import torch; assert torch.version.hip and torch.cuda.is_available(), (torch.version.hip, torch.cuda.is_available()); x = torch.tensor([1], device='cuda'); assert x.device.type == 'cuda'; print(x.item())",
        ])
        result = type("Result", (), {"returncode": 0, "stdout": "1\n", "stderr": ""})()
        ok, detail = setup.runtime_probe("amd", IMAGES, lambda *_args, **_kwargs: result)
        self.assertTrue(ok)
        self.assertEqual(detail, "1")


class ConfigTests(unittest.TestCase):
    def test_secret_generation_is_complete_and_unique(self):
        one, two = setup.secret_values(), setup.secret_values()
        self.assertEqual(len(one["DATA_ENCRYPTION_KEY"]), 64)
        self.assertNotEqual(one["JWT_SECRET"], two["JWT_SECRET"])

    def test_write_env_missing_preserves_existing_secret_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("JWT_SECRET=keep-me\n")
            added = setup.write_env_missing(path, {"JWT_SECRET": "replace", "CSRF_SECRET": "new"}, False)
            self.assertEqual(added, ["CSRF_SECRET"])
            self.assertIn("JWT_SECRET=keep-me", path.read_text())
            self.assertEqual(setup.write_env_missing(path, {"CSRF_SECRET": "new"}, False), [])

    def test_selected_images_env_has_one_canonical_active_pair_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "images.env"
            self.assertTrue(setup.write_selected_images_env(path, IMAGES, "nvidia", False))
            rendered = path.read_text()
            self.assertEqual(rendered.count("SDM_PLUMBER_VARIANT="), 1)
            self.assertEqual(rendered.count("SDM_PLUMBER_DIGEST="), 1)
            self.assertIn(f"SDM_PLUMBER_DIGEST={DIGESTS['cuda']}", rendered)
            self.assertFalse(setup.write_selected_images_env(path, IMAGES, "nvidia", False))

    def test_database_url_uses_existing_postgres_password(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text("POSTGRES_PASSWORD=keep-me\n")
            values = setup.deployment_values(path, "cpu")
            self.assertIn("postgresql://sdm:keep-me@postgres", values["DATABASE_URL"])
            self.assertNotIn("SDM_PLUMBER_VARIANT", values)


class PreflightTests(unittest.TestCase):
    def test_default_ports_are_only_public_entry_points(self):
        self.assertEqual(setup.REQUIRED_PORTS, (80, 443))

    def test_reports_docker_and_compose_failures(self):
        with patch.object(setup.shutil, "which", return_value=None), patch.object(setup, "host_memory", return_value=setup.MIN_MEMORY_BYTES), patch.object(setup.shutil, "disk_usage", return_value=type("Disk", (), {"free": setup.MIN_DISK_BYTES})()), patch.object(setup, "port_free", return_value=True):
            with tempfile.TemporaryDirectory() as directory:
                report = setup.preflight(Path(directory), IMAGES)
        self.assertFalse(report["ok"])
        self.assertIn("Docker CLI not found", report["errors"])


if __name__ == "__main__":
    unittest.main()
