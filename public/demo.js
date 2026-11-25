(() => {
  const storageKey = 'mesa-atenta-sites-v2';
  const realFetch = window.fetch.bind(window);
  const places = ['churrasqueira', 'buffet'];

  function seed(now) {
    return {
      next: 6, calls: [], rules: { churrasqueira: 8, buffet: 8 }, receipts: {},
      cleaning: [{ id: 1, table_no: 12, created: now - 180, started: null, finished: null }],
      readings: [
        { place: 'churrasqueira', people: 8, observed: now - 65, wait_seconds: 420 },
        { place: 'churrasqueira', people: 9, observed: now - 10, wait_seconds: 390 },
        { place: 'buffet', people: 3, observed: now - 12, wait_seconds: 120 },
      ],
      alerts: [{ id: 2, place: 'churrasqueira', opened: now - 10, acknowledged: null, action: null, action_at: null, closed: null }],
      observations: [
        { id: 5, kind: 'comentario', item: 'Farofa', source: 'Buffet', note: 'Quais ingredientes entram na farofa?' },
        { id: 4, kind: 'sobra', item: 'Farofa', source: 'Retirada', first_value: 3, second_value: 8, note: '' },
        { id: 3, kind: 'mix', item: 'Composição por peso', source: 'Pesagem', first_value: 160, second_value: 322, note: '' },
      ],
    };
  }

  const area = (number) => number <= 30 ? 'Salão principal' : number <= 70 ? 'Salão superior' : 'Salão inferior';
  const response = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }
  const validInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return { n: sorted.length, median: sorted.length ? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null };
  }

  function operations(state, now) {
    const queues = places.map((place) => {
      const readings = state.readings.filter((row) => row.place === place);
      const reading = readings.at(-1) ?? null;
      const alert = state.alerts.findLast((row) => row.place === place) ?? null;
      let comparison = null;
      if (alert?.action_at != null) {
        const waits = readings.filter((row) => row.wait_seconds != null && row.observed >= alert.opened - 1800);
        comparison = [
          median(waits.filter((row) => row.observed <= alert.action_at).map((row) => row.wait_seconds)),
          median(waits.filter((row) => row.observed > alert.action_at).map((row) => row.wait_seconds)),
        ];
      }
      return { place, threshold: state.rules[place], reading, alert, comparison, stale: !reading || now - reading.observed > 90 };
    });
    return { now, queues, cleaning: state.cleaning, observations: state.observations.slice(0, 40) };
  }

  function measure(state, data, now) {
    const { place, people, wait } = data;
    requireValue(places.includes(place) && validInt(people, 0, 200) && (wait == null || validInt(wait, 0, 3600)), 'Revise os valores da medição.');
    const limit = state.rules[place];
    state.readings.push({ place, people, observed: now, wait_seconds: wait, threshold: limit });
    const active = state.alerts.find((row) => row.place === place && row.closed === null);
    const above = people >= limit;
    if (above === Boolean(active)) return;
    let previous = now;
    for (const row of state.readings.filter((entry) => entry.place === place).reverse()) {
      if (previous - row.observed > 90 || (row.threshold ?? 8) !== limit || (row.people >= limit) !== above) break;
      if (now - row.observed >= 45) {
        if (active) active.closed = now;
        else state.alerts.push({ id: state.next++, place, opened: now, acknowledged: null, action: null, action_at: null, closed: null });
        break;
      }
      previous = row.observed;
    }
  }

  function change(state, action, data, now) {
    if (action === 'medir') return measure(state, data, now);
    if (action === 'limite') {
      requireValue(places.includes(data.place) && validInt(data.threshold, 1, 200), 'Informe um limite válido.');
      state.rules[data.place] = data.threshold;
      return;
    }
    if (action === 'ciente' || action === 'intervir') {
      const alert = state.alerts.find((row) => row.id === data.id && row.closed === null);
      requireValue(alert, 'O aviso mudou de estado.');
      if (action === 'ciente') alert.acknowledged ??= now;
      else {
        requireValue(alert.acknowledged !== null && !alert.action && data.note?.trim(), 'Confirme ciência e informe a ação.');
        alert.action = data.note.trim();
        alert.action_at = now;
      }
      return;
    }
    if (action === 'sinalizar') {
      requireValue(validInt(data.table, 1, 90), 'Informe uma mesa entre 1 e 90.');
      if (!state.cleaning.some((task) => task.table_no === data.table && task.finished === null)) {
        state.cleaning.push({ id: state.next++, table_no: data.table, created: now, started: null, finished: null });
      }
      return;
    }
    if (action === 'assumir-limpeza' || action === 'mesa-pronta') {
      const task = state.cleaning.find((row) => row.id === data.id && row.finished === null);
      requireValue(task && (action === 'assumir-limpeza' ? task.started === null : task.started !== null), 'A tarefa mudou de estado.');
      if (action === 'assumir-limpeza') task.started = now;
      else task.finished = now;
      return;
    }
    requireValue(action === 'observar', 'Ação desconhecida.');
    const { kind, first, second } = data;
    if (kind === 'mix') requireValue(validInt(first, 0, 5000) && validInt(second, 0, 5000) && first + second > 0, 'Informe pesos válidos.');
    if (kind === 'sobra') requireValue(validInt(second, 1, 1000) && validInt(first, 0, second), 'A sobra deve caber na amostra.');
    requireValue(kind === 'mix' || data.item?.trim(), 'Informe o item.');
    requireValue(!['comentario', 'acao'].includes(kind) || data.note?.trim(), 'Preencha o registro.');
    state.observations.unshift({
      id: state.next++, kind, item: kind === 'mix' ? 'Composição por peso' : data.item.trim(),
      source: { mix: 'Pesagem', sobra: 'Retirada', comentario: data.source, acao: 'Gestão' }[kind],
      first_value: first ?? null, second_value: second ?? null, note: data.note?.trim() ?? '',
    });
  }

  window.fetch = async (input, options = {}) => {
    const url = new URL(input, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, options);
    try {
      const now = Math.floor(Date.now() / 1000);
      const saved = localStorage.getItem(storageKey);
      const state = saved ? JSON.parse(saved) : seed(now);
      if (!saved) localStorage.setItem(storageKey, JSON.stringify(state));
      if (options.method !== 'POST') {
        if (url.pathname === '/api/operacao') return response(operations(state, now));
        const table = url.searchParams.get('mesa');
        return response({ now, calls: state.calls.filter((row) => table === null || row.table === Number(table)) });
      }
      const data = options.body ? JSON.parse(options.body) : {};
      let result = { ok: true };
      if (data.key && Object.hasOwn(state.receipts, data.key)) return response(state.receipts[data.key]);
      if (url.pathname.startsWith('/api/operacao/')) {
        change(state, url.pathname.split('/').at(-1), data, now);
      } else if (url.pathname === '/api/chamados') {
        requireValue(validInt(data.table, 1, 90), 'Informe uma mesa válida.');
        result = state.calls.find((row) => row.table === data.table && row.reason === data.reason && row.finished === null);
        if (!result) {
          result = { id: state.next++, table: data.table, reason: data.reason, area: area(data.table), created: now, started: null, finished: null };
          state.calls.push(result);
        }
      } else {
        const [, id, action] = url.pathname.match(/^\/api\/chamados\/(\d+)\/(assumir|concluir)$/) ?? [];
        result = state.calls.find((row) => row.id === Number(id));
        requireValue(result, 'Chamado não encontrado.');
        if (action === 'assumir') result.started ??= now;
        else {
          requireValue(result.started !== null, 'Assuma o chamado antes de concluir.');
          result.finished ??= now;
        }
      }
      if (data.key) state.receipts[data.key] = result;
      localStorage.setItem(storageKey, JSON.stringify(state));
      return response(result);
    } catch (error) {
      return response({ error: error.message }, 400);
    }
  };
})();
