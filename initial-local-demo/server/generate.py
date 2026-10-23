import json
import os
from typing import Literal

from flask import Blueprint, jsonify, request
from openai import OpenAI, OpenAIError
from pydantic import BaseModel

from .prompts import SYSTEM_PROMPT

bp = Blueprint("generate", __name__, url_prefix="/api")

MODEL = os.environ.get("OPENAI_MODEL", "gpt-5.6-terra")
client = OpenAI(timeout=180)


# Must match the catalog in frontend/src/widgetLibs.ts.
Lib = Literal["leaflet", "d3", "chartjs", "three", "svgjs", "lucide"]


class Widget(BaseModel):
    html: str
    css: str
    js: str
    libs: list[Lib]


def _user_message(spec: str, previous: dict | None, errors: list[str]) -> str:
    parts = [f"SPEC:\n{spec}"]
    if previous:
        code = {k: previous.get(k, "") for k in ("html", "css", "js")}
        code["libs"] = previous.get("libs", [])
        parts.append(f"PREVIOUS CODE:\n{json.dumps(code, indent=2)}")
    if errors:
        parts.append("RUNTIME ERRORS:\n" + "\n".join(f"- {e}" for e in errors))
    return "\n\n".join(parts)


@bp.post("/generate")
def generate():
    body = request.get_json(silent=True) or {}
    spec = (body.get("spec") or "").strip()
    if not spec:
        return jsonify({"error": "spec is empty"}), 400

    try:
        response = client.responses.parse(
            model=MODEL,
            instructions=SYSTEM_PROMPT,
            input=_user_message(spec, body.get("previous"), body.get("errors") or []),
            text_format=Widget,
            reasoning={"effort": "medium"},
        )
    except OpenAIError as e:
        return jsonify({"error": str(e)}), 502

    widget = response.output_parsed
    if widget is None:
        return jsonify({"error": "model returned no widget"}), 502
    return jsonify(widget.model_dump())
