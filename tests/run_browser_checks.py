"""Run independent browser checks with bounded parallelism and live timings."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent
# Start the longest checks first so smaller checks can use the other worker.
CHECKS = [
    "history_smoke", "tool_windows_smoke", "layout_smoke",
    "symmetry_selection_smoke", "pair_defaults_smoke", "project_smoke",
    "pages_smoke", "library_smoke", "touch_pan_smoke", "page_zoom_smoke",
    "turn_smoke", "analysis_smoke", "direction_inputs_smoke",
    "axis_framing_smoke", "detector_smoke", "gui_review_smoke",
    "window_controls_smoke", "science_layout_smoke",
]


def run_check(name, timeout):
    start = time.monotonic()
    print(f"[{name}] START", flush=True)
    process = subprocess.Popen(
        [sys.executable, "-u", str(HERE / f"{name}.py")],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        start_new_session=os.name == "posix",
    )
    expired = threading.Event()

    def stop():
        # Also stop orphaned browser children that keep stdout open after
        # their Python test exited; waiting for EOF must have a deadline too.
        expired.set()
        print(f"[{name}] TIMEOUT after {timeout:g}s", flush=True)
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            elif process.poll() is None:
                process.kill()
        except ProcessLookupError:
            pass

    timer = threading.Timer(timeout, stop)
    timer.start()
    try:
        for line in process.stdout:
            print(f"[{name}] {line.rstrip()}", flush=True)
        code = process.wait()
    finally:
        timer.cancel()
        process.stdout.close()
    passed = code == 0 and not expired.is_set()
    elapsed = time.monotonic() - start
    print(f"[{name}] {'PASS' if passed else 'FAIL'} in {elapsed:.1f}s", flush=True)
    return name, passed, elapsed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checks", nargs="*", help="Optional check names; defaults to the complete CI suite")
    parser.add_argument("--workers", type=int, choices=range(1, 5), default=2)
    parser.add_argument("--timeout", type=float, default=360)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    unknown = set(args.checks) - set(CHECKS)
    if unknown:
        parser.error("unknown checks: " + ", ".join(sorted(unknown)))
    checks = args.checks or CHECKS
    start = time.monotonic()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda name: run_check(name, args.timeout), checks))
    print("\nBrowser check timings:", flush=True)
    for name, passed, elapsed in sorted(results, key=lambda result: -result[2]):
        print(f"  {'PASS' if passed else 'FAIL'} {name}: {elapsed:.1f}s", flush=True)
    print(f"Total wall time: {time.monotonic() - start:.1f}s", flush=True)
    return 0 if all(result[1] for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
