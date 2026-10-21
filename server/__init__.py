from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, send_from_directory

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"

load_dotenv(ROOT / ".env")


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)

    from .docs import bp as docs_bp
    from .generate import bp as generate_bp

    app.register_blueprint(docs_bp)
    app.register_blueprint(generate_bp)

    # Serve the built frontend (after `pnpm build`); in dev, Vite serves it instead.
    @app.get("/")
    @app.get("/<path:path>")
    def spa(path: str = ""):
        if path and (DIST / path).is_file():
            return send_from_directory(DIST, path)
        if (DIST / "index.html").is_file():
            return send_from_directory(DIST, "index.html")
        return "Frontend not built. Run `pnpm dev` in frontend/ (or `pnpm build`).", 404

    return app
