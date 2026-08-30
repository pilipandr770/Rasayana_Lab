"""
Шаг 2: Загрузка молекул через PubChem REST API.
Для каждого CID получаем SMILES, молекулярную формулу, молекулярный вес, InChIKey.
"""
import json
import time
from pathlib import Path

import requests

MOLECULES = {
    "cycloastragenol": {
        "cid": 13943286,  # в брифе указан 11969571 — ошибка, это другое вещество (C10H15NO4). Верный CID проверен в PubChem по имени.
        "source": "Astragalus membranaceus (Huang Qi, TCM)",
    },
    "gallic_acid": {
        "cid": 370,
        "source": "Phyllanthus emblica (Amalaki) — маркер эмбликанина A/B",
    },
    "spermidine": {
        "cid": 1102,  # в брифе указан 71840 — ошибка, это другое вещество (C15H15NO). Верный CID проверен в PubChem по имени.
        "source": "зародыши пшеницы, ферментированные продукты",
    },
}

PUG = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
PROPS = "CanonicalSMILES,IsomericSMILES,MolecularFormula,MolecularWeight,InChI,InChIKey,IUPACName"

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)


def fetch_properties(cid: int) -> dict:
    url = f"{PUG}/compound/cid/{cid}/property/{PROPS}/JSON"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()["PropertyTable"]["Properties"][0]


def fetch_sdf(cid: int, out_path: Path):
    url = f"{PUG}/compound/cid/{cid}/record/SDF"
    r = requests.get(url, params={"record_type": "3d"}, timeout=30)
    if r.status_code != 200 or not r.text.strip():
        # у части соединений нет готового 3D конформера в PubChem — берём 2D, RDKit достроит 3D сам
        r = requests.get(url, params={"record_type": "2d"}, timeout=30)
        r.raise_for_status()
    out_path.write_text(r.text, encoding="utf-8")


def main():
    results = {}
    for name, info in MOLECULES.items():
        cid = info["cid"]
        print(f"--- {name} (CID {cid}) ---")
        props = fetch_properties(cid)
        props["source"] = info["source"]
        results[name] = props
        print(json.dumps(props, indent=2, ensure_ascii=False))

        sdf_path = DATA_DIR / f"{name}_{cid}.sdf"
        fetch_sdf(cid, sdf_path)
        print(f"SDF сохранён: {sdf_path}")
        time.sleep(0.3)  # вежливость к PubChem API (rate limit)

    out_json = DATA_DIR / "molecules.json"
    out_json.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nВсе свойства сохранены в {out_json}")


if __name__ == "__main__":
    main()
