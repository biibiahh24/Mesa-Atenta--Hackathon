"""Persisted lunch operations for the Augusta demonstration."""
import re
import statistics

PLACES = ("churrasqueira", "buffet")
SUSTAIN = 45
MAX_GAP = 90


def initialize(db):
    db.executescript("""
        CREATE TABLE IF NOT EXISTS cleaning (
            id INTEGER PRIMARY KEY, table_no INTEGER NOT NULL,
            created INTEGER NOT NULL, started INTEGER, finished INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS active_cleaning
            ON cleaning(table_no) WHERE finished IS NULL;
        CREATE TABLE IF NOT EXISTS queue_rules (
            place TEXT PRIMARY KEY, threshold INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS queue_readings (
            id INTEGER PRIMARY KEY, place TEXT NOT NULL, people INTEGER NOT NULL,
            observed INTEGER NOT NULL, wait_seconds INTEGER,
            threshold INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS queue_place_order ON queue_readings(place, id DESC);
        CREATE TABLE IF NOT EXISTS queue_alerts (
            id INTEGER PRIMARY KEY, place TEXT NOT NULL, opened INTEGER NOT NULL,
            acknowledged INTEGER, action TEXT, action_at INTEGER, closed INTEGER
        );
        CREATE UNIQUE INDEX IF NOT EXISTS active_alert
            ON queue_alerts(place) WHERE closed IS NULL;
        CREATE INDEX IF NOT EXISTS queue_alert_by_place ON queue_alerts(place, id DESC);
        CREATE TABLE IF NOT EXISTS buffet_observations (
            id INTEGER PRIMARY KEY, kind TEXT NOT NULL, item TEXT NOT NULL,
            source TEXT NOT NULL, first_value INTEGER, second_value INTEGER,
            note TEXT NOT NULL, created INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS operation_receipts (
            key TEXT PRIMARY KEY, request TEXT NOT NULL
        );
    """)


def integer(value, low, high, label):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{label}: informe um inteiro entre {low} e {high}.")
    return value


def label(value, limit, field):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
        raise ValueError(f"{field}: preencha até {limit} caracteres.")
    return value.strip()


def threshold_for(db, place):
    row = db.execute("SELECT threshold FROM queue_rules WHERE place = ?", (place,)).fetchone()
    return row["threshold"] if row else 8


def queue_reading(db, data, now):
    place = data.get("place")
    if place not in PLACES:
        raise ValueError("Selecione a churrasqueira ou o buffet.")
    people = integer(data.get("people"), 0, 200, "Pessoas")
    wait = data.get("wait")
    if wait is not None:
        wait = integer(wait, 0, 3600, "Espera em segundos")
    threshold = threshold_for(db, place)
    db.execute(
        "INSERT INTO queue_readings(place, people, observed, wait_seconds, threshold) VALUES (?, ?, ?, ?, ?)",
        (place, people, now, wait, threshold),
    )
    alert = db.execute("SELECT id FROM queue_alerts WHERE place = ? AND closed IS NULL", (place,)).fetchone()
    above = people >= threshold
    if above == bool(alert):
        return
    readings = db.execute(
        "SELECT people, observed, threshold FROM queue_readings WHERE place = ? AND observed >= ? ORDER BY id DESC",
        (place, now - SUSTAIN - MAX_GAP),
    )
    previous = now
    for reading in readings:
        observed = reading["observed"]
        if previous - observed > MAX_GAP or reading["threshold"] != threshold or (reading["people"] >= threshold) != above:
            return
        if now - observed >= SUSTAIN:
            if above:
                db.execute("INSERT INTO queue_alerts(place, opened) VALUES (?, ?)", (place, now))
            else:
                db.execute("UPDATE queue_alerts SET closed = ? WHERE id = ?", (now, alert["id"]))
            return
        previous = observed


def buffet_observation(db, data, now):
    kind = data.get("kind")
    first = second = None
    if kind == "mix":
        item, source, note = "Composição por peso", "Pesagem", ""
        first = integer(data.get("first"), 0, 5000, "Gramas de carne")
        second = integer(data.get("second"), 0, 5000, "Gramas de outros alimentos")
        if not first + second:
            raise ValueError("O peso total precisa ser positivo.")
    elif kind == "sobra":
        item = label(data.get("item"), 80, "Item")
        source, note = "Retirada", ""
        second = integer(data.get("second"), 1, 1000, "Pratos amostrados com o item")
        first = integer(data.get("first"), 0, second, "Pratos com sobra")
    elif kind == "comentario":
        item = label(data.get("item"), 80, "Item")
        source = data.get("source")
        if source not in ("Buffet", "Mesa"):
            raise ValueError("Informe onde o comentário foi coletado.")
        note = label(data.get("note"), 240, "Comentário")
    elif kind == "acao":
        item = label(data.get("item"), 80, "Item")
        source, note = "Gestão", label(data.get("note"), 240, "Ação")
    else:
        raise ValueError("Selecione um tipo de registro válido.")
    db.execute(
        "INSERT INTO buffet_observations(kind, item, source, first_value, second_value, note, created) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (kind, item, source, first, second, note, now),
    )


def change(db, action, data, now):
    if action == "medir":
        queue_reading(db, data, now)
    elif action == "limite":
        place = data.get("place")
        if place not in PLACES:
            raise ValueError("Selecione o local da fila.")
        value = integer(data.get("threshold"), 1, 200, "Limite")
        db.execute(
            "INSERT INTO queue_rules VALUES (?, ?) ON CONFLICT(place) DO UPDATE SET threshold = excluded.threshold",
            (place, value),
        )
    elif action in ("ciente", "intervir"):
        alert_id = integer(data.get("id"), 1, 10**12, "Aviso")
        if action == "ciente":
            result = db.execute(
                "UPDATE queue_alerts SET acknowledged = COALESCE(acknowledged, ?) WHERE id = ? AND closed IS NULL",
                (now, alert_id),
            )
        else:
            result = db.execute(
                "UPDATE queue_alerts SET action = ?, action_at = ? WHERE id = ? AND acknowledged IS NOT NULL AND action IS NULL AND closed IS NULL",
                (label(data.get("note"), 240, "Ação"), now, alert_id),
            )
        if not result.rowcount:
            raise ValueError("O estado do aviso mudou. Atualize o painel.")
    elif action == "sinalizar":
        table = integer(data.get("table"), 1, 90, "Mesa")
        db.execute(
            "INSERT INTO cleaning(table_no, created) VALUES (?, ?) ON CONFLICT(table_no) WHERE finished IS NULL DO NOTHING",
            (table, now),
        )
    elif action in ("assumir-limpeza", "mesa-pronta"):
        task = integer(data.get("id"), 1, 10**12, "Tarefa")
        if action == "assumir-limpeza":
            result = db.execute("UPDATE cleaning SET started = ? WHERE id = ? AND started IS NULL AND finished IS NULL", (now, task))
        else:
            result = db.execute("UPDATE cleaning SET finished = ? WHERE id = ? AND started IS NOT NULL AND finished IS NULL", (now, task))
        if not result.rowcount:
            raise ValueError("A tarefa mudou de estado. Atualize o painel.")
    elif action == "observar":
        buffet_observation(db, data, now)
    else:
        raise ValueError("Ação desconhecida.")


def submit(db, action, data, now, signature):
    key = data.get("key")
    if not isinstance(key, str) or not re.fullmatch(r"[a-f0-9-]{36}", key):
        raise ValueError("Identificador de envio inválido.")
    db.execute("BEGIN IMMEDIATE")
    receipt = db.execute("SELECT request FROM operation_receipts WHERE key = ?", (key,)).fetchone()
    if receipt:
        if receipt["request"] != signature:
            raise ValueError("O identificador já pertence a outro envio.")
        return
    change(db, action, data, now)
    db.execute("INSERT INTO operation_receipts VALUES (?, ?)", (key, signature))


def wait_summary(db, place, bounds, reference):
    rows = db.execute(
        "SELECT observed, wait_seconds FROM queue_readings WHERE place = ? AND observed >= ? AND wait_seconds IS NOT NULL",
        (place, bounds),
    ).fetchall()
    before = [row["wait_seconds"] for row in rows if row["observed"] <= reference]
    after = [row["wait_seconds"] for row in rows if row["observed"] > reference]
    return [
        {"n": len(sample), "median": statistics.median(sample) if sample else None}
        for sample in (before, after)
    ]


def snapshot(db, now):
    queues = []
    for place in PLACES:
        reading = db.execute(
            "SELECT * FROM queue_readings WHERE place = ? ORDER BY id DESC LIMIT 1", (place,),
        ).fetchone()
        alert = db.execute(
            "SELECT * FROM queue_alerts WHERE place = ? ORDER BY id DESC LIMIT 1", (place,),
        ).fetchone()
        comparison = None
        if alert and alert["action_at"] is not None:
            comparison = wait_summary(db, place, alert["opened"] - 1800, alert["action_at"])
        queues.append({
            "place": place, "threshold": threshold_for(db, place),
            "reading": dict(reading) if reading else None,
            "stale": reading is None or now - reading["observed"] > MAX_GAP,
            "alert": dict(alert) if alert else None, "comparison": comparison,
        })
    cleaning = db.execute(
        "SELECT * FROM cleaning WHERE finished IS NULL OR finished >= ? ORDER BY created, id",
        (now - 43200,),
    ).fetchall()
    observations = db.execute(
        "SELECT * FROM buffet_observations WHERE created >= ? ORDER BY id DESC LIMIT 40",
        (now - 43200,),
    ).fetchall()
    return {
        "now": now, "queues": queues, "cleaning": [dict(row) for row in cleaning],
        "observations": [dict(row) for row in observations],
    }
