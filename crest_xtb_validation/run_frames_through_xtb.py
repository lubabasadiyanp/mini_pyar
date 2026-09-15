"""
Run selected CREST conformer frames through XTBWrapper.optimize()
and collect the resulting energies into a CSV table.

Run this from inside ~/crest_xtb_validation, with your venv active:
    python run_frames_through_xtb.py
"""

import csv
import sys
from pathlib import Path

from pyar.wrapper.xtb_wrapper import XTBWrapper

# ---- CONFIG ----
FRAMES_DIR = Path("selected_frames")
FRAME_FILES = ["frame_1.xyz", "frame_5.xyz", "frame_10.xyz", "frame_15.xyz", "frame_20.xyz"]
OUTPUT_CSV = Path("xtb_frame_energies.csv")


def extract_energy(result, frame_name):
    """
    Try common patterns to pull an energy value out of whatever
    optimize() returns. Prints the raw result the first time so
    you can confirm the real structure.
    """
    print(f"\n--- Raw result for {frame_name} ---")
    print(repr(result))
    print("--- end raw result ---\n")

    # dict-like result, e.g. {"energy": -69.018, "geometry": [...]}
    if isinstance(result, dict):
        for key in ("energy", "final_energy", "optimized_energy", "total_energy"):
            if key in result:
                return result[key]

    # object with an attribute, e.g. result.energy
    for attr in ("energy", "final_energy", "optimized_energy", "total_energy"):
        if hasattr(result, attr):
            return getattr(result, attr)

    # tuple/list result, e.g. (geometry, energy)
    if isinstance(result, (tuple, list)) and len(result) >= 1:
        # heuristic: energy is usually a single float among the returned items
        for item in result:
            if isinstance(item, (int, float)):
                return item

    # fallback: couldn't figure it out automatically
    print(f"!! Could not auto-extract energy for {frame_name}. "
          f"Look at the raw result above and edit extract_energy() accordingly.")
    return None


def main():
    xtb = XTBWrapper()
    rows = []

    for frame_file in FRAME_FILES:
        frame_path = FRAMES_DIR / frame_file
        if not frame_path.exists():
            print(f"WARNING: {frame_path} not found, skipping.")
            continue

        print(f"Running xTB optimization on {frame_file} ...")
        try:
            result = xtb.optimize(str(frame_path))
        except Exception as e:
            print(f"ERROR running {frame_file}: {e}")
            rows.append({"frame": frame_file, "xtb_energy": None, "error": str(e)})
            continue

        energy = extract_energy(result, frame_file)
        rows.append({"frame": frame_file, "xtb_energy": energy, "error": ""})

    # Write results to CSV
    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["frame", "xtb_energy", "error"])
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nDone. Results saved to {OUTPUT_CSV}")
    for row in rows:
        print(row)


if __name__ == "__main__":
    main()
