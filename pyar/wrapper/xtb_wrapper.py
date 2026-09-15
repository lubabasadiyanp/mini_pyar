import os
import subprocess

"""
xtb_wrapper.py
A simple python wrapper around the PyAR xTB backend.
"""

class XTBWrapper:
  def __init__(self):
     print("XTBWrapper initialized.")
  
  def build_command(self, xyz_file, charge=0, uhf=0, gfn=2):
     return [
         "xtb",
         xyz_file,
         "--opt",
         "--gfn",str(gfn),
         "--chrg", str(charge),
         "--uhf", str(uhf)
     ]

  def optimize(self, xyz_file, charge=0, uhf=0, gfn=2):
    if not os.path.exists(xyz_file):
      print(f"Error: '{xyz_file}' not found.")
      return False

    command = self.build_command(
        xyz_file,
        charge,
        uhf,
        gfn
    )

    print("Running command:", " ".join(command))

    try:
        with open("xtb.out", "w") as output_file:
            subprocess.run(
                command,
                check=True,
                stdout=output_file,
                stderr=output_file
            )

        print("Optimization completed successfully.")
        result = {
                "status": "Success",
                "geometry": None,
                "energy": None
        }
        if os.path.exists("xtbopt.xyz"):
          result["geometry"] = "xtbopt.xyz"
          print("Optimized geometry file created: xtbopt.xyz")

        else:
          print("Optimization finished, but xtbopt.xyz was not found.")

        if os.path.exists("xtb.out"):
            with open("xtb.out", "r") as file:
                for line in file:
                   if "TOTAL ENERGY" in line:
                     final_energy = line.split()[3]
                     result["energy"] = final_energy
                     print(f"Final Energy:{final_energy} Eh")
                     break

        return result

    except subprocess.CalledProcessError:

       print("Optimization failed.")

       return False    
    
