"""
Шаг 5 (часть 1): SMILES -> 3D конформер (RDKit ETKDG + MMFF94) -> PDBQT (meeko).
"""
import json
import subprocess
import sys
from pathlib import Path

from rdkit import Chem
from rdkit.Chem import AllChem

from winpath import short_path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
RESULTS_DIR = Path(__file__).resolve().parent.parent / "results" / "ligands"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

MK_PREPARE_LIGAND = Path(sys.executable).parent / "mk_prepare_ligand.exe"


def build_3d_sdf(name: str, smiles: str) -> Path:
    mol = Chem.MolFromSmiles(smiles)
    mol = Chem.AddHs(mol)

    params = AllChem.ETKDGv3()
    params.randomSeed = 42
    cid = AllChem.EmbedMolecule(mol, params)
    if cid == -1:
        # запасной вариант, если ETKDG не сошёлся
        cid = AllChem.EmbedMolecule(mol, useRandomCoords=True, randomSeed=42)
    AllChem.MMFFOptimizeMolecule(mol, maxIters=2000)

    mol.SetProp("_Name", name)
    out_sdf = RESULTS_DIR / f"{name}_3d.sdf"
    writer = Chem.SDWriter(short_path(out_sdf))
    writer.write(mol)
    writer.close()
    return out_sdf


def sdf_to_pdbqt(sdf_path: Path, name: str) -> Path:
    out_pdbqt = RESULTS_DIR / f"{name}.pdbqt"
    cmd = [str(MK_PREPARE_LIGAND), "-i", short_path(sdf_path), "-o", short_path(out_pdbqt)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"mk_prepare_ligand не смог обработать {name}:\n{result.stderr}")
    return out_pdbqt


def main():
    molecules = json.loads((DATA_DIR / "molecules.json").read_text(encoding="utf-8"))
    for name, props in molecules.items():
        print(f"--- {name} ---")
        sdf_path = build_3d_sdf(name, props["SMILES"])
        print(f"  3D конформер: {sdf_path}")
        pdbqt_path = sdf_to_pdbqt(sdf_path, name)
        print(f"  PDBQT: {pdbqt_path}")


if __name__ == "__main__":
    main()
