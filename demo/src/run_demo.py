"""
Демонстрационный прогон пайплайна на НЕЙТРАЛЬНОМ примере (не относится к IP проекта):
кофеин (CID 2519) -> аденозиновый рецептор A2A (PDB 3EML).
Тот же пайплайн, что и в основном исследовании, только для публичного показа инвесторам.
Пишет настоящий транскрипт (transcript.jsonl) с реальными таймстемпами для плейбека на сайте.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

import requests
from rdkit import Chem
from rdkit.Chem import AllChem, Descriptors, Crippen, rdMolDescriptors
from Bio.PDB import PDBParser, PDBIO, Select
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RESULTS = ROOT / "results"
for d in (DATA, RESULTS / "pdb", RESULTS / "ligand", RESULTS / "receptor", RESULTS / "docking", RESULTS / "viz"):
    d.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(ROOT.parent / "src"))
from winpath import short_path  # noqa: E402

VINA = ROOT.parent / "bin" / "vina.exe"
MK_LIGAND = Path(sys.executable).parent / "mk_prepare_ligand.exe"
MK_RECEPTOR = Path(sys.executable).parent / "mk_prepare_receptor.exe"

CID = 2519
PDB_ID = "3EML"
TRANSCRIPT = RESULTS / "transcript.jsonl"

_t0 = time.time()
_log_f = open(TRANSCRIPT, "w", encoding="utf-8")


def log(stage: str, message: str, data: dict = None):
    entry = {"t": round(time.time() - _t0, 2), "stage": stage, "message": message}
    if data:
        entry["data"] = data
    line = json.dumps(entry, ensure_ascii=False)
    _log_f.write(line + "\n")
    _log_f.flush()
    print(f"[{entry['t']:7.2f}s] ({stage}) {message}")


def step1_fetch_molecule():
    log("fetch_molecule", f"Запрос к PubChem REST API: CID {CID} (кофеин)")
    url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{CID}/property/ConnectivitySMILES,MolecularFormula,MolecularWeight,InChIKey,IUPACName/JSON"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    props = r.json()["PropertyTable"]["Properties"][0]
    log("fetch_molecule", "Получены свойства молекулы", props)

    sdf_url = f"https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/{CID}/record/SDF"
    r2 = requests.get(sdf_url, params={"record_type": "3d"}, timeout=30)
    if r2.status_code != 200 or not r2.text.strip():
        r2 = requests.get(sdf_url, params={"record_type": "2d"}, timeout=30)
    sdf_path = DATA / f"caffeine_{CID}.sdf"
    sdf_path.write_text(r2.text, encoding="utf-8")
    log("fetch_molecule", f"3D SDF сохранён: {sdf_path.name}")
    (DATA / "molecule.json").write_text(json.dumps(props, indent=2), encoding="utf-8")
    return props


def step2_lipinski(smiles: str):
    log("lipinski", "RDKit: расчёт свойств по правилу Липински (Rule of 5)")
    mol = Chem.MolFromSmiles(smiles)
    result = {
        "MW": round(Descriptors.MolWt(mol), 2),
        "LogP": round(Crippen.MolLogP(mol), 2),
        "HBD": rdMolDescriptors.CalcNumHBD(mol),
        "HBA": rdMolDescriptors.CalcNumHBA(mol),
        "TPSA": round(rdMolDescriptors.CalcTPSA(mol), 2),
    }
    log("lipinski", "Готово", result)
    return result


def step3_fetch_target():
    log("fetch_target", f"Скачивание структуры {PDB_ID} с RCSB PDB (человеческий рецептор A2A)")
    r = requests.get(f"https://files.rcsb.org/download/{PDB_ID}.pdb", timeout=30)
    pdb_path = RESULTS / "pdb" / f"{PDB_ID}.pdb"
    pdb_path.write_text(r.text, encoding="utf-8")

    parser = PDBParser(QUIET=True)
    structure = parser.get_structure(PDB_ID, str(pdb_path))
    hetero = sorted({res.resname for res in structure.get_residues() if res.id[0] not in (" ", "W")})
    log("fetch_target", f"Структура загружена: {pdb_path.name}", {"co_crystallized_ligands": hetero})

    class ProteinOnly(Select):
        def accept_residue(self, residue):
            return residue.id[0] == " "

    clean_path = RESULTS / "pdb" / f"{PDB_ID}_protein.pdb"
    io = PDBIO()
    io.set_structure(structure)
    io.save(str(clean_path), select=ProteinOnly())
    log("fetch_target", "Удалены вода/гетерогруппы, оставлен только белок для рецептора")
    return structure, clean_path


def step4_binding_site(structure):
    log("binding_site", "Определение бокса докинга по со-кристаллизованному лиганду ZMA (ZM241385)")
    coords = np.array([a.coord for a in structure.get_atoms()
                        if a.get_parent().resname == "ZMA"])
    mins, maxs = coords.min(0), coords.max(0)
    center = (mins + maxs) / 2
    size = np.maximum((maxs - mins) + 6.0, 20.0)
    size = np.minimum(size, 28.0)
    box = {"center": [round(float(x), 3) for x in center], "size": [round(float(x), 3) for x in size]}
    log("binding_site", "Бокс определён (высокая достоверность — есть со-кристаллизованный лиганд)", box)
    return box


def step5_prep_ligand():
    log("prep_ligand", "RDKit: генерация 3D-конформера (ETKDG + MMFF94)")
    molecule = json.loads((DATA / "molecule.json").read_text())
    mol = Chem.MolFromSmiles(molecule["ConnectivitySMILES"])
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 7
    AllChem.EmbedMolecule(mol, params)
    AllChem.MMFFOptimizeMolecule(mol, maxIters=2000)
    mol.SetProp("_Name", "caffeine")
    sdf_path = RESULTS / "ligand" / "caffeine_3d.sdf"
    w = Chem.SDWriter(short_path(sdf_path))
    w.write(mol)
    w.close()

    log("prep_ligand", "Конвертация в PDBQT (meeko)")
    pdbqt_path = RESULTS / "ligand" / "caffeine.pdbqt"
    subprocess.run([str(MK_LIGAND), "-i", short_path(sdf_path), "-o", short_path(pdbqt_path)],
                    check=True, capture_output=True, text=True)
    log("prep_ligand", f"Лиганд готов: {pdbqt_path.name}")
    return pdbqt_path


def step6_prep_receptor(clean_pdb_path: Path, box: dict):
    log("prep_receptor", "meeko: добавление водородов/зарядов, подготовка рецептора для Vina")
    out_base = RESULTS / "receptor" / PDB_ID
    cmd = [
        str(MK_RECEPTOR), "--read_pdb", short_path(clean_pdb_path), "-o", short_path(out_base),
        "-p", "-v", "--box_center", *[str(x) for x in box["center"]],
        "--box_size", *[str(x) for x in box["size"]], "--default_altloc", "A",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        result = subprocess.run(cmd + ["-x"], capture_output=True, text=True)
    receptor_pdbqt = RESULTS / "receptor" / f"{PDB_ID}.pdbqt"
    log("prep_receptor", f"Рецептор готов: {receptor_pdbqt.name}")
    return receptor_pdbqt


def step7_dock(ligand_pdbqt: Path, receptor_pdbqt: Path, box: dict):
    log("dock", "Запуск AutoDock Vina (exhaustiveness=16, 5 поз)")
    out_pdbqt = RESULTS / "docking" / "caffeine__3EML.pdbqt"
    cmd = [
        str(VINA), "--receptor", str(receptor_pdbqt), "--ligand", str(ligand_pdbqt),
        "--center_x", str(box["center"][0]), "--center_y", str(box["center"][1]), "--center_z", str(box["center"][2]),
        "--size_x", str(box["size"][0]), "--size_y", str(box["size"][1]), "--size_z", str(box["size"][2]),
        "--exhaustiveness", "16", "--num_modes", "5", "--out", str(out_pdbqt), "--seed", "42",
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    affinities = []
    in_table = False
    for line in result.stdout.splitlines():
        line = line.strip()
        if line.startswith("mode"):
            in_table = True
            continue
        if in_table and line and line[0].isdigit():
            affinities.append(float(line.split()[1]))
    log("dock", f"Докинг завершён, лучшая аффинность: {affinities[0]} ккал/моль", {"all_modes": affinities})
    return out_pdbqt, affinities


def step8_visualize(ligand_result_pdbqt: Path, box: dict):
    log("visualize", "py3Dmol: рендер позы в активном сайте A2A")
    import py3Dmol
    receptor_pdb = (RESULTS / "pdb" / f"{PDB_ID}_protein.pdb").read_text(encoding="utf-8")
    lines = []
    for line in ligand_result_pdbqt.read_text(encoding="utf-8").splitlines():
        if line.startswith("ENDMDL"):
            break
        if line.startswith(("ATOM", "HETATM")):
            lines.append(line[:66])
    pose_pdb = "\n".join(lines) + "\nEND\n"

    view = py3Dmol.view(width=900, height=650)
    view.addModel(receptor_pdb, "pdb")
    view.setStyle({"model": 0}, {"cartoon": {"color": "spectrum", "opacity": 0.85}})
    view.addModel(pose_pdb, "pdb")
    view.setStyle({"model": 1}, {"stick": {"colorscheme": "cyanCarbon", "radius": 0.25}})
    view.addBox({"center": {"x": box["center"][0], "y": box["center"][1], "z": box["center"][2]},
                 "dimensions": {"w": box["size"][0], "h": box["size"][1], "d": box["size"][2]},
                 "color": "cyan", "opacity": 0.15, "wireframe": True})
    view.zoomTo({"model": 1})
    view.zoom(1.0)
    out_html = RESULTS / "viz" / "caffeine__3EML.html"
    view.write_html(str(out_html), fullpage=False)
    log("visualize", f"Визуализация сохранена: {out_html.name}")
    return out_html


def main():
    log("start", "Демонстрационный прогон: кофеин -> аденозиновый рецептор A2A (PDB 3EML)")
    props = step1_fetch_molecule()
    lip = step2_lipinski(props["ConnectivitySMILES"])
    structure, clean_pdb = step3_fetch_target()
    box = step4_binding_site(structure)
    ligand_pdbqt = step5_prep_ligand()
    receptor_pdbqt = step6_prep_receptor(clean_pdb, box)
    docked_pdbqt, affinities = step7_dock(ligand_pdbqt, receptor_pdbqt, box)
    viz_path = step8_visualize(docked_pdbqt, box)
    log("done", "Пайплайн завершён", {
        "molecule": props, "lipinski": lip, "box": box,
        "best_affinity_kcal_mol": affinities[0], "all_modes": affinities,
    })
    _log_f.close()


if __name__ == "__main__":
    main()
