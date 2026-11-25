/* Run against a fresh seeded demo: MESA_URL=http://127.0.0.1:8765 node tests/verify_ui.cjs */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.MESA_URL || 'http://127.0.0.1:8765';
const evidence = process.env.MESA_EVIDENCE;
const waitText = (page, selector, regex) => page.waitForFunction(
  ({ selector, source }) => new RegExp(source, 'i').test(document.querySelector(selector)?.textContent),
  { selector, source: regex.source }, { timeout: 10000 }
);
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  try {
    const mobile = { viewport: { width: 390, height: 844 } };
    const mesa = await browser.newPage(mobile);
    const salao = await browser.newPage(mobile);
    const gestao = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const pages = [mesa, salao, gestao];
    const errors = [];
    pages.forEach((p) => p.on('pageerror', (error) => errors.push(error.message)));
    await Promise.all(pages.map((p, i) => p.goto(base + ['/mesa?mesa=07', '/equipe', '/gestao'][i])));
    for (const p of pages) assert.equal(await p.locator('main h1').count(), 1);
    assert.equal(await mesa.locator('#cleaning-panel, #area').count(), 0);
    assert.equal(await salao.locator('[data-reason]').count(), 0);
    assert.equal(await gestao.locator('[data-reason], [data-action="sinalizar"]').count(), 0);
    await waitText(gestao, '[data-quality="mix"]', /160 g/);
    await waitText(salao, '#cleaning-list', /Mesa 12/);
    for (const p of [mesa, salao]) assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const cap = (page, name) => evidence && page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true });
    await mesa.getByRole('button', { name: /Pedir atendimento para bebida/ }).click();
    await waitText(mesa, '#client-confirmation', /registrado/);
    await cap(mesa, '01-mesa-chamado');
    await waitText(salao, '#calls', /Mesa 07/);
    const call = salao.locator('#calls li').filter({ hasText: 'Mesa 07' });
    await call.getByRole('button', { name: 'Assumir', exact: true }).click();
    await waitText(mesa, '#client-confirmation', /garçom assumiu/);
    await waitText(gestao, '#management-calls', /Em atendimento/);
    await cap(salao, '02-salao-atendimento');
    await call.getByRole('button', { name: 'Concluir', exact: true }).click();
    await waitText(mesa, '#client-confirmation', /concluído/);
    await waitText(gestao, '#management-done', /^1$/);
    await cap(mesa, '03-mesa-concluida');
    const task = salao.locator('#cleaning-list li').filter({ hasText: 'Mesa 12' });
    await task.getByRole('button', { name: 'Assumir limpeza' }).click();
    await waitText(salao, '#cleaning-list', /Em limpeza/);
    await task.getByRole('button', { name: 'Mesa pronta' }).click();
    await waitText(salao, '#cleaning-list', /Mesa pronta/);
    await waitText(gestao, '#management-cleaning', /^0$/);
    await cap(salao, '04-salao-limpeza');
    const queue = gestao.locator('[data-place=churrasqueira]');
    await queue.getByRole('button', { name: 'Confirmar ciência' }).click();
    await queue.locator('input[name=note]').fill('Reforçar atendimento na entrada da fila');
    await queue.getByRole('button', { name: 'Salvar ação' }).click();
    await waitText(gestao, '[data-place=churrasqueira] [data-comparison]', /mediana antes/);
    await queue.getByText('Registrar medição').click();
    await queue.locator('input[name=people]').fill('4');
    await queue.locator('input[name=wait]').fill('210');
    // Measurements are stored at second precision; use a later second than the action.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await queue.getByRole('button', { name: 'Salvar medição' }).click();
    await waitText(gestao, '[data-place=churrasqueira] [data-comparison]', /Depois: 3 min 30 s/);
    await queue.getByText('Registrar medição').click();
    await gestao.getByText('Adicionar registros do buffet').click();
    const action = gestao.locator('[data-kind=acao]');
    await action.locator('[name=item]').fill('Farofa');
    await action.locator('[name=note]').fill('Identificar os ingredientes');
    await action.getByRole('button').click();
    await waitText(gestao, '[data-quality=acao]', /Identificar os ingredientes/);
    const leftovers = gestao.locator('[data-kind=sobra]');
    await leftovers.locator('[name=item]').fill('Farofa');
    await leftovers.locator('[name=second]').fill('8');
    await leftovers.locator('[name=first]').fill('1');
    await leftovers.getByRole('button').click();
    await waitText(gestao, '#buffet-comparison', /Antes: 3\/8 pratos.*Depois: 1\/8 pratos/);
    await gestao.getByText('Adicionar registros do buffet').click();
    await cap(gestao, '05-gestao');
    await gestao.setViewportSize({ width: 390, height: 844 });
    assert.ok(await gestao.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const bad = await browser.newPage(mobile);
    await bad.goto(base + '/mesa?mesa=99');
    await waitText(bad, '#error', /inválida/);
    assert.equal(await bad.locator('#actions').isVisible(), false);
    await bad.locator('#table').fill('7');
    await bad.getByRole('button', { name: 'Abrir', exact: true }).click();
    await bad.getByRole('heading', { name: /Como podemos ajudar/ }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: três telas independentes, navegador em três contextos, bebida, gestão, limpeza, medição e validação mobile.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
