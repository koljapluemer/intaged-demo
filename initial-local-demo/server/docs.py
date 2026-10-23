import re
from pathlib import Path

from flask import Blueprint, abort, jsonify, request

from . import ROOT

DOCS_DIR = ROOT / "documents"
NAME_RE = re.compile(r"^[\w-]+$")

WELCOME = """# Welcome

Blocks fenced as `intaged` are widget specs. Click the wand to generate one.

```intaged
An interactive compound-interest calculator: sliders for initial amount,
monthly contribution, annual rate and years, and a line chart of the balance over time.
```
"""

bp = Blueprint("docs", __name__, url_prefix="/api/docs")


def _path(name: str) -> Path:
    if not NAME_RE.match(name):
        abort(400, "invalid document name")
    return DOCS_DIR / f"{name}.md"


def _ensure_dir() -> None:
    if not DOCS_DIR.exists():
        DOCS_DIR.mkdir()
        (DOCS_DIR / "welcome.md").write_text(WELCOME)


@bp.get("")
def list_docs():
    _ensure_dir()
    docs = sorted(DOCS_DIR.glob("*.md"), key=lambda p: p.stem)
    return jsonify([{"name": p.stem, "mtime": p.stat().st_mtime} for p in docs])


@bp.get("/<name>")
def get_doc(name: str):
    path = _path(name)
    if not path.is_file():
        abort(404)
    return jsonify({"name": name, "content": path.read_text()})


@bp.put("/<name>")
def put_doc(name: str):
    path = _path(name)
    _ensure_dir()
    content = (request.get_json(silent=True) or {}).get("content")
    if not isinstance(content, str):
        abort(400, "content must be a string")
    path.write_text(content)
    return jsonify({"name": name, "mtime": path.stat().st_mtime})
