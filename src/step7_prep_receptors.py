"""
Шаг 5 (часть 3): подготовка рецепторов (удаление воды/гетерогрупп уже сделано в Шаге 4,
здесь — добавление водородов, зарядов и конвертация в PDBQT) + запись vina-конфигов
с координатами бокса для каждой мишени.
"""
import json
import subprocess
import sys
from pathlib import Path

from winpath import short_path

PDB_DIR = Path(__file__).resolve().parent.parent / "results" / "pdb"
RESULTS_DIR = Path(__file__).resolve().parent.parent / "results" / "receptors"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
BOXES = json.loads((Path(__file__).resolve().parent.parent / "results" / "binding_sites.json").read_text(encoding="utf-8"))

MK_PREPARE_RECEPTOR = Path(sys.executable).parent / "mk_prepare_receptor.exe"


def prep_receptor(pdb_id: str, box: dict):
    protein_pdb = PDB_DIR / f"{pdb_id}_protein.pdb"
    out_base = RESULTS_DIR / pdb_id

    base_cmd = [
        str(MK_PREPARE_RECEPTOR),
        "--read_pdb", short_path(protein_pdb),
        "-o", short_path(out_base),
        "-p",  # write pdbqt
        "-v",  # write vina box config
        "--box_center", *[str(x) for x in box["center"]],
        "--box_size", *[str(x) for x in box["size"]],
        "--default_altloc", "A",  # при наличии альтернативных конформаций остатка берём вариант A
    ]
    result = subprocess.run(base_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        # остатки, не совпавшие ни с одним химическим шаблоном (модифицированные а/к, лиганды
        # в белковой цепи) — удаляем их вместо падения всего расчёта
        cmd = base_cmd + ["-x"]
        result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"mk_prepare_receptor не смог обработать {pdb_id}:\n{result.stdout}\n{result.stderr}")
    return result.stdout, result.stderr


def main():
    for pdb_id, box in BOXES.items():
        print(f"--- {pdb_id} ---")
        out, err = prep_receptor(pdb_id, box)
        if out.strip():
            print(out)
        if err.strip():
            print("stderr:", err)
        pdbqt = RESULTS_DIR / f"{pdb_id}.pdbqt"
        print(f"  ok: {pdbqt.exists()}")


if __name__ == "__main__":
    main()
