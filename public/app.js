const get = (id) => document.getElementById(id);
const staff = location.pathname === '/equipe';
const rawTable = new URLSearchParams(location.search).get('mesa');
const table = /^\d{1,2}$/.test(rawTable || '') ? Number(rawTable) : 0;
const validTable = table >= 1 && table <= 90;
const reasons = { bebida: 'Atendimento para bebida', atendimento: 'Atendimento à mesa' };
const tableLabel = (number) => String(number).padStart(2, '0');
const areaFor = (number) => number <= 30 ? 'Salão principal' : number <= 70 ? 'Salão superior' : 'Salão inferior';
let snapshot;
let busy = false;
let loading = false;
const retryKeys = {};

function duration(seconds) {
  seconds = Math.max(0, Math.round(seconds));
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

async function api(path, options) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível executar a ação.');
  return data;
}

function message(text) {
  get('error').textContent = text;
  get('error').hidden = !text;
}

function element(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}

function render() {
  if (!snapshot) return;
  const selectedArea = staff ? get('area').value : '';
  const calls = snapshot.calls.filter((call) => !selectedArea || selectedArea === call.area);
  const open = calls.filter((call) => call.finished === null);
  const done = calls.filter((call) => call.finished !== null);
  if (staff) {
    const answered = calls.filter((call) => call.started !== null);
    get('waiting').textContent = open.filter((call) => call.started === null).length;
    get('serving').textContent = open.filter((call) => call.started !== null).length;
    get('average').textContent = answered.length
      ? duration(answered.reduce((sum, call) => sum + call.started - call.created, 0) / answered.length)
      : '—';
  }
  const list = get('calls');
  const focusId = list.contains(document.activeElement) ? document.activeElement.id : '';
  const pending = open.filter((call) => call.started === null);
  const serving = open.filter((call) => call.started !== null);
  const recent = done.sort((a, b) => b.finished - a.finished).slice(0, 5);
  list.replaceChildren();
  for (const call of [...pending, ...serving, ...recent]) {
    const row = element('li', '', 'call');
    const description = element('div', '');
    description.append(
      element('strong', staff ? `Mesa ${tableLabel(call.table)} · ${call.area}` : reasons[call.reason]),
      element('p', staff ? reasons[call.reason] : ''),
    );
    const detail = element('div', '');
    const state = call.finished !== null ? 'Concluído' : call.started !== null ? 'Em atendimento' : 'Aguardando';
    detail.append(
      element('span', state, call.finished !== null ? 'badge done' : 'badge'),
      element('p', `Espera ${duration((call.started ?? snapshot.now) - call.created)}`),
    );
    row.append(description, detail);
    if (staff && call.finished === null) {
      const action = call.started === null ? 'assumir' : 'concluir';
      const button = element('button', action === 'assumir' ? 'Assumir' : 'Concluir');
      button.id = `call-${call.id}`;
      button.disabled = busy;
      button.addEventListener('click', () => submit(`/api/chamados/${call.id}/${action}`, { method: 'POST' }, 'Chamado atualizado.'));
      row.append(button);
    }
    list.append(row);
  }
  if (!list.children.length) list.append(element('li', 'Nenhum chamado por enquanto.'));
  if (focusId) get(focusId)?.focus();
}

async function refresh() {
  if (loading || busy) return;
  loading = true;
  try {
    snapshot = await api(staff ? '/api/chamados' : `/api/chamados?mesa=${table}`);
    render();
    if (get('error').dataset.source === 'refresh') message('');
  } catch {
    if (!busy && (get('error').hidden || get('error').dataset.source === 'refresh')) {
      get('error').dataset.source = 'refresh';
      message('Conexão indisponível. A tela tentará atualizar automaticamente.');
    }
  } finally {
    loading = false;
  }
}

async function submit(path, options, success) {
  if (busy) return false;
  busy = true;
  get('notice').textContent = '';
  document.querySelectorAll('[data-reason]').forEach((button) => { button.disabled = true; });
  let saved = false;
  try {
    await api(path, options);
    get('notice').textContent = success;
    message('');
    saved = true;
  } catch (error) {
    get('error').dataset.source = 'submit';
    const interrupted = ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name);
    message(interrupted ? 'Conexão interrompida. Tente a mesma ação novamente.' : error.message);
  } finally {
    busy = false;
    document.querySelectorAll('[data-reason]').forEach((button) => { button.disabled = false; });
    void refresh();
  }
  return saved;
}

get(staff ? 'staff' : 'customer').hidden = false;
get(staff ? 'staff-link' : 'customer-link').setAttribute('aria-current', 'page');
if (staff) {
  get('area').addEventListener('change', render);
} else if (validTable) {
  document.querySelector('.table-orb').textContent = tableLabel(table);
  get('table-title').textContent = `Mesa ${tableLabel(table)}`;
  get('table-area').textContent = areaFor(table);
  get('table-form').hidden = true;
  get('actions').hidden = false;
  for (const button of document.querySelectorAll('[data-reason]')) {
    button.addEventListener('click', async () => {
      if (busy) return;
      const reason = button.dataset.reason;
      retryKeys[reason] ??= 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
        const random = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
        return (character === 'x' ? random : (random & 3) | 8).toString(16);
      });
      const saved = await submit('/api/chamados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, reason, key: retryKeys[reason] }),
      }, 'Solicitação registrada. Acompanhe abaixo.');
      if (saved) delete retryKeys[reason];
    });
  }
} else if (rawTable !== null) {
  message('Mesa inválida. Informe um número de 1 a 90.');
}

if (staff || validTable) {
  window.addEventListener('mesa-atenta:change', refresh);
  void refresh();
  setInterval(refresh, 2000);
}
