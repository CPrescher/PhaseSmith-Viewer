"""Representative CI coverage; full display matrices remain the local default."""
import os

PROFILE = os.environ.get("VIEWER_TEST_PROFILE", "ci" if os.environ.get("CI") else "full")
if PROFILE not in {"ci", "full"}:
    raise ValueError("VIEWER_TEST_PROFILE must be ci or full")
QUICK = PROFILE == "ci"
