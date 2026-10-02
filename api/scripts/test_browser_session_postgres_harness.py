"""Ownership regression tests: run the real harness without Docker effects."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("session_harness", Path(__file__).with_name("test-browser-session-postgres.py"))
assert spec is not None and spec.loader is not None
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class ContainerOwnershipTests(unittest.TestCase):
    def test_wrong_inspected_identity_never_reaches_provisioning(self):
        created = "a" * 64
        replacement = "b" * 64
        commands = []
        info = {"Id": replacement, "Config": {"Image": harness.IMAGE}, "Image": harness.IMAGE_ID,
                "State": {"Status": "running", "Health": {"Status": "healthy"}},
                "NetworkSettings": {"Ports": {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": "49123"}]}},
                "Mounts": [], "HostConfig": {"NanoCpus": 2_000_000_000, "Memory": 536_870_912,
                                            "Tmpfs": {"/var/lib/postgresql/data": "rw"}}}
        inspections = 0

        def fake_run(args, **kwargs):
            nonlocal inspections
            commands.append(args)
            if args[:2] == ["docker", "inspect"]:
                inspections += 1
                if inspections == 1:
                    return SimpleNamespace(returncode=1, stdout="", stderr="No such object")
                return SimpleNamespace(returncode=0, stdout=json.dumps([info]), stderr="")
            if args[:3] == ["docker", "image", "inspect"]:
                return SimpleNamespace(returncode=0, stdout=json.dumps([{"Id": harness.IMAGE_ID}]), stderr="")
            if args[:2] == ["docker", "create"]:
                return SimpleNamespace(returncode=0, stdout=created, stderr="")
            if args[:2] == ["docker", "exec"]:
                raise RuntimeError("provisioning reached the replacement")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

        class ReservedPort:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def bind(self, address): pass
            def getsockname(self): return ("127.0.0.1", 49123)

        with patch.object(harness, "run", side_effect=fake_run), patch.object(harness.shutil, "which", return_value="docker"), patch.object(harness.socket, "socket", return_value=ReservedPort()):
            with self.assertRaises(RuntimeError):
                harness.main()
        self.assertFalse(any(args[:2] == ["docker", "exec"] for args in commands), "wrong inspected ID must deny before any provisioning")
        self.assertFalse(any(args[:2] == ["docker", "rm"] for args in commands), "never remove a replacement container")
        self.assertTrue(all(args[2] == created for args in commands if args[:2] == ["docker", "start"]), "start must use the created ID, not its mutable name")


if __name__ == "__main__":
    unittest.main()
