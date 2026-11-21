import { shelves } from './storeData.js';

const BASE = './public/data/';
const CNY_PER_USD = 7; // 教学演示换算假设，不是实时汇率。
const shelfByDepartment = {
  frozen:'冷冻食品', other:'文具', bakery:'烘焙', produce:'生鲜', alcohol:'饮料',
  international:'调味品', beverages:'饮料', pets:'宠物用品', 'dry goods pasta':'粮油',
  bulk:'粮油', 'personal care':'个人护理', 'meat seafood':'肉类', pantry:'调味品',
  breakfast:'粮油', 'canned goods':'速食', 'dairy eggs':'乳制品', household:'日用品',
  babies:'母婴用品', snacks:'零食', deli:'速食', missing:'文具'
};
const departmentChinese = {
  frozen:'冷冻食品', other:'其他', bakery:'烘焙', produce:'生鲜', alcohol:'酒类',
  international:'国际食品', beverages:'饮料', pets:'宠物用品', 'dry goods pasta':'干货与面食',
  bulk:'散装食品', 'personal care':'个人护理', 'meat seafood':'肉类与海鲜', pantry:'调味与储藏食品',
  breakfast:'早餐食品', 'canned goods':'罐头食品', 'dairy eggs':'乳制品与蛋类', household:'家居日用',
  babies:'母婴用品', snacks:'零食', deli:'熟食', missing:'未分类'
};
const text = value => String(value ?? '');
export const escapeHtml = value => text(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

async function loadJson(path) {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

export async function loadResearch() {
  const [index, summary, rules, clusters, top, topReordered] = await Promise.all([
    loadJson('catalog/index.json'), loadJson('summary.json'), loadJson('rules.json'),
    loadJson('clusters.json'), loadJson('top-products.json'), loadJson('top-reordered.json')
  ]);
  return {index, summary, rules, clusters, top, topReordered};
}

export function convertProduct(row) {
  let zone = shelfByDepartment[row.department] || '文具';
  if (row.department === 'produce') zone = '生鲜';
  if (row.department === 'meat seafood') zone = /seafood|fish|shellfish/i.test(row.aisle) ? '海鲜' : '肉类';
  if (row.department === 'household' && /clean|laundry/i.test(row.aisle)) zone = '清洁用品';
  if (row.department === 'pantry' && /oil|vinegar/i.test(row.aisle)) zone = '粮油';
  const shelf = shelves.find(item => item.category === zone) || shelves[0];
  return {
    id:`I${row.id}`, sourceId:row.id, name:row.name, category:departmentChinese[row.department] || row.department,
    subcategory:row.aisle, department:row.department, departmentId:row.departmentId,
    aisleId:row.aisleId, shelfId:shelf.id, point:[...shelf.point],
    price:(row.priceUsd || 0)*CNY_PER_USD, priceUsd:row.priceUsd,
    weight:(row.weightG || 0)/1000, weightG:row.weightG, calories100g:row.calories100g,
    priceMethod:row.priceMethod, weightMethod:row.weightMethod, calorieMethod:row.calorieMethod,
    dataQuality:row.quality, capacity:20, stock:20, source:'Instacart 商品名称与类别；属性为估算',
  };
}

export async function searchCatalog(index, query, departmentId, aisleId, limit=36) {
  const search = query.trim().toLowerCase();
  if (search && !departmentId && !aisleId) {
    const first = (search.match(/[a-z0-9]/)?.[0] || '_');
    if (first === '_') return [];
    const entries = await loadJson(`catalog/search-${first}.json`);
    const matching = entries.filter(([,name]) => name.toLowerCase().includes(search))
      .sort((a,b) => Number(b[1].toLowerCase().startsWith(search))-Number(a[1].toLowerCase().startsWith(search)) || a[1].length-b[1].length)
      .slice(0,limit);
    const ids = new Set(matching.map(row => row[0]));
    const departments = [...new Set(matching.map(row => row[2]))];
    const details = [];
    for (const id of departments) {
      const rows = await loadJson(`catalog/department-${id}.json`);
      for (const row of rows) if (ids.has(row.id)) details.push(row);
    }
    const rank = new Map(matching.map((row,i) => [row[0],i]));
    return details.sort((a,b)=>rank.get(a.id)-rank.get(b.id));
  }
  const departments = departmentId ? [Number(departmentId)] : index.departments.map(item => item.id);
  const found = [];
  for (const id of departments) {
    const rows = await loadJson(`catalog/department-${id}.json`);
    for (const row of rows) {
      if (aisleId && row.aisleId !== Number(aisleId)) continue;
      if (search && !`${row.name} ${row.aisle} ${row.department}`.toLowerCase().includes(search)) continue;
      found.push(row);
      if (found.length >= limit) return found;
    }
  }
  return found;
}

export function propertyLabels(product) {
  const price = product.priceMethod === 'online_bls_staple_proxy' ? '基础商品参考价格代理' : '类别价格估算';
  const weight = product.weightMethod === 'category_default_after_spec_guard' ? '规格字段疑似误解析，已回退类别默认值' : /parse|name/i.test(product.weightMethod) ? '名称规格解析' : '类别默认重量';
  const calorie = product.calories100g == null ? '非食品／不适用' : '类别营养估算';
  return {price, weight, calorie};
}

function barChart(items, unit='') {
  const max = Math.max(1, ...items.map(item => item.count));
  return `<div class="research-bars">${items.map(item => `<div class="research-bar"><span>${escapeHtml(item.range)}</span><div><i style="width:${Math.max(1,item.count/max*100)}%"></i></div><b>${item.count.toLocaleString()}${unit}</b></div>`).join('')}</div>`;
}

export function renderResearchDashboard(data) {
  const {summary:s, rules:r, clusters:c} = data;
  const el = document.getElementById('researchDashboard');
  if (!el) return;
  const count = x => x.toLocaleString('zh-CN');
  const m = s.methods;
  const q = s.quality;
  el.innerHTML = `
    <div class="research-hero"><div><p class="section-kicker">真实数据处理 · 离线计算结果</p><h2>Instacart 订单与商品分析</h2><p>订单、商品名称和购买关系来自提供的清洗数据。价格、重量、热量是估算属性；店内客流与机器人传感器仍为教学模拟。</p></div><span class="research-badge">数据来源：Instacart</span></div>
    <div class="research-stats"><div><b>${count(s.products)}</b><span>商品</span></div><div><b>${count(s.orders)}</b><span>订单</span></div><div><b>${count(s.orderProductLines)}</b><span>训练集商品记录</span></div><div><b>${count(s.aisles)} / ${count(s.departments)}</b><span>货架类别 / 部门</span></div><div><b>${s.meanTrainBasketSize}</b><span>训练集平均每篮商品数</span></div></div>
    <div class="research-grid"><article class="info-card"><h3>商品估算属性分布</h3><p>价格 USD（估算）</p>${barChart(s.priceDistribution)}<p>重量 g（估算）</p>${barChart(s.weightDistribution)}<p>每 100g 热量 kcal（仅食品，类别估算）</p>${barChart(s.calorieDistribution)}<p class="assumption">价格：类别估算 ${count(m.price_method.category_average_estimate || 0)} 件；基础商品参考代理 ${count(Object.values(m.price_method).reduce((a,b)=>a+b,0)-(m.price_method.category_average_estimate||0))} 件。重量：名称解析 ${count(Object.entries(m.weight_method).filter(([k])=>/parse|name/i.test(k)).reduce((n,[,v])=>n+v,0))} 件；其余使用类别默认值。</p></article>
    <article class="info-card"><h3>实际订单时段分布</h3><p>这是<strong>线上下单时段</strong>，不是店内货架客流。</p>${barChart(Object.entries(s.orderHour).map(([range,count])=>({range:`${range}:00`,count})))}<h3>高频商品 Top 10</h3><ol id="topProductList" class="research-list"></ol><h3>高频复购商品 Top 10</h3><ol id="topReorderedList" class="research-list"></ol></article></div>
    <div class="research-grid"><article class="info-card"><h3>Apriori 关联规则</h3><p>真实 train 购物篮 ${count(r.baskets)} 篮；候选商品 ${count(r.candidateProducts)} 件／训练集中出现 ${count(r.distinctProducts)} 件；最小计数 ${r.minSupportCount}；挖掘耗时 ${r.seconds} 秒；初始规则 ${count(r.ruleCount)} 条。</p><div class="research-controls"><label>最小支持度 <input id="ruleSupport" type="number" min="${r.minSupport}" max="1" step="0.0001" value="0.0003" /></label><label>最小置信度 <input id="ruleConfidence" type="number" min="0" max="1" step="0.01" value="0.15" /></label></div><p id="ruleFilterCount"></p><div id="researchRuleTable"></div><div id="ruleNetwork" class="rule-network"></div><p class="assumption">${escapeHtml(r.scope)} 共购关系不证明因果或推荐带来的增购。</p></article>
    <article class="info-card"><h3>K-means 商品聚类</h3><p>样本 ${count(c.sampleSize)} 件高频食品，输入为估算价格、重量、热量与真实购买频次、复购比例、aisle／department one-hot。非食品不填造热量；热量估算会影响结果。</p><p>肘部法选择 K=${c.selectedK}；轮廓系数在 ${c.silhouetteSample} 件固定样本上评价；训练耗时 ${c.seconds} 秒。</p><div id="kDiagnostics"></div><div id="clusterPlot" class="cluster-plot"></div><div id="clusterCards"></div><p class="assumption">二维图为 PCA 投影，仅用于观察；聚类不等于最优货架布局，冷链、食品隔离与通道宽度仍须单独审查。</p></article></div>
    <article class="info-card"><h3>数据质量与处理记录</h3><div class="quality-grid"><div><b>输入检查</b><p>导入已清洗文件：商品 ${count(q.rawRows.products)} 行、订单 ${count(q.rawRows.orders)} 行、训练集商品记录 ${count(q.rawRows.orderProductsTrain)} 行；有效输出分别为 ${count(q.cleanRows.products)}、${count(q.cleanRows.orders)}、${count(q.cleanRows.orderProductsTrain)} 行。</p></div><div><b>重复与关联检查</b><p>提供文件内重复：商品 ${q.duplicateRowsInProvidedCleanFiles.products}、订单 ${q.duplicateRowsInProvidedCleanFiles.orders}、订单商品 ${q.duplicateRowsInProvidedCleanFiles.orderProductsTrain}；无效商品／订单／类别关联 ${count(Object.values(q.invalidLinksInProvidedCleanFiles).reduce((a,b)=>a+b,0))}。</p></div><div><b>缺失与异常检查</b><p>缺少热量 ${count(q.missingProductFields.calories_kcal_per_100g || 0)} 件（含非食品）；首单等缺少前次订单间隔 ${count(q.missingPriorOrderInterval)} 行，未填 0；非正价格 ${(q.invalidAttributeValues.nonPositivePrice||0)}、非正重量 ${(q.invalidAttributeValues.nonPositiveWeight||0)}、负热量 ${(q.invalidAttributeValues.negativeCalories||0)}；疑似规格误解析并回退类别默认重量 ${q.correctedParsedWeights||0} 件。</p></div><div><b>属性与特征工程</b><p>源表已补充价格、重量、热量及方法标签；本脚本解析整数 ID 和数值字段，按 train 篮统计频次／复购，聚类执行对数变换、标准化与 one-hot。</p></div></div><p class="assumption">${escapeHtml(q.note)} 原始文件的清洗前异常量与删除量未提供，不能虚构；网页展示的是对已清洗文件的复核与后续离线挖掘。</p></article>`;
  document.getElementById('topProductList').innerHTML = data.top.slice(0,10).map(p => `<li>${escapeHtml(p.name)} · ${count(p.frequency)} 次 · 复购记录比例 ${(p.reorderRate*100).toFixed(1)}%</li>`).join('');
  document.getElementById('topReorderedList').innerHTML = data.topReordered.map(p => `<li>${escapeHtml(p.name)} · 复购记录 ${count(p.reorderedCount)} 次／总购买 ${count(p.frequency)} 次</li>`).join('');
  function renderFilteredRules() {
    const support = Math.max(r.minSupport, Number(document.getElementById('ruleSupport').value) || 0);
    const confidence = Math.max(0, Number(document.getElementById('ruleConfidence').value) || 0);
    const filtered = r.rules.filter(rule => rule.support >= support && rule.confidence >= confidence);
    document.getElementById('ruleFilterCount').textContent = `当前阈值下 ${count(filtered.length)} 条规则（在已挖掘候选范围内筛选）`;
    document.getElementById('researchRuleTable').innerHTML = filtered.slice(0,10).map(rule => `<div class="rule-row"><b>${escapeHtml(r.products[rule.from]?.name)} → ${escapeHtml(r.products[rule.to]?.name)}</b><small>支持度 ${(rule.support*100).toFixed(3)}% · 置信度 ${(rule.confidence*100).toFixed(1)}% · 提升度 ${rule.lift.toFixed(2)}</small></div>`).join('') || '<p>当前阈值没有匹配规则。</p>';
    document.getElementById('ruleNetwork').innerHTML = filtered.slice(0,8).map(rule => `<div><span>${escapeHtml(r.products[rule.from]?.name)}</span><i>→</i><span>${escapeHtml(r.products[rule.to]?.name)}</span></div>`).join('');
  }
  ['ruleSupport','ruleConfidence'].forEach(id => document.getElementById(id).addEventListener('input', renderFilteredRules));
  renderFilteredRules();
  document.getElementById('kDiagnostics').innerHTML = `<table><thead><tr><th>K</th><th>类内平方和</th><th>轮廓系数</th></tr></thead><tbody>${c.kValues.map(x=>`<tr><td>${x.k}</td><td>${x.inertia.toFixed(1)}</td><td>${x.silhouette?.toFixed(3) ?? '无'}</td></tr>`).join('')}</tbody></table>`;
  const colors = ['#13a89e','#3b82f6','#ef9c36','#ad70d2','#e45b69','#7c9b43','#344f72'];
  document.getElementById('clusterPlot').innerHTML = c.points.map(([x,y,label])=>`<i title="聚类 ${label}" style="left:${(x+1)*50}%;top:${(1-y)*50}%;background:${colors[(label-1)%colors.length]}"></i>`).join('');
  document.getElementById('clusterCards').innerHTML = c.clusters.map(group=>`<div class="cluster-card"><b>聚类 ${group.id} · ${count(group.count)} 件</b><small>均价 $${group.avgPriceUsd} · 均重 ${group.avgWeightG}g · 热量 ${group.avgCalories100g}kcal/100g · 复购 ${((group.avgReorderRate||0)*100).toFixed(1)}%</small><span>代表商品：${group.representatives.map(escapeHtml).join('、')}</span></div>`).join('');
}
