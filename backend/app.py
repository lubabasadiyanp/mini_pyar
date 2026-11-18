
import csv
import os
import signal
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from aggregation_service import (
    aggregation_jobs,
    install_windows_executable_lookup,
    install_windows_text_compatibility,
)
from xtb_service import optimize_xyz


PYAR_EXECUTABLE = Path(
    os.environ.get("PYAR_EXECUTABLE")
    or shutil.which("pyar-conformer")
    or "/home/lubaba/pyar/.venv/bin/pyar-conformer"
)
TIMEOUT_SECONDS = int(os.environ.get("PYAR_TIMEOUT_SECONDS", "900"))

app = FastAPI(title="PyAR Molecular API")

origins = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/aggregation-jobs")
async def start_aggregation_job(
    file: UploadFile = File(...),
    aggregate_size: int = Form(...),
    orientations: int = Form(...),
):
    filename = Path((file.filename or "").replace("\\", "/")).name
    if not filename.lower().endswith(".xyz"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a file with the .xyz extension.",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded XYZ file is empty.")
    try:
        job = aggregation_jobs.start_job(filename, content, aggregate_size, orientations)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "logs": [],
        "nodes": [],
    }


@app.get("/api/aggregation-jobs/{job_id}")
def get_aggregation_job(job_id: str):
    snapshot = aggregation_jobs.snapshot(job_id)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Aggregation job was not found.")
    return snapshot


@app.get("/api/aggregation-jobs/{job_id}/structures/{node_id}.xyz")
def get_aggregation_structure(job_id: str, node_id: str):
    structure_path = aggregation_jobs.structure_path(job_id, node_id)
    if structure_path is None or not structure_path.is_file():
        raise HTTPException(status_code=404, detail="The requested aggregation structure was not found.")
    from fastapi.responses import FileResponse

    return FileResponse(
        structure_path,
        media_type="chemical/x-xyz",
        filename=structure_path.name,
    )


@app.post("/api/run-conformer-analysis")
def run_conformer_analysis(file: UploadFile = File(...)):
    filename = Path(file.filename or "").name

    if not filename.lower().endswith(".xyz"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a file with the .xyz extension.",
        )

    if not PYAR_EXECUTABLE.is_file():
        raise HTTPException(
            status_code=503,
            detail=f"PyAR executable was not found at {PYAR_EXECUTABLE}.",
        )

    content = file.file.read()

    if not content:
        raise HTTPException(
            status_code=400,
            detail="The uploaded XYZ file is empty.",
        )

    with tempfile.TemporaryDirectory(prefix="pyar-analysis-") as temp_dir:
        workdir = Path(temp_dir)
        input_path = workdir / filename
        input_path.write_bytes(content)

        command = [
            str(PYAR_EXECUTABLE),
            str(input_path),
            "--software", "xtb",
            "--num-conformers", "5",
            "--top-n", "3",
        ]
        command_env = os.environ.copy()

        try:
            if os.name == "nt":
                try:
                    for executable_name in ("xtb", "obabel"):
                        install_windows_executable_lookup(workdir, command_env, executable_name)
                except RuntimeError as exc:
                    raise HTTPException(status_code=503, detail=str(exc)) from exc
                install_windows_text_compatibility(workdir, command_env)

            try:
                help_result = subprocess.run(
                    [str(PYAR_EXECUTABLE), "--help"],
                    cwd=workdir,
                    env=command_env,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            except subprocess.TimeoutExpired as exc:
                raise HTTPException(
                    status_code=504,
                    detail="PyAR did not return its conformer options within 30 seconds.",
                ) from exc
            if help_result.returncode != 0:
                raise HTTPException(
                    status_code=500,
                    detail=(
                        "Could not inspect PyAR conformer options: "
                        f"{help_result.stderr or help_result.stdout}"
                    ),
                )
            supported_options = help_result.stdout + help_result.stderr
            for option, value in (
                ("--num-seeds", "1"),
                ("--torsion-rounds", "1"),
                ("--torsion-kicks-per-conformer", "2"),
            ):
                if option in supported_options:
                    command.extend((option, value))

            process = subprocess.Popen(
                command,
                cwd=workdir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=command_env,
                start_new_session=True,
            )

            try:
                stdout, stderr = process.communicate(
                    timeout=TIMEOUT_SECONDS
                )

            except subprocess.TimeoutExpired as exc:
                if os.name == "nt":
                    process.terminate()
                else:
                    os.killpg(process.pid, signal.SIGTERM)

                try:
                    stdout, stderr = process.communicate(timeout=10)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        process.kill()
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                    stdout, stderr = process.communicate()

                partial_stdout = (
                    exc.stdout.decode(errors="replace")
                    if isinstance(exc.stdout, bytes)
                    else (exc.stdout or "")
                )
                partial_stderr = (
                    exc.stderr.decode(errors="replace")
                    if isinstance(exc.stderr, bytes)
                    else (exc.stderr or "")
                )

                raise HTTPException(
                    status_code=504,
                    detail={
                        "message": (
                            f"PyAR exceeded the {TIMEOUT_SECONDS}-second timeout."
                        ),
                        "stdout": stdout or partial_stdout,
                        "stderr": stderr or partial_stderr,
                    },
                ) from exc

        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Could not start PyAR: {exc}",
            ) from exc

        summary_path = workdir / "conformers" / "summary.csv"

        # Some pyar-conformer launchers exit nonzero after returning a result object.
        if process.returncode != 0 and not (
            summary_path.is_file()
            and "Conformer workflow: completed" in stdout.splitlines()
        ):
            raise HTTPException(
                status_code=500,
                detail={
                    "message": f"PyAR exited with status {process.returncode}.",
                    "stdout": stdout,
                    "stderr": stderr,
                },
            )

        if not summary_path.is_file():
            raise HTTPException(
                status_code=500,
                detail={
                    "message": (
                        "PyAR completed without producing "
                        "conformers/summary.csv."
                    ),
                    "stdout": stdout,
                    "stderr": stderr,
                },
            )

        with summary_path.open(
            newline="",
            encoding="utf-8",
        ) as stream:
            rows = list(csv.DictReader(stream))

        successful_rows = []

        for row in rows:
            try:
                energy = float(row["backend_energy"])
            except (KeyError, TypeError, ValueError):
                continue

            if row.get("backend_status") == "success":
                successful_rows.append((energy, row))

        successful_rows.sort(key=lambda result: result[0])

        conformers = []

        for rank, (energy, row) in enumerate(successful_rows[:3]):
            conformer_id = f"conf_{rank:04d}"

            xyz_file = (
                workdir
                / "conformers"
                / "selected"
                / f"{conformer_id}.xyz"
            )

            if not xyz_file.is_file():
                raise HTTPException(
                    status_code=500,
                    detail={
                        "message": (
                            "PyAR did not produce the selected XYZ file "
                            f"{conformer_id}.xyz."
                        ),
                        "stdout": stdout,
                        "stderr": stderr,
                    },
                )

            conformers.append(
                {
                    "rank": rank,
                    "id": conformer_id,
                    "energy": energy,
                    "backend_status": row.get(
                        "backend_status", "unknown"
                    ),
                    "xyz": xyz_file.read_text(encoding="utf-8"),
                }
            )

        if not conformers:
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "PyAR produced no conformer rows.",
                    "stdout": stdout,
                    "stderr": stderr,
                },
            )

        return {
            "status": "success",
            "input_file": {"name": filename, "format": "xyz"},
            "conformers": conformers,
            "stdout": stdout,
        }


@app.post("/api/run-xtb-optimization")
async def run_xtb_optimization(
    file: UploadFile = File(...),
    charge: int = Form(0),
    uhf: int = Form(0),
    gfn: int = Form(2),
):
    """Run a single geometry optimization using our custom XTBWrapper."""

    filename = Path(file.filename or "").name

    if not filename.lower().endswith(".xyz"):
        raise HTTPException(
            status_code=400,
            detail="Please upload a file with the .xyz extension.",
        )

    content = await file.read()

    if not content:
        raise HTTPException(
            status_code=400,
            detail="The uploaded XYZ file is empty.",
        )

    try:
        xyz_text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file must be valid UTF-8 text.",
        ) from exc

    # Validate the XYZ atom count and coordinate rows.
    lines = xyz_text.strip().splitlines()

    try:
        atom_count = int(lines[0].strip())

        if atom_count <= 0 or len(lines) < atom_count + 2:
            raise ValueError("Missing coordinate rows.")

        for line in lines[2:atom_count + 2]:
            parts = line.split()

            if len(parts) < 4:
                raise ValueError("Invalid coordinate row.")

            float(parts[1])
            float(parts[2])
            float(parts[3])

    except (ValueError, IndexError):
        raise HTTPException(
            status_code=400,
            detail="Invalid XYZ format or incomplete coordinate data.",
        )

    if gfn not in (0, 1, 2, 3):
        raise HTTPException(
            status_code=400,
            detail="GFN must be 0, 1, 2, or 3.",
        )

    try:
        result = optimize_xyz(
            xyz_content=xyz_text,
            charge=charge,
            uhf=uhf,
            gfn=gfn,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Unexpected error while running the custom xTB wrapper.",
        ) from exc

    if result.get("status") != "success":
        raise HTTPException(
            status_code=422,
            detail=result.get(
                "message",
                "xTB geometry optimization failed.",
            ),
        )

    return {
        "status": "success",
        "filename": filename,
        "energy": result["energy"],
        "xyz": result["xyz"],
    }
