"""Create a separate demonstration database without touching existing data."""
import argparse
from contextlib import closing
from pathlib import Path
import time

import app
import operations


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    options = parser.parse_args()
    try:
        with options.database.open("xb"):
            pass
    except FileExistsError:
        parser.error("Escolha um caminho que ainda não existe.")
    app.DB = options.database
    app.initialize()
    now = int(time.time())
    with closing(app.connect()) as db, db:
        for age, people, wait in ((115, 8, 420), (65, 9, 390), (10, 8, 450)):
            operations.queue_reading(db, {"place": "churrasqueira", "people": people, "wait": wait}, now - age)
        operations.queue_reading(db, {"place": "buffet", "people": 3, "wait": 120}, now - 15)
        operations.change(db, "sinalizar", {"table": 12}, now - 180)
        for record in (
            {"kind": "mix", "first": 160, "second": 322},
            {"kind": "sobra", "item": "Farofa", "first": 3, "second": 8},
            {"kind": "comentario", "item": "Farofa", "source": "Buffet", "note": "Quais ingredientes entram na farofa?"},
        ):
            operations.buffet_observation(db, record, now - 120)
    print(f"Dados simulados gravados em {options.database}.")


if __name__ == "__main__":
    main()
