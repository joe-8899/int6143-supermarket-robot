// 仅组织演示页面：原有购物、导航和教学计算逻辑保留在 app.js。
(() => {
  const main = document.getElementById('appMain');
  const sections = {
    order: ['.intro', '.order-section'],
    robot: ['.workspace', '.event-section'],
    data: ['.analytics-grid', '.explanation-card', '.info-card:has(#dataAudit)', '.expert-grid > .info-card:last-child'],
    operations: ['.inventory-panel', '.info-card:has(#pickupFeasibility)', '.info-card:has(#faultSelect)'],
    comparison: ['.comparison-card', '.info-card:has(#benchmarkBtn)'],
  };
  const titles = { order: '顾客下单', robot: '机器人演示', data: '数据分析', operations: '库存与异常', comparison: '路线对比' };
  const descriptions = {
    robot: '订单驱动的 3D 购物流程。先完成教学模拟付款，再观察路线、避障和出口交接。',
    data: '查看分时段客流、购物篮共购关系，以及数据如何影响路线。',
    operations: '查看低库存预警、人工补货、取货可行性和故障安全停车。',
    comparison: '比较同一订单的原路线与新路线，并检查路径成本的影响。',
  };
  const panels = {};
  for (const [name, selectors] of Object.entries(sections)) {
    const panel = document.createElement('div');
    panel.className = 'view-panel';
    panel.id = `view-${name}`;
    panel.setAttribute('aria-label', titles[name]);
    if (name !== 'order') {
      const heading = document.createElement('div');
      heading.className = 'view-heading';
      const lead = document.createElement('div');
      lead.innerHTML = `<p class="section-kicker">INT6143 · GROUP 3</p><h1>${titles[name]}</h1><p>${descriptions[name]}</p>`;
      heading.append(lead);
      if (name === 'robot') {
        const button = document.createElement('button');
        button.className = 'secondary-btn';
        button.type = 'button';
        button.textContent = '先去下单';
        button.addEventListener('click', () => showView('order'));
        heading.append(button);
      }
      panel.append(heading);
    }
    selectors.forEach(selector => {
      const node = document.querySelector(selector);
      if (node && !panel.contains(node)) panel.append(node);
    });
    main.append(panel);
    panels[name] = panel;
  }
  // 原页面中仅用于布局的空容器已不再需要。
  document.querySelectorAll('.lower-grid, .expert-grid').forEach(node => node.remove());
  const nav = [...document.querySelectorAll('[data-view]')];
  function showView(name, updateHash = true) {
    if (!panels[name]) name = 'robot';
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== name;
    nav.forEach(button => {
      const active = button.dataset.view === name;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });
    document.getElementById('activeViewTitle').textContent = titles[name];
    if (updateHash) history.replaceState(null, '', `#${name}`);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  nav.forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.getElementById('headerOrderBtn').addEventListener('click', () => showView('order'));
  document.getElementById('fullscreenBtn').addEventListener('click', async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  });
  document.getElementById('submitOrderBtn').addEventListener('click', () => {
    requestAnimationFrame(() => {
      if (document.getElementById('orderMessage').textContent.includes('教学模拟付款成功')) showView('robot');
    });
  });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1), false));
  showView(location.hash.slice(1), false);
})();
