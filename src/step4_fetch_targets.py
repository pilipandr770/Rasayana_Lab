"""
Шаг 4: Загрузка PDB структур мишеней + определение активного сайта.
"""
import json
from pathlib import Path

import requests
from Bio.PDB import PDBParser, PDBIO, Select

TARGETS = {
    # Апгрейд от 6NJV: 6NJV — неполный фрагмент human hTERT (251 остаток) без
    # лиганда, бокс определялся только по иону Mg2+. 6E53 — TERT Tribolium
    # castaneum (жук) с реально связанным нуклеотид-аналоговым ингибитором HUV
    # прямо в каталитическом сайте. T. castaneum TERT — стандартный суррогат
    # для структурных исследований ингибиторов теломеразы (каталитический
    # домен консервативен с человеческим; полноразмерный человеческий TERT
    # с малой молекулой в активном сайте в PDB отсутствует).
    "6E53": {"name": "TERT", "role": "теломераза (каталитический домен, суррогат T. castaneum)", "priority": 1},
    "4ZZJ": {"name": "SIRT1", "role": "деацетилаза", "priority": 1},
    # Апгрейд от 5H64: 5H64 — весь холокомплекс mTORC1 (6430 остатков, 6 цепей)
    # без лиганда, требовал blind-докинга пониженной точности. 4JSP —
    # изолированный киназный домен mTOR с mLST8 и связанным ATP-gamma-S
    # (нерасщепляемый аналог ATP) прямо в каталитическом кармане — тот же
    # карман, что и у известных ATP-конкурентных ингибиторов (PP242, Torin2).
    "4JSP": {"name": "mTOR", "role": "киназный домен mTORC1 (ATP-карман)", "priority": 1},
    "2FLU": {"name": "Keap1", "role": "регулятор Nrf2 пути", "priority": 2},
    "4PZS": {"name": "EP300", "role": "ацетилтрансфераза (мишень спермидина)", "priority": 2},
    "4CFE": {"name": "AMPK", "role": "сенсор энергии", "priority": 2},
}

RESULTS_DIR = Path(__file__).resolve().parent.parent / "results" / "pdb"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

MIRRORS = [
    "https://files.rcsb.org/download/{pdb}.pdb",
    "https://www.ebi.ac.uk/pdbe/entry-files/pdb{pdb_lower}.ent",
]


class ProteinOnly(Select):
    """Оставляем только белковые цепи: убираем воду и гетероатомы (в т.ч. лиганды-кофакторы)."""

    def accept_residue(self, residue):
        return residue.id[0] == " "  # стандартный аминокислотный остаток


def download_pdb(pdb_id: str) -> Path:
    out_path = RESULTS_DIR / f"{pdb_id}.pdb"
    if out_path.exists():
        return out_path

    for template in MIRRORS:
        url = template.format(pdb=pdb_id, pdb_lower=pdb_id.lower())
        try:
            r = requests.get(url, timeout=30)
            if r.status_code == 200 and r.text.strip().startswith(("HEADER", "OBSLTE", "TITLE")):
                out_path.write_text(r.text, encoding="utf-8")
                print(f"  Скачано с {url}")
                return out_path
        except requests.RequestException as e:
            print(f"  Зеркало недоступно ({url}): {e}")
    raise RuntimeError(f"Не удалось скачать {pdb_id} ни с одного зеркала")


def analyze_structure(pdb_id: str, pdb_path: Path, info: dict) -> dict:
    parser = PDBParser(QUIET=True)
    structure = parser.get_structure(pdb_id, str(pdb_path))

    chains = []
    hetero_ligands = set()
    n_residues = 0
    for model in structure:
        for chain in model:
            residues = list(chain)
            n_residues += len(residues)
            chains.append(chain.id)
            for res in residues:
                if res.id[0] not in (" ", "W"):  # гетерогруппа, не вода
                    hetero_ligands.add(res.resname)
        break  # только первая модель

    # Сохраняем очищенную структуру (только белок, без воды/гетерогрупп) — вход для докинга
    clean_path = RESULTS_DIR / f"{pdb_id}_protein.pdb"
    io = PDBIO()
    io.set_structure(structure)
    io.save(str(clean_path), select=ProteinOnly())

    return {
        "pdb_id": pdb_id,
        **info,
        "chains": chains,
        "n_residues": n_residues,
        "co_crystallized_ligands": sorted(hetero_ligands),
        "clean_protein_file": str(clean_path),
    }


def main():
    summary = []
    for pdb_id, info in TARGETS.items():
        print(f"--- {pdb_id} ({info['name']}) ---")
        pdb_path = download_pdb(pdb_id)
        result = analyze_structure(pdb_id, pdb_path, info)
        summary.append(result)
        print(json.dumps(result, indent=2, ensure_ascii=False))

    out_json = RESULTS_DIR.parent / "targets_summary.json"
    out_json.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nСводка сохранена: {out_json}")


if __name__ == "__main__":
    main()
