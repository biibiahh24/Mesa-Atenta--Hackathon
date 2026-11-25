(() => {
  const management = document.body.dataset.role === 'Gestão';
  const staff = document.body.dataset.role === 'Salão';
  if (!management && !staff) return;

  const get = (id) => document.getElementById(id);
  const error = get('operations-error');
  const status = get('operations-status');
  const pending = new Map();
  const areas = ['Salão principal', 'Salão superior', 'Salão inferior'];
  let snapshot;
  let service;
  let loading = false;
  let busy = false;

  function area(table) {
    return areas[table <= 30 ? 0 : table <= 70 ? 1 : 2];
  }

  function duration(seconds) {
    const rounded = Math.max(0, Math.round(seconds));
    return `${Math.floor(rounded / 60)} min ${rounded % 60} s`;
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = !message;
  }

  async function api(path, options) {
    const response = await fetch(path, { ...options, signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Não foi possível salvar.');
    return payload;
  }

  function renderQueue(queue) {
    const card = document.querySelector(`[data-place="${queue.place}"]`);
    const { reading, alert, stale, threshold, comparison } = queue;
    const active = Boolean(alert && alert.closed === null);
    card.dataset.active = String(active);
    card.querySelector('[data-reading]').textContent = reading
      ? `${reading.people} pessoas · limite ${threshold}${stale ? ' · leitura desatualizada' : ''}`
      : `Aguardando contagem · limite ${threshold} pessoas`;
    card.querySelector('[data-alert]').textContent = active
      ? (alert.acknowledged === null ? 'Acúmulo detectado · aguardando ciência' : 'Gerente ciente · aviso aberto')
      : (alert ? 'Último aviso encerrado' : 'Sem aviso aberto');
    const ack = card.querySelector('[data-ack]');
    ack.hidden = !active || alert.acknowledged !== null;
    ack.onclick = () => submit('ciente', { id: alert.id });
    const action = card.querySelector('[data-action=intervir]');
    action.hidden = !active || alert.acknowledged === null || alert.action !== null;
    action.dataset.id = alert?.id ?? '';
    card.querySelector('[data-comparison]').textContent = comparison
      ? `Ação: ${alert.action}. Espera mediana antes: ${sampleLabel(comparison[0])}. Depois: ${sampleLabel(comparison[1])}.`
      : '';
  }

  function sampleLabel(sample) {
    return sample.n ? `${duration(sample.median)} (n=${sample.n})` : 'sem amostras';
  }

  function renderService() {
    const list = get('management-calls');
    if (!list || !service) return;
    const calls = service.calls;
    get('management-waiting').textContent = calls.filter((row) => row.started === null).length;
    get('management-serving').textContent = calls.filter((row) => row.started !== null && row.finished === null).length;
    get('management-done').textContent = calls.filter((row) => row.finished !== null).length;
    list.replaceChildren();
    for (const call of [...calls].sort((a, b) => (b.finished ?? b.started ?? b.created) - (a.finished ?? a.started ?? a.created) || b.id - a.id).slice(0, 5)) {
      const row = document.createElement('li');
      const label = document.createElement('strong');
      const detail = document.createElement('span');
      row.className = 'call';
      label.textContent = `Mesa ${String(call.table).padStart(2, '0')} · ${call.reason === 'bebida' ? 'Bebida' : 'Atendimento'}`;
      const state = call.finished !== null ? 'Concluído' : call.started !== null ? 'Em atendimento' : 'Aguardando';
      row.dataset.state = call.finished !== null ? 'done' : 'open';
      detail.textContent = `${state} · espera ${duration((call.started ?? service.now) - call.created)}`;
      row.append(label, detail);
      list.append(row);
    }
    if (!list.children.length) {
      const empty = document.createElement('li');
      empty.textContent = 'Nenhum chamado registrado.';
      list.append(empty);
    }
  }

  function renderQualitySummary() {
    for (const node of document.querySelectorAll('[data-quality]')) {
      const record = snapshot.observations.find((row) => row.kind === node.dataset.quality);
      if (!record) continue;
      const { first_value: first, second_value: second, item, kind, note, source } = record;
      if (kind === 'mix') node.textContent = `${first} g carne · ${second} g outros · ${Math.round(100 * first / (first + second))}% carne`;
      else if (kind === 'sobra') node.textContent = `${item}: ${first} de ${second} pratos`;
      else node.textContent = kind === 'comentario' ? `${source} · ${item}: ${note}` : `${item}: ${note}`;
    }
  }

  function renderObservations() {
    const list = get('observations');
    list.replaceChildren();
    for (const record of snapshot.observations) {
      const row = document.createElement('li');
      row.className = 'call';
      const { first_value: first, second_value: second, item, kind, note, source } = record;
      if (kind === 'mix') {
        row.textContent = `Mix · ${first} g de carne e ${second} g de outros alimentos · ${Math.round(100 * first / (first + second))}% de carne`;
      } else if (kind === 'sobra') {
        row.textContent = `Sobra · ${item} · ${first} de ${second} pratos (${Math.round(100 * first / second)}%)`;
      } else {
        row.textContent = `${kind === 'acao' ? 'Ação' : 'Comentário'} · ${source} · ${item} · ${note}`;
      }
      list.append(row);
    }
    if (!list.children.length) list.textContent = 'Nenhum registro recente.';
  }

  function renderBuffetComparison() {
    const list = get('buffet-comparison');
    list.replaceChildren();
    const latestActions = new Map();
    const itemKey = (record) => record.item.trim().toLocaleLowerCase('pt-BR');
    for (const record of snapshot.observations) {
      if (record.kind === 'acao' && !latestActions.has(itemKey(record))) {
        latestActions.set(itemKey(record), record);
      }
    }
    const summarize = (samples) => {
      const total = samples.reduce((sum, record) => sum + record.second_value, 0);
      const leftover = samples.reduce((sum, record) => sum + record.first_value, 0);
      return total ? `${leftover}/${total} pratos (${Math.round(100 * leftover / total)}%)` : 'sem amostras';
    };
    for (const [name, action] of latestActions) {
      const samples = snapshot.observations.filter((record) => record.kind === 'sobra' && itemKey(record) === name);
      const before = summarize(samples.filter((record) => record.id < action.id));
      const after = summarize(samples.filter((record) => record.id > action.id));
      const row = document.createElement('li');
      row.className = 'call';
      row.textContent = `${action.item} · Antes: ${before} · Depois: ${after}`;
      list.append(row);
    }
    if (!list.children.length) list.textContent = 'Registre uma ação para comparar as amostras do mesmo item.';
  }

  function renderCleaning() {
    const list = get('cleaning-list');
    const filter = get('area').value;
    const focused = list.contains(document.activeElement) ? document.activeElement.id : '';
    const tasks = snapshot.cleaning.filter((task) => !filter || area(task.table_no) === filter);
    const open = tasks.filter((task) => task.finished === null);
    const recent = tasks.filter((task) => task.finished !== null).sort((a, b) => b.finished - a.finished).slice(0, 5);
    list.replaceChildren();
    for (const task of [...open, ...recent]) {
      const row = document.createElement('li');
      row.className = 'task-card';
      row.classList.toggle('active-task', task.started !== null);
      const line = document.createElement('span');
      const state = task.finished !== null ? 'Mesa pronta' : task.started !== null ? 'Em limpeza' : 'Aguardando limpeza';
      line.textContent = `Mesa ${task.table_no} · ${area(task.table_no)} · ${state} · ${duration((task.finished ?? snapshot.now) - task.created)} desde a sinalização`;
      row.append(line);
      if (task.finished === null) {
        const button = document.createElement('button');
        button.id = `clean-task-${task.id}`;
        button.textContent = task.started === null ? 'Assumir limpeza' : 'Mesa pronta';
        button.onclick = () => submit(task.started === null ? 'assumir-limpeza' : 'mesa-pronta', { id: task.id });
        row.append(button);
      }
      list.append(row);
    }
    if (!list.children.length) list.textContent = 'Nenhuma tarefa de limpeza neste setor.';
    if (focused) get(focused)?.focus();
  }

  function render() {
    if (!snapshot) return;
    if (management) {
      snapshot.queues.forEach(renderQueue);
      get('management-cleaning').textContent = snapshot.cleaning.filter((task) => task.finished === null).length;
      renderQualitySummary();
      renderObservations();
      renderBuffetComparison();
    } else {
      renderCleaning();
    }
  }

  async function refresh() {
    if (loading || busy) return;
    loading = true;
    try {
      const [operation, calls] = await Promise.allSettled([
        api('/api/operacao'), management ? api('/api/chamados') : Promise.resolve(null),
      ]);
      if (management) {
        get('management-service-error').hidden = calls.status === 'fulfilled';
        if (calls.status === 'fulfilled') {
          service = calls.value;
          renderService();
        }
      }
      if (operation.status === 'rejected') throw operation.reason;
      snapshot = operation.value;
      render();
      if (error.dataset.source === 'refresh') showError('');
    } catch {
      if (error.hidden || error.dataset.source === 'refresh') {
        error.dataset.source = 'refresh';
        showError('Painel desatualizado. A reconexão será tentada automaticamente.');
      }
    } finally {
      loading = false;
    }
  }

  async function submit(action, data) {
    if (busy) return false;
    busy = true;
    status.textContent = '';
    const signature = JSON.stringify([action, data]);
    if (!pending.has(signature)) {
      const key = Array.from(crypto.getRandomValues(new Uint8Array(18)), (byte) => byte.toString(16).padStart(2, '0')).join('');
      pending.set(signature, key);
    }
    try {
      await api(`/api/operacao/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, key: pending.get(signature) }),
      });
      pending.delete(signature);
      status.textContent = 'Registro salvo.';
      showError('');
      return true;
    } catch (failure) {
      error.dataset.source = 'submit';
      showError(['TypeError', 'TimeoutError', 'AbortError'].includes(failure.name)
        ? 'Não foi possível confirmar o envio. Repita a mesma ação.' : failure.message);
      if (!['TypeError', 'TimeoutError', 'AbortError'].includes(failure.name)) pending.delete(signature);
      return false;
    } finally {
      busy = false;
      void refresh();
    }
  }

  for (const button of document.querySelectorAll('[data-sim]')) {
    button.addEventListener('click', () => {
      const form = button.closest('form');
      let fixture;
      if (button.dataset.sim === 'limpeza') fixture = { table: 12 };
      else if (button.dataset.sim === 'prato') fixture = { first: 160, second: 322 };
      else fixture = form.closest('[data-place]').dataset.place === 'churrasqueira'
        ? { people: 9, wait: 420 } : { people: 3, wait: 120 };
      for (const [name, value] of Object.entries(fixture)) form.elements.namedItem(name).value = value;
      status.textContent = 'Amostra simulada preenchida. Revise e confirme para salvar.';
    });
  }
  const comment = get('comment');
  function classifyComment() {
    if (!comment) return;
    const text = comment.value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const category = /fri[oa]|temperatura|gelad/.test(text) ? 'Temperatura'
      : /seco|seca|duro|dura|textura/.test(text) ? 'Textura'
      : /indispon|acabou|falta/.test(text) ? 'Disponibilidade'
      : /fila|buffet|ingrediente/.test(text) ? 'Buffet'
      : /garcom|atendimento|demor/.test(text) ? 'Atendimento' : null;
    document.querySelector('[data-comment-tag]').textContent = category ? `Categoria sugerida por palavras-chave: ${category}.` : '';
  }
  comment?.addEventListener('input', classifyComment);

  for (const form of document.querySelectorAll('form[data-action]')) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      for (const field of form.querySelectorAll('input[type=number]')) {
        data[field.name] = field.value === '' ? null : Number(field.value);
      }
      const place = form.closest('[data-place]')?.dataset.place;
      if (place) data.place = place;
      if (form.dataset.kind) data.kind = form.dataset.kind;
      if (form.dataset.id) data.id = Number(form.dataset.id);
      if (await submit(form.dataset.action, data)) { form.reset(); classifyComment(); }
    });
  }

  if (staff) {
    get('cleaning-panel').hidden = false;
    get('area').addEventListener('change', render);
  }
  window.addEventListener('mesa-atenta:change', refresh);
  void refresh();
  setInterval(refresh, 2500);
})();
