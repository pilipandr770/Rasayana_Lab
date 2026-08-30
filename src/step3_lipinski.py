"""
Шаг 3: RDKit анализ — Rule of 5 (Lipinski) + оценка проницаемости ГЭБ.
"""
import json
from pathlib import Path

import pandas as pd
from rdkit import Chem
from rdkit.Chem import Descriptors, Crippen, rdMolDescriptors

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"
RESULTS_DIR.mkdir(exist_ok=True)


def analyze(name: str, smiles: str) -> dict:
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ValueError(f"RDKit не смог распарсить SMILES для {name}: {smiles}")

    mw = Descriptors.MolWt(mol)
    logp = Crippen.MolLogP(mol)
    hbd = rdMolDescriptors.CalcNumHBD(mol)
    hba = rdMolDescriptors.CalcNumHBA(mol)
    tpsa = rdMolDescriptors.CalcTPSA(mol)
    rot_bonds = rdMolDescriptors.CalcNumRotatableBonds(mol)

    # Правило Липински (Rule of 5): MW<=500, LogP<=5, HBD<=5, HBA<=10
    violations = sum([mw > 500, logp > 5, hbd > 5, hba > 10])
    ro5_pass = violations <= 1  # допускается 1 нарушение

    # Грубая эвристика проницаемости ГЭБ (BBB): TPSA < 90 Å² и MW < 450 — благоприятно
    bbb_likely = tpsa < 90 and mw < 450

    return {
        "molecule": name,
        "SMILES": smiles,
        "MW": round(mw, 2),
        "LogP": round(logp, 2),
        "HBD": hbd,
        "HBA": hba,
        "TPSA": round(tpsa, 2),
        "RotatableBonds": rot_bonds,
        "Lipinski_violations": violations,
        "Ro5_pass": ro5_pass,
        "BBB_permeant_likely": bbb_likely,
    }


def main():
    molecules = json.loads((DATA_DIR / "molecules.json").read_text(encoding="utf-8"))
    rows = [analyze(name, props["SMILES"]) for name, props in molecules.items()]
    df = pd.DataFrame(rows)

    out_csv = RESULTS_DIR / "lipinski_analysis.csv"
    df.to_csv(out_csv, index=False, encoding="utf-8-sig")
    print(df.to_string(index=False))
    print(f"\nСохранено: {out_csv}")


if __name__ == "__main__":
    main()
