from pathlib import Path
import csv
import os

from pyar.wrapper.xtb_wrapper import XTBWrapper


# Assignment folder
BASE_DIR = Path.home() / "crest_xtb_validation"

# Input folders
PYAR_DIR = BASE_DIR / "pyar_frames"
CREST_DIR = BASE_DIR / "crest_frames"

# Results folder
RESULTS_DIR = BASE_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)


# Create the same XTBWrapper for all conformers
xtb = XTBWrapper()

results = []


def run_conformers(source, folder):
    """Run all XYZ files from one source through XTBWrapper."""

    for xyz_file in sorted(folder.glob("*.xyz")):
        print(f"\nRunning {source}: {xyz_file.name}")

        # Separate folder for this calculation
        run_dir = RESULTS_DIR / f"{source}_{xyz_file.stem}"
        run_dir.mkdir(exist_ok=True)

        # XTBWrapper writes its output in the current working directory,
        # so run each calculation inside its own result folder.
        old_dir = os.getcwd()
        os.chdir(run_dir)

        try:
            result = xtb.optimize(str(xyz_file.resolve()))

            results.append({
                "Source": source,
                "Conformer": xyz_file.name,
                "Energy_Eh": result.get("energy", ""),
                "Status": result.get("status", "")
            })

            print(f"Status: {result.get('status', '')}")
            print(f"Energy: {result.get('energy', '')} Eh")

        except Exception as e:
            results.append({
                "Source": source,
                "Conformer": xyz_file.name,
                "Energy_Eh": "",
                "Status": f"Failed: {e}"
            })

            print(f"ERROR: {e}")

        finally:
            os.chdir(old_dir)


# Run the 5 PyAR conformers
run_conformers("PyAR", PYAR_DIR)

# Run the 5 CREST conformers
run_conformers("CREST", CREST_DIR)


# Save the comparison table
csv_file = RESULTS_DIR / "xtb_comparison.csv"

with open(csv_file, "w", newline="") as f:
    writer = csv.DictWriter(
        f,
        fieldnames=["Source", "Conformer", "Energy_Eh", "Status"]
    )
    writer.writeheader()
    writer.writerows(results)


print("\n" + "=" * 50)
print("XTB comparison completed")
print("=" * 50)
print(f"Results saved to: {csv_file}")
print(f"Total conformers processed: {len(results)}")
