"""Run PyAR aggregation jobs and expose structures from their real outputs."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import threading
import uuid
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


MAX_UPLOAD_BYTES = 25 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 3600
XYZ_FLOAT = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?")
AGGREGATE_DIRECTORY = re.compile(r"^ag_(?P<composition>(?:[a-z]_\d{3}_)+)(?P<pathway>\d{3})$")
STAGE_RESULT = re.compile(r"^result_(\d{3})_(\d{3})_ag_")


@dataclass
class Job:
    job_id: str
    directory: Path
    filename: str
    status: str = "queued"
    progress: int = 0
    message: str = "Queued for PyAR aggregation."
    return_code: int | None = None
    structures: dict[str, Path] = field(default_factory=dict)


def _read_xyz(path: Path) -> tuple[list[tuple[str, float, float, float]], str]:
    text = path.read_text(encoding="utf-8")
    return _parse_xyz(text)


def _parse_xyz(text: str) -> tuple[list[tuple[str, float, float, float]], str]:
    lines = text.splitlines()
    if len(lines) < 3:
        raise ValueError("The XYZ file must contain an atom count, comment, and coordinates.")
    try:
        count = int(lines[0].strip())
    except ValueError as exc:
        raise ValueError("The first XYZ line must contain the atom count.") from exc
    if count < 1 or len(lines) < count + 2:
        raise ValueError("The XYZ atom count is invalid or its coordinate rows are incomplete.")

    atoms = []
    for row_number, line in enumerate(lines[2:count + 2], start=3):
        parts = line.split()
        if len(parts) < 4 or not re.fullmatch(r"[A-Za-z]{1,3}", parts[0]):
            raise ValueError(f"XYZ coordinate row {row_number} is invalid.")
        try:
            x, y, z = (float(value.replace("D", "E").replace("d", "e")) for value in parts[1:4])
        except ValueError as exc:
            raise ValueError(f"XYZ coordinate row {row_number} has invalid coordinates.") from exc
        if not all(math.isfinite(value) for value in (x, y, z)):
            raise ValueError(f"XYZ coordinate row {row_number} has non-finite coordinates.")
        atoms.append((parts[0][0].upper() + parts[0][1:].lower(), x, y, z))
    return atoms, lines[1].strip()


def _formula(atoms: list[tuple[str, float, float, float]]) -> str:
    counts = Counter(atom[0] for atom in atoms)
    order = []
    if "C" in counts:
        order.append("C")
    if "H" in counts:
        order.append("H")
    order.extend(sorted(element for element in counts if element not in {"C", "H"}))
    return "".join(element + (str(counts[element]) if counts[element] != 1 else "") for element in order)


def _energy_from_comment(comment: str) -> float | None:
    trailing = comment.rsplit(":", 1)[-1]
    matches = XYZ_FLOAT.findall(trailing)
    if not matches:
        return None
    try:
        return float(matches[-1])
    except ValueError:
        return None


def _composition(stage_directory: str) -> tuple[int | None, str | None, int | None]:
    match = AGGREGATE_DIRECTORY.fullmatch(stage_directory)
    if not match:
        return None, None, None
    pairs = re.findall(r"([a-z])_(\d{3})_", match.group("composition"))
    if not pairs:
        return None, None, None
    total = sum(int(count) for _, count in pairs)
    label = "".join(letter.upper() + (str(int(count)) if int(count) > 1 else "") for letter, count in pairs)
    return total, label, int(match.group("pathway"))


def _safe_node_id(relative_path: Path) -> str:
    stage_directory = next((part for part in relative_path.parts if AGGREGATE_DIRECTORY.fullmatch(part)), None)
    if stage_directory:
        return f"{stage_directory}_{relative_path.stem}"
    stoichiometry_directory = next(
        (part.removeprefix("stoichiometry_") for part in relative_path.parts if part.startswith("stoichiometry_")),
        None,
    )
    if stoichiometry_directory:
        source_stage = re.search(r"ag_(?:[a-z]_\d{3}_)+\d{3}", relative_path.stem)
        candidate = relative_path.stem.split("_selected_")[-1]
        stage_id = f"{source_stage.group(0)}_" if source_stage else ""
        return f"final_{stoichiometry_directory}_{stage_id}{candidate}"
    source = relative_path.as_posix()
    slug = re.sub(r"[^A-Za-z0-9_-]+", "_", source).strip("_")
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:10]
    return f"{slug[:100]}_{digest}"


def _coordinates_match(
    first: list[tuple[str, float, float, float]],
    second: list[tuple[str, float, float, float]],
) -> bool:
    if len(first) != len(second):
        return False
    return all(
        atom_a[0] == atom_b[0]
        and all(abs(a - b) <= 1e-4 for a, b in zip(atom_a[1:], atom_b[1:]))
        for atom_a, atom_b in zip(first, second)
    )


def install_windows_executable_lookup(job_directory: Path, env: dict[str, str], name: str) -> None:
    """Make Windows executables discoverable to PyAR's extensionless PATH lookup."""
    executable = shutil.which(name)
    if not executable:
        raise RuntimeError(f"The {name} executable was not found on PATH.")
    executable_path = Path(executable)
    if os.name == "nt" and executable_path.suffix.lower() == ".exe":
        compatibility_executable = job_directory / name
        try:
            os.link(executable_path, compatibility_executable)
        except OSError:
            shutil.copy2(executable_path, compatibility_executable)
        job_path = str(job_directory)
        if job_path not in env.get("PATH", "").split(os.pathsep):
            env["PATH"] = job_path + os.pathsep + env.get("PATH", "")


def _install_windows_xtb_lookup(job_directory: Path, env: dict[str, str]) -> None:
    install_windows_executable_lookup(job_directory, env, "xtb")


def install_windows_text_compatibility(job_directory: Path, env: dict[str, str]) -> None:
    """Allow PyAR's default text read of xTB output to replace undefined bytes."""
    compatibility_directory = job_directory / ".pyar-runtime"
    compatibility_directory.mkdir(exist_ok=True)
    sitecustomize = compatibility_directory / "sitecustomize.py"
    sitecustomize.write_text(
        "import builtins, locale, os\n"
        "_pyar_original_open = builtins.open\n"
        "def _pyar_open(file, mode='r', *args, **kwargs):\n"
        "    if 'b' not in mode and os.path.basename(os.fspath(file)).lower() == 'xtb.out' and kwargs.get('encoding') is None:\n"
        "        kwargs['encoding'] = locale.getpreferredencoding(False)\n"
        "        kwargs['errors'] = 'replace'\n"
        "    return _pyar_original_open(file, mode, *args, **kwargs)\n"
        "builtins.open = _pyar_open\n",
        encoding="utf-8",
    )
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(compatibility_directory) + (os.pathsep + existing if existing else "")


class AggregationJobManager:
    def __init__(self) -> None:
        configured_root = os.environ.get("PYAR_AGGREGATION_JOBS_DIR")
        self.root = Path(configured_root) if configured_root else Path(tempfile.gettempdir()) / "mini-pyar-aggregation-jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self.timeout_seconds = int(os.environ.get("PYAR_AGGREGATION_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS)))
        self.nprocs = max(1, int(os.environ.get("PYAR_AGGREGATION_NPROCS", "1")))
        self.jobs: dict[str, Job] = {}
        self.lock = threading.RLock()

    def start_job(self, filename: str, content: bytes, aggregate_size: int, orientations: int) -> Job:
        if aggregate_size < 1 or orientations < 1:
            raise ValueError("Aggregate size and orientations must be positive integers.")
        if len(content) > MAX_UPLOAD_BYTES:
            raise ValueError(f"The XYZ upload exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB size limit.")
        try:
            xyz_text = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("The XYZ upload must be UTF-8 text.") from exc
        _parse_xyz(xyz_text)

        executable = os.environ.get("PYAR_AGGREGATION_EXECUTABLE") or shutil.which("pyar-cli")
        if not executable:
            raise RuntimeError("Could not find pyar-cli. Add it to PATH or set PYAR_AGGREGATION_EXECUTABLE.")
        if not shutil.which("xtb"):
            raise RuntimeError("Could not find xtb on PATH.")

        job_id = uuid.uuid4().hex
        directory = self.root / job_id
        directory.mkdir(parents=True, exist_ok=False)
        safe_filename = Path(filename.replace("\\", "/")).name
        if not safe_filename.lower().endswith(".xyz"):
            safe_filename = "input.xyz"
        input_path = directory / safe_filename
        input_path.write_bytes(content)
        job = Job(job_id=job_id, directory=directory, filename=safe_filename)
        with self.lock:
            self.jobs[job_id] = job

        thread = threading.Thread(
            target=self._run_job,
            args=(job, executable, input_path, aggregate_size, orientations),
            name=f"pyar-aggregation-{job_id[:8]}",
            daemon=True,
        )
        thread.start()
        return job

    def _run_job(self, job: Job, executable: str, input_path: Path, aggregate_size: int, orientations: int) -> None:
        with self.lock:
            job.status = "running"
            job.message = "Starting PyAR aggregation."
        env = os.environ.copy()
        try:
            if os.name == "nt":
                _install_windows_xtb_lookup(job.directory, env)
                install_windows_text_compatibility(job.directory, env)
            command = [
                executable, "-a", input_path.name, "-as", str(aggregate_size),
                "-N", str(orientations), "--software", "xtb", "-nprocs", str(self.nprocs),
            ]
            process_log = job.directory / "process.log"
            with process_log.open("w", encoding="utf-8", errors="replace") as output:
                process = subprocess.Popen(
                    command,
                    cwd=job.directory,
                    env=env,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
                )
                try:
                    return_code = process.wait(timeout=self.timeout_seconds)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                    raise TimeoutError(f"PyAR exceeded the {self.timeout_seconds}-second timeout.")

            with self.lock:
                job.return_code = return_code
            nodes, structure_paths = self._extract_structures(job)
            state = self._read_state(job.directory)
            has_results = any(node["id"] != "input" for node in nodes)
            if return_code != 0:
                status = "failed"
                message = f"pyar-cli exited with status {return_code}."
            elif not state or state.get("status") != "completed":
                status = "failed"
                message = "pyar-cli exited without a completed aggregation state."
            elif not has_results:
                status = "failed"
                message = "PyAR completed but produced no selected XYZ structures. Review the job logs."
            else:
                status = "completed"
                message = f"PyAR completed; {len(nodes) - 1} structure files are available."
            with self.lock:
                job.status = status
                job.progress = 100 if status == "completed" else job.progress
                job.message = message
                job.structures = structure_paths
        except (OSError, RuntimeError, TimeoutError, ValueError) as exc:
            with self.lock:
                job.status = "failed"
                job.message = str(exc)
        except Exception as exc:
            with self.lock:
                job.status = "failed"
                job.message = f"Unexpected aggregation worker error: {exc}"

    @staticmethod
    def _read_state(directory: Path) -> dict[str, Any] | None:
        state_file = directory / "aggregates" / "state.json"
        try:
            value = json.loads(state_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def _extract_structures(self, job: Job) -> tuple[list[dict[str, Any]], dict[str, Path]]:
        job_root = job.directory.resolve()
        aggregate_root = (job.directory / "aggregates").resolve()
        state = self._read_state(job.directory) or {}
        state_paths: list[str] = []
        for record in state.get("completed_pathways", []):
            if isinstance(record, dict) and isinstance(record.get("selected_results"), list):
                state_paths.extend(path for path in record["selected_results"] if isinstance(path, str))
        final_paths = state.get("final_selected_results", [])
        if isinstance(final_paths, list):
            state_paths.extend(path for path in final_paths if isinstance(path, str))

        selected_files: set[Path] = set()
        for relative in state_paths:
            candidate = (aggregate_root / Path(relative.replace("\\", "/"))).resolve()
            try:
                candidate.relative_to(job_root)
            except ValueError:
                continue
            if candidate.is_file() and candidate.suffix.lower() == ".xyz":
                selected_files.add(candidate)
        selected_files.update(path.resolve() for path in aggregate_root.glob("ag_*/selected/result_*.xyz"))
        selected_files.update(path.resolve() for path in aggregate_root.glob("selected/stoichiometry_*/result_*.xyz"))

        pathways = state.get("pathways", [])
        pathway_labels = pathways if isinstance(pathways, list) else []
        input_path = job.directory / job.filename
        input_atoms, _ = _read_xyz(input_path)
        input_node: dict[str, Any] = {
            "id": "input",
            "stage_label": "Input molecule",
            "parent_id": None,
            "formula": _formula(input_atoms),
            "atom_count": len(input_atoms),
            "status": "completed",
            "output_file": job.filename,
            "xyz_url": f"/api/aggregation-jobs/{job.job_id}/structures/input.xyz",
        }
        nodes = [input_node]
        paths_by_id: dict[str, Path] = {"input": input_path}
        node_atoms: dict[str, list[tuple[str, float, float, float]]] = {"input": input_atoms}
        nodes_by_id: dict[str, dict[str, Any]] = {"input": {"_stage_size": 1}}
        pending: list[tuple[Path, dict[str, Any], list[tuple[str, float, float, float]]]] = []

        def sort_key(path: Path) -> tuple[int, str]:
            stage_directory = next((part for part in path.parts if AGGREGATE_DIRECTORY.fullmatch(part)), "")
            stage_size, _, pathway_index = _composition(stage_directory)
            return (stage_size or 1, str(pathway_index or 0) + path.as_posix())

        for xyz_path in sorted(selected_files, key=sort_key):
            try:
                atoms, comment = _read_xyz(xyz_path)
            except (OSError, UnicodeDecodeError, ValueError):
                continue
            relative = xyz_path.relative_to(job_root)
            node_id = _safe_node_id(relative)
            stage_directory = next((part for part in relative.parts if AGGREGATE_DIRECTORY.fullmatch(part)), "")
            stage_size, composition, pathway_index = _composition(stage_directory)
            is_final_selection = "stoichiometry_" in relative.as_posix()
            pathway = pathway_labels[pathway_index] if pathway_index is not None and pathway_index < len(pathway_labels) else None
            stage_label = "Final selection" if is_final_selection else (
                f"Aggregate size {stage_size}" if stage_size is not None else "Selected structure"
            )
            if composition:
                stage_label += f" · {composition}"
            if pathway and not is_final_selection:
                stage_label += f" · pathway {pathway}"
            energy = _energy_from_comment(comment)
            node: dict[str, Any] = {
                "id": node_id,
                "stage_label": stage_label,
                "formula": _formula(atoms),
                "atom_count": len(atoms),
                "status": "completed" if job.status in {"completed", "failed"} else "running",
                "candidate": xyz_path.stem,
                "output_file": relative.as_posix(),
                "xyz_url": f"/api/aggregation-jobs/{job.job_id}/structures/{node_id}.xyz",
            }
            if energy is not None:
                node["energy_hartree"] = energy
            if not is_final_selection:
                seed_match = STAGE_RESULT.match(xyz_path.name)
                if seed_match and stage_size is not None:
                    seed_file = xyz_path.parent.parent / f"seed_{seed_match.group(2)}" / "seed.xyz"
                    try:
                        seed_atoms, _ = _read_xyz(seed_file)
                        parents = [
                            parent_id
                            for parent_id, parent_atoms in node_atoms.items()
                            if len(parent_atoms) == len(seed_atoms)
                            and (parent_id == "input" or (nodes_by_id.get(parent_id, {}).get("_stage_size", 0) < stage_size))
                            and _coordinates_match(parent_atoms, seed_atoms)
                        ]
                        if len(parents) == 1:
                            node["parent_id"] = parents[0]
                    except (OSError, UnicodeDecodeError, ValueError):
                        pass
            pending.append((xyz_path, node, atoms))
            if not is_final_selection:
                node["_stage_size"] = stage_size or 0
            nodes_by_id[node_id] = node
            if not is_final_selection:
                node_atoms[node_id] = atoms
            paths_by_id[node_id] = xyz_path

        for _, node, _ in pending:
            node.pop("_stage_size", None)
            if "parent_id" not in node and node["stage_label"] == "Final selection":
                relative_candidate = node["candidate"]
                matching = [
                    other["id"] for _, other, _ in pending
                    if other.get("candidate") and relative_candidate.endswith("_selected_" + other["candidate"])
                ]
                if len(matching) == 1:
                    node["parent_id"] = matching[0]
            nodes.append(node)

        job.structures = paths_by_id
        return nodes, paths_by_id

    def snapshot(self, job_id: str) -> dict[str, Any] | None:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            return None
        nodes, structure_paths = self._extract_structures(job)
        state = self._read_state(job.directory) or {}
        completed = state.get("completed_pathways", [])
        pathways = state.get("pathways", [])
        if job.status == "completed":
            progress = 100
        elif isinstance(completed, list) and isinstance(pathways, list) and pathways:
            progress = min(99, int(len(completed) * 100 / len(pathways)))
        else:
            progress = 0
        logs = self._read_log(job.directory)
        with self.lock:
            job.progress = progress
            job.structures = structure_paths
            status = job.status
            message = job.message
            return_code = job.return_code
        if status == "running" and logs:
            message = logs[-1]
        result: dict[str, Any] = {
            "job_id": job.job_id,
            "status": status,
            "progress": progress,
            "message": message,
            "logs": logs,
            "nodes": nodes,
        }
        if return_code is not None:
            result["return_code"] = return_code
        return result

    @staticmethod
    def _read_log(directory: Path) -> list[str]:
        lines: list[str] = []
        for filename in ("pyar.log", "process.log"):
            path = directory / filename
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            lines.extend(line.strip() for line in text.splitlines() if line.strip())
        return lines[-80:]

    def structure_path(self, job_id: str, node_id: str) -> Path | None:
        with self.lock:
            job = self.jobs.get(job_id)
        if job is None:
            return None
        self._extract_structures(job)
        with self.lock:
            return job.structures.get(node_id)


aggregation_jobs = AggregationJobManager()
