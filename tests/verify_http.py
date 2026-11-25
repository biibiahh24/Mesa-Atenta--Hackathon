from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from uuid import uuid4
import json
import app

with TemporaryDirectory() as tmp:
    app.DB = Path(tmp) / 'verification.sqlite3'
    app.initialize()
    with app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        origin = f'http://127.0.0.1:{server.server_port}'

        def send(path, data=None):
            request = Request(origin + path, data=json.dumps(data).encode() if data is not None else None,
                              headers={'Content-Type': 'application/json'})
            try:
                response = urlopen(request, timeout=4)
            except HTTPError as error:
                response = error
            with response:
                return response.status, json.load(response) if response.headers.get_content_type() == 'application/json' else response.read()

        def action(name, key=None, **data):
            return send('/api/operacao/' + name, {**data, 'key': key or uuid4().hex + 'abcd'})

        def state():
            return send('/api/operacao')[1]

        def queue():
            return state()['queues'][0]

        for url in ('/?mesa=07', '/equipe', '/gestao', '/gestao.js', '/app.js', '/style.css'):
            assert send(url)[0] == 200, url
        create = {'table': 7, 'reason': 'bebida', 'key': str(uuid4())}
        code, call = send('/api/chamados', create)
        assert code == 200 and call['started'] is None
        assert send('/api/chamados', create)[1]['id'] == call['id']
        assert send(f"/api/chamados/{call['id']}/concluir", {})[0] == 409
        assert send(f"/api/chamados/{call['id']}/assumir", {})[1]['started'] is not None
        assert send(f"/api/chamados/{call['id']}/concluir", {})[1]['finished'] is not None
        assert send('/api/chamados?mesa=07')[1]['calls'][0]['finished'] is not None

        assert action('sinalizar', table=91)[0] == 400
        with ThreadPoolExecutor(max_workers=4) as pool:
            assert all(code == 200 for code, _ in pool.map(lambda _: action('sinalizar', table=12), range(8)))
        tasks = state()['cleaning']
        assert len(tasks) == 1
        task = tasks[0]['id']
        assert action('mesa-pronta', id=task)[0] == 400
        with ThreadPoolExecutor(max_workers=2) as pool:
            codes = sorted(code for code, _ in pool.map(lambda _: action('assumir-limpeza', id=task), range(2)))
        assert codes == [200, 400]
        assert action('mesa-pronta', id=task)[0] == 200
        assert state()['cleaning'][0]['finished'] is not None

        # Advance the server clock without waiting 45 seconds per reading.
        clock = [1760000000]
        real_time = app.time.time
        app.time.time = lambda: clock[0]
        try:
            assert action('limite', place='churrasqueira', threshold=7)[0] == 200
            assert action('medir', place='churrasqueira', people=7, wait=420)[0] == 200
            assert queue()['alert'] is None
            clock[0] += 46
            assert action('medir', place='churrasqueira', people=8, wait=480)[0] == 200
            active = queue()['alert']['id']
            assert action('medir', place='churrasqueira', people=9)[0] == 200
            assert queue()['alert']['id'] == active
            assert action('ciente', id=active)[0] == 200
            assert action('intervir', id=active, note='Orientar entrada da fila')[0] == 200
            clock[0] += 5
            assert action('medir', place='churrasqueira', people=3, wait=240)[0] == 200
            assert queue()['alert']['closed'] is None
            clock[0] += 46
            assert action('medir', place='churrasqueira', people=2, wait=180)[0] == 200
            assert queue()['alert']['closed'] is not None
            assert queue()['comparison'] == [{'n': 2, 'median': 450.0}, {'n': 2, 'median': 210.0}]
            clock[0] += 91
            assert queue()['stale'] is True

            key = str(uuid4())
            assert action('observar', key, kind='mix', first=150, second=332)[0] == 200
            assert action('observar', key, kind='mix', first=150, second=332)[0] == 200
            assert action('observar', key, kind='mix', first=155, second=332)[0] == 400
            assert action('observar', kind='sobra', item='Farofa', first=9, second=8)[0] == 400
            assert action('observar', kind='sobra', item='Farofa', first=3, second=8)[0] == 200
            assert action('observar', kind='comentario', source='Buffet', item='Farofa', note='Identificação dos ingredientes')[0] == 200
            assert action('observar', kind='acao', item='Farofa', note='Melhorar identificação')[0] == 200
            app.initialize()
            assert len(state()['observations']) == 4
            assert queue()['alert']['id'] == active
        finally:
            app.time.time = real_time
            server.shutdown()
        worker.join()
print('PASS: telas, atendimento, limpeza concorrente, alerta, recuperação, comparação, buffet, reenvio e persistência.')
