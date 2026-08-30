"""
Шаг 6: Молекулярный докинг — AutoDock Vina (через официальный Windows-бинарник vina.exe,
т.к. питоновские байндинги 'vina' не собираются под Windows без Boost/компилятора).
Каждая молекула докуется к каждой мишени. Сохраняем top-5 поз и binding affinity.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VINA = ROOT / "bin" / "vina.exe"
LIGANDS_DIR = ROOT / "results" / "ligands"
RECEPTORS_DIR = ROOT / "results" / "receptors"
OUT_DIR = ROOT / "results" / "docking"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BOXES = json.loads((ROOT / "results" / "binding_sites.json").read_text(encoding="utf-8"))
MOLECULES = json.loads((ROOT / "data" / "molecules.json").read_text(encoding="utf-8"))

TARGETS = list(BOXES.keys())
LIGAND_NAMES = list(MOLECULES.keys())

EXHAUSTIVENESS = 16  # выше дефолта (8) — надёжнее сходимость для сравнительного анализа
NUM_MODES = 5


def run_docking(ligand: str, target: str) -> dict:
    ligand_pdbqt = LIGANDS_DIR / f"{ligand}.pdbqt"
    receptor_pdbqt = RECEPTORS_DIR / f"{target}.pdbqt"
    out_pdbqt = OUT_DIR / f"{ligand}__{target}.pdbqt"
    log_path = OUT_DIR / f"{ligand}__{target}.log"

    box = BOXES[target]
    cmd = [
        str(VINA),
        "--receptor", str(receptor_pdbqt),
        "--ligand", str(ligand_pdbqt),
        "--center_x", str(box["center"][0]),
        "--center_y", str(box["center"][1]),
        "--center_z", str(box["center"][2]),
        "--size_x", str(box["size"][0]),
        "--size_y", str(box["size"][1]),
        "--size_z", str(box["size"][2]),
        "--exhaustiveness", str(EXHAUSTIVENESS),
        "--num_modes", str(NUM_MODES),
        "--out", str(out_pdbqt),
        "--seed", "42",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ROOT))
    log_path.write_text(result.stdout + "\n" + result.stderr, encoding="utf-8")

    if result.returncode != 0:
        return {"ligand": ligand, "target": target, "status": "error",
                "error": result.stderr[-1000:] if result.stderr else result.stdout[-1000:]}

    affinities = parse_affinities(result.stdout)
    return {
        "ligand": ligand,
        "target": target,
        "status": "ok",
        "best_affinity_kcal_mol": affinities[0] if affinities else None,
        "all_modes_kcal_mol": affinities,
        "out_pdbqt": str(out_pdbqt),
    }


def parse_affinities(stdout: str) -> list:
    affinities = []
    in_table = False
    for line in stdout.splitlines():
        line = line.strip()
        if line.startswith("mode"):
            in_table = True
            continue
        if in_table and line and line[0].isdigit():
            parts = line.split()
            try:
                affinities.append(float(parts[1]))
            except (IndexError, ValueError):
                pass
    return affinities


def main():
    all_results = []
    total = len(LIGAND_NAMES) * len(TARGETS)
    i = 0
    for ligand in LIGAND_NAMES:
        for target in TARGETS:
            i += 1
            print(f"[{i}/{total}] {ligand} -> {target} ...", flush=True)
            res = run_docking(ligand, target)
            all_results.append(res)
            if res["status"] == "ok":
                print(f"    best affinity: {res['best_affinity_kcal_mol']} kcal/mol")
            else:
                print(f"    ОШИБКА: {res['error']}")

    out_json = ROOT / "results" / "docking_results.json"
    out_json.write_text(json.dumps(all_results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nВсе результаты сохранены: {out_json}")


if __name__ == "__main__":
    main()
