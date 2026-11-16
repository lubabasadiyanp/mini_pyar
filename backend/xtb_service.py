
import sys
import tempfile
from pathlib import Path

from xtb_wrapper import XTBWrapper


def optimize_xyz(
    xyz_content: str,
    charge: int = 0,
    uhf: int = 0,
    gfn: int = 2,
) -> dict:
    """Optimize an uploaded XYZ structure using the custom xTB wrapper."""

    with tempfile.TemporaryDirectory(prefix="pyar-web-xtb-") as temp_dir:
        work_dir = Path(temp_dir)
        xyz_path = work_dir / "input.xyz"
        xyz_path.write_text(xyz_content, encoding="utf-8")

        wrapper = XTBWrapper(work_dir=work_dir)
        result = wrapper.optimize(
            str(xyz_path),
            charge=charge,
            uhf=uhf,
            gfn=gfn,
        )

        if result.get("status") != "success":
            return result

        geometry_path = Path(result["geometry"])
        if not geometry_path.is_file():
            return {
                "status": "error",
                "message": "The optimized XYZ file was not found.",
            }

        # Read the geometry before the temporary directory is deleted.
        optimized_xyz = geometry_path.read_text(encoding="utf-8")

        return {
            "status": "success",
            "energy": result["energy"],
            "xyz": optimized_xyz,
        }
