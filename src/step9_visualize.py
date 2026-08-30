"""
Шаг 7 (часть 1): 3D-визуализация — py3Dmol, интерактивный HTML на пару молекула-мишень.
Рендерим: белок (мультяшный cartoon, серый) + активный сайт (поверхность кармана) +
лиганд в его лучшей позе (top-1 из докинга, палочки, цвет по элементам).
"""
import json
from pathlib import Path

import py3Dmol

ROOT = Path(__file__).resolve().parent.parent
DOCKING_DIR = ROOT / "results" / "docking"
RECEPTORS_DIR = ROOT / "results" / "receptors"
VIZ_DIR = ROOT / "results" / "viz"
VIZ_DIR.mkdir(parents=True, exist_ok=True)

BOXES = json.loads((ROOT / "results" / "binding_sites.json").read_text(encoding="utf-8"))


def render_pair(ligand: str, target: str) -> Path:
    receptor_pdb = (ROOT / "results" / "pdb" / f"{target}_protein.pdb").read_text(encoding="utf-8")
    ligand_pdbqt_path = DOCKING_DIR / f"{ligand}__{target}.pdbqt"
    ligand_block = ligand_pdbqt_path.read_text(encoding="utf-8")
    # 3Dmol.js не умеет парсить ROOT/BRANCH/ENDBRANCH из PDBQT (рендерит только ROOT-фрагмент) —
    # берём первую (лучшую) позу и оставляем только ATOM/HETATM-строки, как обычный PDB
    best_pose_lines = []
    for line in ligand_block.splitlines():
        if line.startswith("ENDMDL"):
            break
        if line.startswith(("ATOM", "HETATM")):
            best_pose_lines.append(line[:66])  # отрезаем колонки partial charge/AD-тип, не нужные PDB-парсеру
    best_pose_pdbqt = "\n".join(best_pose_lines) + "\nEND\n"

    box = BOXES[target]

    view = py3Dmol.view(width=900, height=650)
    view.addModel(receptor_pdb, "pdb")
    view.setStyle({"model": 0}, {"cartoon": {"color": "spectrum", "opacity": 0.85}})

    view.addModel(best_pose_pdbqt, "pdb")
    view.setStyle({"model": 1}, {"stick": {"colorscheme": "yellowCarbon", "radius": 0.25}})

    view.addBox({
        "center": {"x": box["center"][0], "y": box["center"][1], "z": box["center"][2]},
        "dimensions": {"w": box["size"][0], "h": box["size"][1], "d": box["size"][2]},
        "color": "cyan", "opacity": 0.15, "wireframe": True,
    })

    view.zoomTo({"model": 1})
    view.zoom(0.6)

    out_path = VIZ_DIR / f"{ligand}__{target}.html"
    view.write_html(str(out_path), fullpage=False)
    return out_path


def main():
    docking = json.loads((ROOT / "results" / "docking_results.json").read_text(encoding="utf-8"))
    ok_results = [r for r in docking if r["status"] == "ok"]
    for r in ok_results:
        path = render_pair(r["ligand"], r["target"])
        print(f"{r['ligand']} -> {r['target']}: {path}")


if __name__ == "__main__":
    main()
