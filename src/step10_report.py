"""
Шаг 7 (часть 2): сводная таблица + heatmap PNG + финальный HTML-отчёт со всеми
результатами, визуализациями и выводами.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from winpath import short_path

ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = ROOT / "results"
REPORTS_DIR = RESULTS_DIR / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)
VIZ_DIR = RESULTS_DIR / "viz"

MOLECULES = json.loads((RESULTS_DIR.parent / "data" / "molecules.json").read_text(encoding="utf-8"))
TARGETS = json.loads((RESULTS_DIR / "targets_summary.json").read_text(encoding="utf-8"))
BOXES = json.loads((RESULTS_DIR / "binding_sites.json").read_text(encoding="utf-8"))
DOCKING = json.loads((RESULTS_DIR / "docking_results.json").read_text(encoding="utf-8"))
LIPINSKI = pd.read_csv(RESULTS_DIR / "lipinski_analysis.csv")

MOL_LABELS = {
    "cycloastragenol": "Цикластрагенол",
    "gallic_acid": "Галловая кислота (маркер Амалаки)",
    "spermidine": "Спермидин",
}
TARGET_LABELS = {t["pdb_id"]: f"{t['name']} ({t['pdb_id']})" for t in TARGETS}
TARGET_ORDER = [t["pdb_id"] for t in TARGETS]
MOL_ORDER = list(MOLECULES.keys())


def strength_label(aff):
    if aff is None:
        return "н/д"
    if aff > -5:
        return "слабое"
    if aff > -8:
        return "умеренное"
    if aff > -11:
        return "сильное"
    return "очень сильное"


def build_matrix():
    """Индекс — внутренние ключи молекул (cycloastragenol, ...), не переведённые названия:
    так проще потом сопоставлять с MOL_LABELS/визуализациями. Для показа в HTML переводим
    отдельно через .rename(index=MOL_LABELS)."""
    lookup = {(r["ligand"], r["target"]): r for r in DOCKING}
    rows = []
    for mol in MOL_ORDER:
        row = {"__mol__": mol}
        for tgt in TARGET_ORDER:
            r = lookup.get((mol, tgt))
            row[tgt] = r["best_affinity_kcal_mol"] if r and r["status"] == "ok" else None
        rows.append(row)
    df = pd.DataFrame(rows).set_index("__mol__")
    return df


def save_heatmap(df_display: pd.DataFrame, out_path: Path):
    fig, ax = plt.subplots(figsize=(10, 4.5))
    data = df_display.to_numpy(dtype=float)
    im = ax.imshow(data, cmap="RdYlGn_r", vmin=-11, vmax=-4)
    ax.set_xticks(range(len(df_display.columns)))
    ax.set_xticklabels(df_display.columns, rotation=30, ha="right", fontsize=9)
    ax.set_yticks(range(len(df_display.index)))
    ax.set_yticklabels(df_display.index, fontsize=10)
    for i in range(data.shape[0]):
        for j in range(data.shape[1]):
            val = data[i, j]
            if not np.isnan(val):
                ax.text(j, i, f"{val:.1f}", ha="center", va="center", fontsize=9,
                         color="black")
    ax.set_title("Binding affinity, ккал/моль (чем отрицательнее — тем сильнее связывание)")
    fig.colorbar(im, ax=ax, label="ккал/моль")
    fig.tight_layout()
    fig.savefig(short_path(out_path), dpi=150)
    plt.close(fig)


def best_per_molecule(df: pd.DataFrame) -> dict:
    result = {}
    for mol in df.index:
        row = df.loc[mol].dropna()
        if row.empty:
            continue
        best_target = row.idxmin()
        result[mol] = (best_target, row[best_target])
    return result


def render_viewer_iframe(ligand: str, target: str) -> str:
    html_path = VIZ_DIR / f"{ligand}__{target}.html"
    if not html_path.exists():
        return "<p><em>визуализация недоступна</em></p>"
    content = html_path.read_text(encoding="utf-8").replace('"', "&quot;")
    return f'<iframe srcdoc="{content}" style="width:100%;height:500px;border:1px solid #ccc;border-radius:8px;"></iframe>'


def main():
    df = build_matrix()  # индекс/колонки = внутренние ключи молекул/PDB ID
    df_display = df.rename(index=MOL_LABELS, columns=TARGET_LABELS)  # для показа

    csv_path = REPORTS_DIR / "binding_affinity_matrix.csv"
    df_display.to_csv(csv_path, encoding="utf-8-sig")

    heatmap_path = REPORTS_DIR / "binding_affinity_heatmap.png"
    save_heatmap(df_display, heatmap_path)

    best = best_per_molecule(df)  # ключи здесь — внутренние имена молекул

    html_parts = [f"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<title>Rasayana Virtual Lab — Фаза 2: молекулярный докинг</title>
<style>
body {{ font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 1100px; margin: 40px auto; padding: 0 20px; line-height: 1.55; color: #222; }}
h1 {{ font-size: 1.8em; }}
h2 {{ margin-top: 2.2em; border-bottom: 2px solid #eee; padding-bottom: 6px; }}
table {{ border-collapse: collapse; width: 100%; margin: 1em 0; }}
th, td {{ border: 1px solid #ddd; padding: 8px 10px; text-align: center; font-size: 0.92em; }}
th {{ background: #f5f5f5; }}
.note {{ background: #fff8e1; border-left: 4px solid #f0c040; padding: 10px 14px; margin: 1em 0; font-size: 0.92em; }}
.warn {{ background: #ffecec; border-left: 4px solid #e05656; padding: 10px 14px; margin: 1em 0; font-size: 0.92em; }}
img {{ max-width: 100%; }}
.pair {{ margin: 2em 0; }}
code {{ background: #f0f0f0; padding: 1px 5px; border-radius: 4px; }}
</style></head><body>
<h1>Rasayana Virtual Lab — Фаза 2: результаты молекулярного докинга</h1>
<p>Автоматически сгенерировано пайплайном: PubChem → RDKit → PDB → AutoDock Vina → py3Dmol.</p>

<div class="warn"><strong>Важное замечание по данным брифа.</strong> В исходном брифе PubChem CID
для цикластрагенола (11969571) и спермидина (71840) были указаны неверно — эти CID ведут на
другие вещества. Использованы проверенные напрямую в PubChem корректные CID:
цикластрагенол — 13943286, спермидин — 1102. Формулы и молекулярные веса ниже соответствуют
реальным веществам.</div>

<h2>1. Молекулы-кандидаты</h2>
<table><tr><th>Молекула</th><th>PubChem CID</th><th>Формула</th><th>MW</th><th>Источник</th></tr>
"""]
    for mol, props in MOLECULES.items():
        html_parts.append(
            f"<tr><td>{MOL_LABELS[mol]}</td><td>{props['CID']}</td>"
            f"<td>{props['MolecularFormula']}</td><td>{props['MolecularWeight']}</td>"
            f"<td>{props['source']}</td></tr>"
        )
    html_parts.append("</table>")

    html_parts.append("""
<h2>2. Правило Липински (Rule of 5) и проницаемость ГЭБ</h2>
<p>Оцениваем, насколько вещество в принципе годится для приёма внутрь и для проникновения
через гемато-энцефалический барьер (мозг). MW — молекулярный вес, LogP — липофильность
(растворимость в жирах), HBD/HBA — доноры/акцепторы водородных связей, TPSA — площадь
полярной поверхности.</p>
""")
    lipinski_display = LIPINSKI.copy()
    lipinski_display["molecule"] = lipinski_display["molecule"].map(MOL_LABELS)
    html_parts.append(lipinski_display.rename(columns={
        "molecule": "Молекула", "Ro5_pass": "Проходит Ro5", "BBB_permeant_likely": "Вероятно проникает через ГЭБ"
    }).to_html(index=False, border=0))

    html_parts.append("""
<h2>3. Белки-мишени и активные сайты</h2>
<p>Для каждой мишени докинг-бокс определён по со-кристаллизованному лиганду/кофактору
(наиболее надёжный вариант) либо, при его отсутствии, приблизительно.</p>
<table><tr><th>PDB</th><th>Белок</th><th>Роль</th><th>Остатков</th><th>Достоверность бокса</th><th>Обоснование</th></tr>
""")
    for t in TARGETS:
        box = BOXES[t["pdb_id"]]
        html_parts.append(
            f"<tr><td>{t['pdb_id']}</td><td>{t['name']}</td><td>{t['role']}</td>"
            f"<td>{t['n_residues']}</td><td>{box['confidence']}</td><td style='text-align:left;font-size:0.85em'>{box['note']}</td></tr>"
        )
    html_parts.append("</table>")

    html_parts.append(f"""
<h2>4. Сводная таблица binding affinity</h2>
<p>Шкала интерпретации (ккал/моль): хуже -5 — слабое; -6…-8 — умеренное, интересное;
-9…-11 — сильное (уровень одобренных лекарств); лучше -12 — очень сильное.</p>
{df_display.to_html(na_rep="н/д", float_format=lambda x: f"{x:.2f}")}
<img src="{heatmap_path.name}" alt="Heatmap binding affinity">
""")

    html_parts.append("<h2>5. Лучшая пара для каждой молекулы</h2>")
    for mol, (target, aff) in best.items():
        html_parts.append(f"""<div class="pair">
<h3>{MOL_LABELS[mol]} → {TARGET_LABELS[target]}: {aff:.2f} ккал/моль ({strength_label(aff)})</h3>
{render_viewer_iframe(mol, target)}
</div>""")

    cyclo_best = best.get("cycloastragenol")
    cyclo_comment = ""
    if cyclo_best:
        cyclo_comment = (
            f"Цикластрагенол сильнее всего связывается с {TARGET_LABELS[cyclo_best[0]]} "
            f"({cyclo_best[1]:.2f} ккал/моль). В брифе указано, что in vitro цикластрагенол "
            f"уже показал +45% активности теломеразы — наш виртуальный докинг проверяет, "
            f"насколько механически правдоподобно прямое связывание с hTERT при такой аффинности."
        )

    html_parts.append(f"""
<h2>6. Выводы</h2>
<div class="note">{cyclo_comment}</div>
<p>Что мы получили и что это значит (простыми словами):</p>
<ul>
<li>Все три молекулы прошли правило Липински без существенных нарушений — с точки зрения
базовой "лекарствоподобности" все три пригодны для перорального приёма.</li>
<li>Виртуальный докинг — это оценка геометрической и энергетической совместимости молекулы
с карманом белка. Значения ниже -8 ккал/моль говорят об умеренно-сильном взаимодействии,
сравнимом с уровнем известных лекарств; это не доказательство биологического эффекта
самого по себе, а основание для дальнейшей экспериментальной проверки.</li>
<li>Мишени без чёткого со-кристаллизованного лиганда (в первую очередь mTORC1 и частично
hTERT) оценены с пониженной достоверностью — бокс докинга подобран приблизительно, и
результат по ним стоит воспринимать как ориентировочный, а не окончательный.</li>
</ul>
<p style="color:#888;font-size:0.85em;margin-top:3em;">Rasayana Virtual Lab · Фаза 2 · автоматически сгенерированный отчёт</p>
</body></html>""")

    report_path = REPORTS_DIR / "phase2_report.html"
    report_path.write_text("\n".join(html_parts), encoding="utf-8")
    print(f"Отчёт сохранён: {report_path}")
    print(f"CSV матрица: {csv_path}")
    print(f"Heatmap PNG: {heatmap_path}")


if __name__ == "__main__":
    main()
