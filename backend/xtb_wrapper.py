
import os
import subprocess
from pathlib import Path


class XTBWrapper:
    """Run xTB geometry optimization on an XYZ structure."""

    def __init__(self, work_dir=None, timeout=900):
        self.work_dir = Path(work_dir or os.getcwd()).resolve()
        self.timeout = timeout
        self.work_dir.mkdir(parents=True, exist_ok=True)

    def build_command(self, xyz_file, charge=0, uhf=0, gfn=2):
        xyz_path = Path(xyz_file).resolve()

        return [
            "xtb",
            str(xyz_path),
            "--opt",
            "--gfn", str(gfn),
            "--chrg", str(charge),
            "--uhf", str(uhf),
        ]

    def optimize(self, xyz_file, charge=0, uhf=0, gfn=2):
        xyz_path = Path(xyz_file).resolve()

        if not xyz_path.is_file():
            return {
                "status": "error",
                "message": f"XYZ file not found: {xyz_path}",
            }

        output_path = self.work_dir / "xtb.out"
        geometry_path = self.work_dir / "xtbopt.xyz"

        # Avoid mistakenly returning a result from a previous run.
        geometry_path.unlink(missing_ok=True)

        command = self.build_command(
            xyz_path, charge=charge, uhf=uhf, gfn=gfn
        )

        try:
            with output_path.open("w", encoding="utf-8") as output_file:
                subprocess.run(
                    command,
                    cwd=self.work_dir,
                    stdout=output_file,
                    stderr=subprocess.STDOUT,
                    check=True,
                    timeout=self.timeout,
                    text=True,
                )

        except subprocess.TimeoutExpired:
            return {
                "status": "error",
                "message": f"xTB exceeded the {self.timeout}-second timeout.",
                "output": str(output_path),
            }
        except (subprocess.CalledProcessError, OSError) as exc:
            return {
                "status": "error",
                "message": f"xTB execution failed: {exc}",
                "output": str(output_path),
            }

        if not geometry_path.is_file():
            return {
                "status": "error",
                "message": "xTB finished without producing xtbopt.xyz.",
                "output": str(output_path),
            }

        energy = None
        with output_path.open(encoding="utf-8", errors="replace") as stream:
            for line in stream:
                if "TOTAL ENERGY" in line:
                    parts = line.split()
                    try:
                        energy = float(parts[-3])
                    except (ValueError, IndexError):
                        continue

        if energy is None:
            return {
                "status": "error",
                "message": "Optimized geometry exists, but final energy could not be parsed.",
                "geometry": str(geometry_path),
                "output": str(output_path),
            }

        return {
            "status": "success",
            "geometry": str(geometry_path),
            "energy": energy,
            "output": str(output_path),
        }
