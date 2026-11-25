(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let operations;
  let calls;
  let busy = false;

  const key = () => crypto.randomUUID();
  const duration = (seconds) => {
    const value = Math.max(0, Math.round(seconds));
    return `${Math.floor(value / 60)} min ${String(value % 60).padStart(2, '0')} s`;
  };
  const status = (id, message, error = false) => {
    const node = document.getElementById(id);
    node.textContent = message;
    node.style.color = error ? '#981524' : '#28651f';
  };
  async function api(path, options = {}) {
    const response = await fetch(path, { ...options, signal: AbortSignal.timeout(6000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
    return data;
  }
  async function post(path, payload, statusId, success) {
    if (busy) return false;
    busy = true;
    $$('button').forEach((button) => { button.disabled = true; });
    try {
      await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, key: key() }),
      });
      status(statusId, success);
      await refresh();
      return true;
    } catch (error) {
      status(statusId, error.message, true);
      return false;
    } finally {
      busy = false;
      $$('button').forEach((button) => { button.disabled = false; });
    }
  }

  function renderQueues() {
    for (const queue of operations.queues) {
      const card = $(`[data-queue="${queue.place}"]`);
      if (!card) continue;
      const active = Boolean(queue.alert && queue.alert.closed === null);
      const people = queue.reading?.people ?? (queue.place === 'churrasqueira' ? 8 : 3);
      $('[data-queue-people]', card).textContent = people;
      $('[data-queue-limit]', card)?.replaceChildren(String(queue.threshold));
      card.classList.toggle('danger', active);
      card.classList.toggle('safe', !active);
      const badge = $('.state', card);
      badge.className = `state ${active ? 'danger-state' : 'safe-state'}`;
      $('b', badge).textContent = active ? '!' : '✓';
      $('[data-queue-state]', card).textContent = active
        ? (queue.alert.acknowledged === null ? 'Acúmulo detectado' : 'Gerente ciente')
        : 'Sem alerta';
    }
    const queue = operations.queues.find((item) => item.place === 'churrasqueira');
    const alert = queue?.alert?.closed === null ? queue.alert : null;
    const acknowledge = $('#acknowledge-alert');
    const save = $('#save-manager-action');
    acknowledge.hidden = !alert || alert.acknowledged !== null;
    save.disabled = !alert || alert.acknowledged === null || Boolean(alert.action);
    $('#manager-action').disabled = save.disabled;
    if (alert?.action) $('#manager-action').value = alert.action;
    acknowledge.dataset.alertId = alert?.id ?? '';
    save.dataset.alertId = alert?.id ?? '';
  }

  function renderQuality() {
    const records = operations.observations || [];
    const mix = records.find((record) => record.kind === 'mix');
    if (mix) {
      $('[data-mix-meat]').textContent = `${mix.first_value} g`;
      $('[data-mix-other]').textContent = `${mix.second_value} g`;
      $('[data-mix-percent]').textContent = Math.round(100 * mix.first_value / (mix.first_value + mix.second_value));
    }
    const leftover = records.find((record) => record.kind === 'sobra');
    if (leftover) {
      $('[data-leftover-item]').textContent = leftover.item;
      $('[data-leftover-count]').textContent = leftover.first_value;
      $('[data-leftover-total]').textContent = leftover.second_value;
    }
    const comment = records.find((record) => record.kind === 'comentario');
    if (comment) {
      $('[data-comment-source]').textContent = `${comment.source} · ${comment.item}`;
      $('[data-comment-note]').textContent = comment.note;
    }
    const action = records.find((record) => record.kind === 'acao');
    if (action) $('[data-quality-action]').textContent = action.note;
  }

  function renderStaff() {
    const open = calls.calls.filter((call) => call.finished === null);
    const current = open.find((call) => call.table === 7) || open[0];
    const card = $('#staff-call');
    if (current) {
      card.hidden = false;
      $('strong', card).textContent = `Mesa ${String(current.table).padStart(2, '0')} · ${current.reason === 'bebida' ? 'Bebida' : 'Atendimento'}`;
      $('[data-call-time]', card).textContent = duration((current.started ?? calls.now) - current.created);
      const button = $('[data-call-action]', card);
      button.textContent = current.started === null ? 'Assumir' : 'Concluir';
      button.dataset.id = current.id;
      button.dataset.action = current.started === null ? 'assumir' : 'concluir';
    } else {
      card.hidden = true;
    }

    const task = operations.cleaning.find((item) => item.finished === null && item.table_no === 12)
      || operations.cleaning.find((item) => item.finished === null);
    const waiting = $('#clean-waiting');
    const active = $('#clean-active');
    if (!task) {
      waiting.hidden = true;
      active.hidden = true;
      return;
    }
    if (task.started === null) {
      waiting.hidden = false;
      active.hidden = true;
      $('[data-clean-state]', waiting).textContent = 'Aguardando limpeza';
      $('[data-clean-time]', waiting).textContent = duration(operations.now - task.created);
      $('[data-clean-action]', waiting).dataset.id = task.id;
    } else {
      waiting.hidden = true;
      active.hidden = false;
      $('strong', active).textContent = `Mesa ${String(task.table_no).padStart(2, '0')} · Em limpeza`;
      $('[data-clean-finish]', active).dataset.id = task.id;
    }
  }

  function renderClient() {
    const tableCalls = calls.calls.filter((call) => call.table === 7).sort((a, b) => b.created - a.created);
    const current = tableCalls.find((call) => call.finished === null) || tableCalls[0];
    const progress = $('.client-progress');
    const confirmation = $('#client-confirmation');
    const steps = $$(':scope > div', progress);
    steps.forEach((step) => step.classList.remove('current'));
    if (!current || current.started === null) {
      steps[0].classList.add('current');
      confirmation.classList.add('is-hidden');
    } else if (current.finished === null) {
      steps[1].classList.add('current');
      confirmation.classList.remove('is-hidden');
    } else {
      steps[2].classList.add('current');
      confirmation.classList.add('is-hidden');
    }
  }

  function render() {
    if (!operations || !calls) return;
    renderQueues();
    renderQuality();
    renderStaff();
    renderClient();
  }
  async function refresh() {
    if (busy) return;
    try {
      [operations, calls] = await Promise.all([api('/api/operacao'), api('/api/chamados')]);
      render();
    } catch (error) {
      status('management-status', 'Reconectando aos dados compartilhados…', true);
    }
  }

  $('#acknowledge-alert').addEventListener('click', (event) => {
    post('/api/operacao/ciente', { id: Number(event.currentTarget.dataset.alertId) }, 'management-status', 'Ciência confirmada. Registre a ação tomada.');
  });
  $('#save-manager-action').addEventListener('click', (event) => {
    const note = $('#manager-action').value.trim();
    if (!note) return status('management-status', 'Informe a ação tomada.', true);
    post('/api/operacao/intervir', { id: Number(event.currentTarget.dataset.alertId), note }, 'management-status', 'Ação salva e vinculada ao alerta.');
  });
  $('[data-call-action]').addEventListener('click', (event) => {
    const { id, action } = event.currentTarget.dataset;
    post(`/api/chamados/${id}/${action}`, {}, 'staff-status', action === 'assumir' ? 'Chamado assumido.' : 'Atendimento concluído.');
  });
  $('[data-clean-action]').addEventListener('click', (event) => {
    post('/api/operacao/assumir-limpeza', { id: Number(event.currentTarget.dataset.id) }, 'staff-status', 'Limpeza assumida. O tempo continua sendo medido.');
  });
  $('[data-clean-finish]').addEventListener('click', (event) => {
    post('/api/operacao/mesa-pronta', { id: Number(event.currentTarget.dataset.id) }, 'staff-status', 'Mesa pronta e tempo de limpeza registrado.');
  });
  $('#cleaning-form').addEventListener('submit', (event) => {
    event.preventDefault();
    post('/api/operacao/sinalizar', { table: Number($('#cleaning-table').value) }, 'staff-status', 'Mesa adicionada à fila de limpeza.');
  });
  $$('[data-client-reason]').forEach((button) => button.addEventListener('click', (event) => {
    const reason = event.currentTarget.dataset.clientReason;
    post('/api/chamados', { table: 7, reason }, 'client-status', 'Solicitação enviada ao salão.');
  }));

  window.addEventListener('mesa-atenta:change', refresh);
  void refresh();
  setInterval(refresh, 3000);
})();
