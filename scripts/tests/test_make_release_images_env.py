import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[2]
GENERATOR = ROOT / "scripts" / "make_release_images_env.py"


class ReleaseImagesEnvTests(unittest.TestCase):
    def test_emits_dedicated_variant_digests_and_coherent_cpu_active_pair(self):
        digest = lambda char: "sha256:" + char * 64
        manifest = "\n".join([
            f"ghcr.io/unstable-branch/sdm-dashboard/sdm-api@{digest('a')}",
            f"ghcr.io/unstable-branch/sdm-dashboard/sdm-frontend@{digest('b')}",
            f"ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-cpu@{digest('c')}",
            f"ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-cuda@{digest('d')}",
            f"ghcr.io/unstable-branch/sdm-dashboard/sdm-plumber-rocm@{digest('e')}",
        ])
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "digests.txt", Path(directory) / "release-images.env"
            source.write_text(manifest + "\n")
            subprocess.run(["python3", str(GENERATOR), str(source), str(output)], check=True, cwd=ROOT)
            generated = output.read_text()
        self.assertIn(f"SDM_PLUMBER_CPU_DIGEST={digest('c')}", generated)
        self.assertIn(f"SDM_PLUMBER_CUDA_DIGEST={digest('d')}", generated)
        self.assertIn(f"SDM_PLUMBER_ROCM_DIGEST={digest('e')}", generated)
        self.assertIn("SDM_PLUMBER_VARIANT=cpu", generated)
        self.assertIn(f"SDM_PLUMBER_DIGEST={digest('c')}", generated)


if __name__ == "__main__":
    unittest.main()
