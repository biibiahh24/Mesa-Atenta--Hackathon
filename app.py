import argparse
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import parse_qs, urlsplit

import operations

ROOT = Path(__file__).resolve().parent
DB = os.environ.get("MESA_DB", ROOT / "mesa.sqlite3")
AREAS = {1: "Salão principal", 31: "Salão superior", 71: "Salão inferior"}
ASSETS = {
    "/": ("index.html", "text/html"),
    "/gestao": ("gestao.html", "text/html"),
    "/gestao.js": ("gestao.js", "text/javascript"),
    "/equipe": ("index.html", "text/html"),
    "/app.js": ("app.js", "text/javascript"),
    "/style.css": ("style.css", "text/css"),
}


def area_for(table):
    return AREAS[max(start for start in AREAS if start <= table)]


def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def initialize():
    with closing(connect()) as db, db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS calls (
                id INTEGER PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
                table_no INTEGER NOT NULL CHECK(table_no BETWEEN 1 AND 90),
                reason TEXT NOT NULL CHECK(reason IN ('bebida', 'atendimento')),
                created INTEGER NOT NULL, started INTEGER, finished INTEGER
            );
            CREATE TABLE IF NOT EXISTS request_receipts (
                key TEXT PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS active_call
            ON calls(table_no, reason) WHERE finished IS NULL;
        """)
        operations.initialize(db)


def table_number(value):
    if type(value) is int and 1 <= value <= 90:
        return value
    raise ValueError("Informe uma mesa de 1 a 90.")


def payload(row):
    return {
        "id": row["id"], "table": row["table_no"], "reason": row["reason"],
        "area": area_for(row["table_no"]), "created": row["created"],
        "started": row["started"], "finished": row["finished"],
    }


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body, kind="application/json"):
        if kind == "application/json":
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        size = int(self.headers.get("Content-Length", "0"))
        if self.headers.get_content_type() != "application/json" or not 0 < size <= 2048:
            raise ValueError("Envie uma solicitação JSON válida.")
        data = json.loads(self.rfile.read(size))
        if not isinstance(data, dict):
            raise ValueError("Solicitação inválida.")
        return data

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path in ASSETS:
            name, kind = ASSETS[url.path]
            return self.respond(200, (ROOT / "web" / name).read_bytes(), kind)
        if url.path == "/api/operacao":
            try:
                with closing(connect()) as db, db:
                    db.execute("BEGIN")
                    result = operations.snapshot(db, int(time.time()))
                return self.respond(200, result)
            except sqlite3.Error:
                return self.respond(503, {"error": "Banco indisponível. Tente novamente."})
        if url.path != "/api/chamados":
            return self.respond(404, {"error": "Página não encontrada."})
        query = parse_qs(url.query, keep_blank_values=True)
        try:
            with closing(connect()) as db:
                if "mesa" in query:
                    raw = query["mesa"][0]
                    table = table_number(int(raw)) if re.fullmatch(r"[0-9]{1,2}", raw) else table_number(None)
                    rows = db.execute(
                        "SELECT * FROM calls WHERE table_no = ? AND (finished IS NULL OR finished >= ?) ORDER BY id DESC",
                        (table, int(time.time()) - 900),
                    ).fetchall()
                else:
                    rows = db.execute(
                        "SELECT * FROM calls WHERE finished IS NULL OR finished >= ? ORDER BY created, id",
                        (int(time.time()) - 12 * 3600,),
                    ).fetchall()
            self.respond(200, {"calls": [payload(row) for row in rows], "now": int(time.time())})
        except ValueError as error:
            self.respond(400, {"error": str(error)})
        except sqlite3.Error:
            self.respond(503, {"error": "Banco indisponível. Tente novamente."})

    def do_POST(self):
        path = urlsplit(self.path).path
        transition = re.fullmatch(r"/api/chamados/([0-9]{1,12})/(assumir|concluir)", path)
        try:
            if path.startswith("/api/operacao/"):
                data = self.read_json()
                action = path.rsplit("/", 1)[1]
                signature = json.dumps([action, data], sort_keys=True, ensure_ascii=False)
                with closing(connect()) as db, db:
                    operations.submit(db, action, data, int(time.time()), signature)
                return self.respond(200, {"ok": True})
            if path == "/api/chamados":
                data = self.read_json()
                table = table_number(data.get("table"))
                reason, key = data.get("reason"), data.get("key")
                if reason not in ("bebida", "atendimento") or not isinstance(key, str) or not re.fullmatch(r"[a-f0-9-]{36}", key):
                    raise ValueError("Motivo ou identificador inválido.")
                with closing(connect()) as db, db:
                    db.execute("BEGIN IMMEDIATE")
                    row = db.execute(
                        """SELECT calls.* FROM calls
                           JOIN request_receipts ON calls.id = request_receipts.call_id
                           WHERE request_receipts.key = ?""",
                        (key,),
                    ).fetchone()
                    if row is None:
                        row = db.execute(
                            "SELECT * FROM calls WHERE table_no = ? AND reason = ? AND finished IS NULL",
                            (table, reason),
                        ).fetchone()
                    if row is None:
                        cursor = db.execute(
                            "INSERT INTO calls(request_key, table_no, reason, created) VALUES (?, ?, ?, ?)",
                            (key, table, reason, int(time.time())),
                        )
                        row = db.execute("SELECT * FROM calls WHERE id = ?", (cursor.lastrowid,)).fetchone()
                    elif row["table_no"] != table or row["reason"] != reason:
                        return self.respond(409, {"error": "O identificador já pertence a outro chamado."})
                    db.execute(
                        "INSERT OR IGNORE INTO request_receipts(key, call_id) VALUES (?, ?)",
                        (key, row["id"]),
                    )
                return self.respond(200, payload(row))
            if transition:
                call_id, action = transition.groups()
                now = int(time.time())
                with closing(connect()) as db, db:
                    if action == "assumir":
                        db.execute("UPDATE calls SET started = ? WHERE id = ? AND started IS NULL", (now, call_id))
                    else:
                        db.execute("UPDATE calls SET finished = ? WHERE id = ? AND started IS NOT NULL AND finished IS NULL", (now, call_id))
                    row = db.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
                if row is None:
                    return self.respond(404, {"error": "Chamado não encontrado."})
                if action == "concluir" and row["finished"] is None:
                    return self.respond(409, {"error": "Assuma o chamado antes de concluir."})
                return self.respond(200, payload(row))
            self.respond(404, {"error": "Página não encontrada."})
        except ValueError as error:
            self.respond(400, {"error": str(error)})
        except sqlite3.Error:
            self.respond(503, {"error": "Banco indisponível. Tente novamente."})


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    parser.add_argument("--strictPort", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    initialize()
    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        print(f"Mesa Atenta em http://{args.host}:{server.server_port}", flush=True)
        server.serve_forever()
