"""
Шаг 5 (часть 2): определение bounding box активного сайта для каждой мишени.

Стратегия (обоснование под каждой мишенью):
- Если в структуре есть со-кристаллизованный лиганд/кофактор, релевантный активному
  сайту (не буфер/криопротектор/ион фазирования) -> центр бокса = центроид этого лиганда.
- Если известен пептид-партнёр, занимающий функциональный карман (Keap1-Nrf2) ->
  центроид пептидной цепи.
- Если явного маркера нет (mTORC1, крупный мультисубъединичный комплекс) -> blind
  docking по наибольшей цепи (приблизительно, с понижённой достоверностью — это отдельно
  отмечается в итоговом отчёте).
"""
import json
from pathlib import Path

import numpy as np
from Bio.PDB import PDBParser

PDB_DIR = Path(__file__).resolve().parent.parent / "results" / "pdb"
RESULTS_DIR = Path(__file__).resolve().parent.parent / "results"

# буферы/криопротекторы/ионы фазирования — не рассматриваем как маркер активного сайта
IGNORE_HET = {"HOH", "GOL", "DMS", "SO4", "PO4", "EDO", "ACT", "TRS", "PEG", "MPD", "BME", "IOD"}

BOX_STRATEGY = {
    "6E53": {"mode": "hetero", "resname": "HUV", "confidence": "средняя-высокая",
             "note": "Апгрейд от 6NJV (низкая достоверность, только ион Mg2+, неполная человеческая "
                     "структура). 6E53 — TERT Tribolium castaneum со связанным нуклеотид-аналоговым "
                     "ингибитором HUV прямо в каталитическом сайте полимеразы. Стандартный суррогат "
                     "для структурных исследований hTERT (каталитический домен консервативен); "
                     "полноразмерного человеческого TERT с лигандом в PDB не существует."},
    "4ZZJ": {"mode": "hetero", "resname": "4TQ", "confidence": "высокая",
             "note": "Со-кристаллизован известный активатор SIRT1 (лиганд 4TQ) — использован как "
                     "прямой маркер связывающего кармана."},
    "4JSP": {"mode": "hetero", "resname": "AGS", "confidence": "высокая",
             "note": "Апгрейд от 5H64 (низкая достоверность, blind-докинг по гигантскому "
                     "холокомплексу без лиганда). 4JSP — изолированный киназный домен mTOR с "
                     "mLST8 и связанным ATP-gamma-S (AGS, нерасщепляемый аналог ATP) прямо в "
                     "каталитическом кармане — том же, где связываются известные ATP-конкурентные "
                     "ингибиторы mTOR (PP242, Torin2)."},
    "2FLU": {"mode": "chain", "chain_id": "P", "confidence": "высокая",
             "note": "Карман для связывания Nrf2 точно определён по со-кристаллизованному "
                     "пептиду Nrf2 (цепь P) — используем его центроид."},
    "4PZS": {"mode": "hetero", "resname": "ACO", "confidence": "высокая",
             "note": "Со-кристаллизован кофактор ацетил-КоА (ACO) в каталитическом сайте EP300 — "
                     "прямой маркер активного центра."},
    "4CFE": {"mode": "hetero", "resname": "STU", "confidence": "высокая",
             "note": "Со-кристаллизован ATP-конкурентный ингибитор стауроспорин (STU) в "
                     "АТФ-связывающем кармане киназного домена AMPK."},
}

PADDING = 6.0  # Å запаса вокруг маркера/лиганда с каждой стороны
MIN_BOX = 20.0  # минимальный размер бокса (чтобы уместить лиганды-кандидаты + подвижность)
MAX_BOX = 28.0  # верхняя граница для прицельного докинга в известный карман
BLIND_BOX_SIZE = 35.0  # фиксированный умеренный бокс для blind-докинга (не весь белок — Vina
                        # не тянет box > ~30-40 Å по разумному времени/памяти)


def get_structure(pdb_id: str):
    parser = PDBParser(QUIET=True)
    return parser.get_structure(pdb_id, str(PDB_DIR / f"{pdb_id}.pdb"))


def coords_from_hetero(structure, resname: str) -> np.ndarray:
    """Координаты ОДНОЙ копии гетерогруппы. Важно: если в асимметричной единице
    несколько копий лиганда (разные цепи/номера остатка — типично для структур
    с несколькими субъединицами), нельзя усреднять их все в один бокс — это
    ставит центр докинга между двумя разными карманами, а не в одном из них.
    Берём первую встреченную копию (по chain_id + res_id) и логируем это."""
    first_key = None
    coords = []
    seen_others = set()
    for atom in structure.get_atoms():
        res = atom.get_parent()
        if res.resname != resname or res.id[0] == " ":
            continue
        chain_id = res.get_parent().id
        key = (chain_id, res.id)
        if first_key is None:
            first_key = key
        if key == first_key:
            coords.append(atom.coord)
        else:
            seen_others.add(key)
    if not coords:
        raise ValueError(f"Гетерогруппа {resname} не найдена в структуре")
    if seen_others:
        print(f"  [!] {resname}: найдено {1 + len(seen_others)} копий в структуре "
              f"({first_key} и {sorted(seen_others)}) — используем только {first_key}, "
              f"чтобы не усреднять бокс между разными карманами")
    return np.array(coords)


def coords_from_chain(structure, chain_id: str) -> np.ndarray:
    coords = []
    for model in structure:
        for chain in model:
            if chain.id == chain_id:
                for atom in chain.get_atoms():
                    coords.append(atom.coord)
        break
    if not coords:
        raise ValueError(f"Цепь {chain_id} не найдена")
    return np.array(coords)


def coords_from_largest_chain(structure) -> np.ndarray:
    best_chain, best_n = None, -1
    for model in structure:
        for chain in model:
            n = sum(1 for _ in chain.get_atoms())
            if n > best_n:
                best_n, best_chain = n, chain
        break
    return np.array([a.coord for a in best_chain.get_atoms()])


def box_from_coords(coords: np.ndarray, padding: float,
                     min_box: float = None, max_box: float = None) -> dict:
    mins = coords.min(axis=0)
    maxs = coords.max(axis=0)
    center = (mins + maxs) / 2
    size = (maxs - mins) + 2 * padding
    if min_box is not None:
        size = np.maximum(size, min_box)
    if max_box is not None:
        size = np.minimum(size, max_box)
    return {
        "center": [round(float(x), 3) for x in center],
        "size": [round(float(x), 3) for x in size],
    }


def box_around_centroid(coords: np.ndarray, box_size: float) -> dict:
    """Фиксированный кубический бокс вокруг центра масс — для blind-докинга,
    когда огибание всей структуры (bounding box) дало бы нереалистично
    большой объём для Vina."""
    center = coords.mean(axis=0)
    return {
        "center": [round(float(x), 3) for x in center],
        "size": [box_size, box_size, box_size],
    }


def main():
    boxes = {}
    for pdb_id, strategy in BOX_STRATEGY.items():
        print(f"--- {pdb_id} ---")
        structure = get_structure(pdb_id)

        if strategy["mode"] == "hetero":
            coords = coords_from_hetero(structure, strategy["resname"])
            box = box_from_coords(coords, PADDING, MIN_BOX, MAX_BOX)
        elif strategy["mode"] == "chain":
            coords = coords_from_chain(structure, strategy["chain_id"])
            box = box_from_coords(coords, PADDING, MIN_BOX, MAX_BOX)
        elif strategy["mode"] == "blind_largest_chain":
            coords = coords_from_largest_chain(structure)
            box = box_around_centroid(coords, BLIND_BOX_SIZE)
        else:
            raise ValueError(strategy["mode"])

        box["confidence"] = strategy["confidence"]
        box["note"] = strategy["note"]
        boxes[pdb_id] = box
        print(json.dumps(box, indent=2, ensure_ascii=False))

    out_json = RESULTS_DIR / "binding_sites.json"
    out_json.write_text(json.dumps(boxes, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nСохранено: {out_json}")


if __name__ == "__main__":
    main()
