
import sys
import json
import struct
import os
import tempfile
from pathlib import Path

BASE_DIR = (
    Path(sys.executable).resolve().parent.parent.parent
    if getattr(sys, "frozen", False)
    else Path(__file__).resolve().parent.parent
)
DATA_DIR = BASE_DIR / "data"
DATA_FILE = DATA_DIR / "bookmarks.json"
REPORT_FILE = DATA_DIR / "import-errors.txt"

MAX_MESSAGE = 64 * 1024 * 1024


def read_message():
    raw_length = sys.stdin.buffer.read(4)

    if len(raw_length) != 4:
        return None

    length = struct.unpack("<I", raw_length)[0]

    if length > MAX_MESSAGE:
        raise ValueError("Mensaje demasiado grande")

    raw = sys.stdin.buffer.read(length)

    if len(raw) != length:
        raise ValueError("Mensaje incompleto")

    return json.loads(raw.decode("utf-8"))


def send_message(message):
    encoded = json.dumps(
        message,
        ensure_ascii=False
    ).encode("utf-8")

    sys.stdout.buffer.write(
        struct.pack("<I", len(encoded))
    )
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def write_bookmarks(data):
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not isinstance(data, dict):
        raise ValueError("Datos inválidos")

    if data.get("format") != "bookmark-sync" or data.get("version") != 2:
        raise ValueError("Formato canónico incompatible")
    roots = data.get("roots")
    if not isinstance(roots, list) or not roots:
        raise ValueError("Estructura de raíces inválida")
    types = set()
    for root in roots:
        if not isinstance(root, dict) or not isinstance(root.get("folderType"), str) or not root["folderType"].strip() or not isinstance(root.get("children"), list):
            raise ValueError("Estructura de raíz inválida")
        if root["folderType"] in types or root["folderType"] in ("trash", "managed"):
            raise ValueError("Raíz duplicada o excluida")
        types.add(root["folderType"])

    fd, temp_path = tempfile.mkstemp(
        prefix="bookmarks_",
        suffix=".tmp",
        dir=DATA_DIR
    )

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())

        os.replace(temp_path, DATA_FILE)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)

    return {
        "ok": True,
        "path": str(DATA_FILE)
    }


def read_bookmarks():
    if not DATA_FILE.is_file():
        raise FileNotFoundError(
            f"No existe el respaldo: {DATA_FILE}"
        )

    with DATA_FILE.open("r", encoding="utf-8") as file:
        data = json.load(file)

    return {
        "ok": True,
        "data": data
    }



def write_import_report(report):
    if not isinstance(report, dict) or not isinstance(report.get("rejected"), list) or not isinstance(report.get("skippedRoots"), list):
        raise ValueError("Reporte inválido")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        "BOOKMARK SYNC - REPORTE DE IMPORTACIÓN",
        f"Fecha: {report.get('date', '')}",
        f"Importados (preparados): {report.get('imported', 0)}",
        f"Omitidos por raíces inexistentes: {report.get('omittedByRoot', 0)}",
        f"URLs rechazadas: {len(report['rejected'])}",
        "",
        "RAÍCES OMITIDAS",
    ]
    for item in report["skippedRoots"]:
        lines.append(f"{item.get('root', '')}: {item.get('count', 0)} marcadores")
        for index, bookmark in enumerate(item.get("bookmarks", []), 1):
            lines.extend([
                f"  {index}. Título: {bookmark.get('title', '')}",
                f"     Carpeta: {bookmark.get('location', '')}",
                f"     URL: {bookmark.get('url', '')}",
                f"     Motivo: {bookmark.get('reason', '')}",
            ])
    if not report["skippedRoots"]:
        lines.append("Ninguna")
    lines.extend(["", "URLS RECHAZADAS"])
    for i, item in enumerate(report["rejected"], 1):
        lines.extend([
            f"{i}. Raíz: {item.get('root', '')}",
            f"   Ubicación: {item.get('location', '')}",
            f"   URL: {item.get('url', '')}",
            f"   Motivo: {item.get('reason', '')}",
        ])
    if not report["rejected"]:
        lines.append("Ninguna")
    content = "\n".join(lines) + "\n"
    fd, temp_path = tempfile.mkstemp(prefix="report_", suffix=".tmp", dir=DATA_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp_path, REPORT_FILE)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    return {"ok": True, "path": str(REPORT_FILE)}


def read_import_report():
    if not REPORT_FILE.is_file():
        raise FileNotFoundError("Aún no existe un reporte de importación")
    return {"ok": True, "text": REPORT_FILE.read_text(encoding="utf-8")}


def main():
    try:
        request = read_message()

        if request is None:
            return

        action = request.get("action")

        if action == "write":
            response = write_bookmarks(request.get("data"))

        elif action == "read":
            response = read_bookmarks()

        elif action == "write_import_report":
            response = write_import_report(request.get("report"))

        elif action == "read_import_report":
            response = read_import_report()

        else:
            raise ValueError("Acción desconocida")

        send_message(response)

    except Exception as error:
        send_message({
            "ok": False,
            "error": str(error)
        })


if __name__ == "__main__":
    main()
