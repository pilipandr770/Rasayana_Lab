"""
Обход бага RDKit на Windows: его C++ файловый ввод-вывод (SDWriter, MolToPDBFile и т.п.)
не умеет работать с не-ASCII символами в пути (у нас логин пользователя "ПК" — кириллица).
Для операций записи/чтения через RDKit используем короткое 8.3-имя пути (всегда ASCII).
"""
import ctypes
from pathlib import Path


def _get_short(path_str: str) -> str:
    buf = ctypes.create_unicode_buffer(260)
    ctypes.windll.kernel32.GetShortPathNameW(path_str, buf, 260)
    return buf.value


def short_path(path) -> str:
    """Короткое 8.3-имя пути. Работает и для ещё не существующих файлов:
    в этом случае берёт короткое имя у (уже существующей) родительской папки
    и подставляет исходное (ASCII) имя файла."""
    p = Path(path).resolve()
    if p.exists():
        result = _get_short(str(p))
        return result if result else str(p)

    parent_short = _get_short(str(p.parent))
    if not parent_short:
        return str(p)
    return str(Path(parent_short) / p.name)
