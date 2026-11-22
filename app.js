// 顾客订单、教学数据计算、A* 规划与 3D 动画共用 storeData.js。
import { createStoreScene } from './scene3d.js?v=20261122-dynamic';
import { STORE, shelves, layoutFixtures, products, timeSlots, crowdSamples, shelfCrowd, peopleForScenario } from './storeData.js?v=20261122-dynamic';
import { loadResearch, searchCatalog, convertProduct, propertyLabels, renderResearchDashboard, escapeHtml } from './instacart.js';
import { catalogSeed } from './catalogSeed.js';
import { getObstacleSnapshot, registerSensorProvider } from './sensorAdapter.js?v=20261122-dynamic';
const $=id=>document.getElementById(id), SVG='http://www.w3.org/2000/svg', CAPACITY=12, MIN_ORDER=30;
const key=p=>p.join(','), dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]), money=n=>`¥${n.toFixed(2)}`, kg=n=>`${n.toFixed(2)} kg`;
const productById=new Map(products.map(p=>[p.id,p]));
let research=null,catalogIndex=catalogSeed.index,catalogResults=[],catalogRequest=0,catalogTimer=0;
window.INT6143_SENSOR = Object.freeze({registerProvider:registerSensorProvider});
const substituteNames={'苹果':'香蕉','香蕉':'苹果','橙子':'苹果','纯牛奶':'低脂牛奶','低脂牛奶':'纯牛奶','大米':'糙米','糙米':'大米','洗衣液':'浓缩洗衣液','浓缩洗衣液':'洗衣液','鸡胸肉':'猪肉','猪肉':'鸡胸肉','鲜虾':'三文鱼','三文鱼':'鲜虾'};
const substituteFor=product=>product.sourceId?([...productById.values()].find(p=>p.sourceId&&p.id!==product.id&&p.aisleId===product.aisleId&&p.stock>0)||null):products.find(p=>p.name===substituteNames[product.name]);
const state={cart:new Map(),queue:[],completed:[],orderCounter:0,stockoutId:'',shortage:null,resolutions:new Map(),assistPending:null,assistedShelves:new Set(),awaitingPickup:false,order:null,scenario:'normal',slot:'09',running:false,finished:false,blocked:false,suddenPerson:false,fault:'',stage:0,legDistance:0,pauseLeft:0,slowLeft:0,elapsed:0,crowdClock:0,lastFrame:0,bought:[],position:[...STORE.entrance],history:[[...STORE.entrance]],people:new Map(),visiblePeople:[],logs:[],detected:new Set(),avoidanceId:'',plan:null,normalPlan:null};
let scene3d;
function svg(tag,attrs={},parent){const e=document.createElementNS(SVG,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);parent?.appendChild(e);return e;}
function clear(e){e.replaceChildren();}
function pathData(points){return points.map((p,i)=>`${i?'L':'M'}${p[0]*10},${(STORE.height-p[1])*10}`).join(' ');}
function log(message){state.logs.unshift({time:state.elapsed,message});state.logs=state.logs.slice(0,8);$('eventLog').innerHTML=state.logs.map(x=>`<li><span class="event-time">${String(Math.floor(x.time/60)).padStart(2,'0')}:${String(Math.floor(x.time%60)).padStart(2,'0')}</span><span>${escapeHtml(x.message)}</span></li>`).join('');}
function status(title,detail,motion){$('currentAction').textContent=title;$('currentDetail').textContent=detail;$('motionStatus').textContent=`状态：${motion}`;}
function cartLines(){return [...state.cart].filter(([,q])=>q>0).map(([id,qty])=>({product:productById.get(id),qty}));}
function cartWeight(){return cartLines().reduce((n,x)=>n+x.product.weight*x.qty,0);}
function cartPrice(){return cartLines().reduce((n,x)=>n+x.product.price*x.qty,0);}
function orderWeight(){return state.order?.lines.reduce((n,x)=>n+x.product.weight*x.qty,0)??0;}
function pickupProfile(p){const cold=['frozen','dairy eggs','meat seafood'].includes(p.department)||p.category==='冷冻食品'||p.subcategory==='海鲜'||p.subcategory==='肉类'||p.subcategory==='冷藏乳品';const assist=cold||p.name==='饮料箱';return {cold,assist,label:assist?`员工协助${cold?' · 保持冷链':''}`:'演示自动取货'};}
function changeQty(id,delta){
 const next=Math.max(0,Math.min(productById.get(id).stock,(state.cart.get(id)||0)+delta));
 if(next)state.cart.set(id,next);else state.cart.delete(id);
 renderCart();renderRecommendations();renderOrderState();
 if(state.order)$('orderMessage').textContent='当前购物车是下一张订单草稿；已付款订单与机器人任务不变。';
}
function renderCatalogue(){const found=catalogResults;$('catalogue').innerHTML=found.map(p=>{const labels=propertyLabels(p);return `<article class="product-card"><div><b>${escapeHtml(p.name)}</b><small>${escapeHtml(p.category)} → ${escapeHtml(p.subcategory)} · Instacart 商品 ID ${p.sourceId}<br>教学货架 ${p.shelfId} · 取货 (${p.point.join(', ')}) · 模拟库存 ${p.stock}/${p.capacity}<br>估算价格 $${p.priceUsd?.toFixed(2)??'—'}（${labels.price}）；估算重量 ${p.weightG?.toFixed(0)??'—'}g（${labels.weight}）<br>热量 ${p.calories100g==null?'不适用':`${p.calories100g.toFixed(0)} kcal/100g（${labels.calorie}）`}<br>train 购买频次 ${(p.frequency??0).toLocaleString()} 次；复购记录比例 ${p.reorderRate==null?'无记录':`${(p.reorderRate*100).toFixed(1)}%`}</small></div><div class="product-buy"><span>${money(p.price)}（教学汇率换算） · ${kg(p.weight)}</span><button type="button" data-add="${p.id}" ${p.stock?'':'disabled'}>${p.stock?'加入购物车':'暂时缺货'}</button></div></article>`;}).join('')||'<p class="empty-note">未找到匹配商品。请试英文商品名或调整分类。</p>';}
function renderCart(){const lines=cartLines();$('cartList').innerHTML=lines.length?lines.map(({product:p,qty})=>`<div class="cart-line"><div><b>${escapeHtml(p.name)} × ${qty}</b><small>货架 ${p.shelfId} · ${money(p.price*qty)} · ${kg(p.weight*qty)} · ${p.sourceId?'价格／重量估算，货架教学映射':'教学压力测试商品'}</small></div><div><button type="button" aria-label="减少${escapeHtml(p.name)}" data-minus="${p.id}">−</button><button type="button" aria-label="增加${escapeHtml(p.name)}" data-plus="${p.id}">＋</button></div></div>`).join(''):'<p class="empty-note">购物车为空。可先点「装入真实商品示例订单」。</p>';$('cartSummary').textContent=`共 ${lines.reduce((n,x)=>n+x.qty,0)} 件 · ${money(cartPrice())} · ${kg(cartWeight())}`;$('submitOrderBtn').disabled=!lines.length;}
const originalRenderCart=renderCart;
renderCart=function(){originalRenderCart();const lines=cartLines(),shortage=lines.some(x=>x.qty>x.product.stock);$('submitOrderBtn').disabled=!lines.length||cartPrice()<MIN_ORDER||shortage;$('minimumNotice').textContent=shortage?'商品库存不足，系统已提前通知员工。请减量或等待补货。':cartPrice()<MIN_ORDER?`还差 ${money(MIN_ORDER-cartPrice())} 达到机器人起购金额 ${money(MIN_ORDER)}。`:`已达到 ${money(MIN_ORDER)} 起购金额。`;};
function renderInventory(){const alerts=[...productById.values()].filter(p=>p.stock/p.capacity<.1);$('inventoryAlerts').innerHTML=alerts.length?alerts.map(p=>`<div class="inventory-alert"><span><b>${escapeHtml(p.name)}</b> · ${p.stock}/${p.capacity} 件 · ${p.stock?'低库存已通知':'缺货已提前通知'} · ${p.sourceId?'真实商品的模拟库存':'教学压力测试商品'}</span><button type="button" data-restock="${p.id}">员工确认补货</button></div>`).join(''):'<p>当前没有低于 10% 的商品。</p>';renderCatalogue();renderCart();}
function restock(id){const p=productById.get(id);if(!p)return;p.stock=p.capacity;log(`员工已确认 ${p.name} 补货至 ${p.capacity} 件（教学模拟）。`);renderInventory();}
let rules=[];
function ruleMetrics(r){return `支持度 ${(r.support*100).toFixed(3)}% · 置信度 ${(r.confidence*100).toFixed(1)}% · 提升度 ${r.lift.toFixed(2)}`;}
function renderRules(){if(!research)return;$('miningMethod').textContent=`真实 train 购物篮 ${research.rules.baskets.toLocaleString()} 篮，Apriori 二项频繁集：${research.rules.ruleCount.toLocaleString()} 条规则；候选商品 ${research.rules.candidateProducts} 件，最小共购 ${research.rules.minSupportCount} 篮。关联不代表因果。`;$('ruleTable').innerHTML=rules.filter(r=>r.confidence>=.15).slice(0,5).map(r=>`<div class="rule-row"><b>${escapeHtml(productById.get(r.from)?.name)} → ${escapeHtml(productById.get(r.to)?.name)}</b><small>${ruleMetrics(r)}</small></div>`).join('');const seenPairs=new Set();const suggestions=rules.filter(r=>{const pair=[r.from,r.to].sort().join('|');if(r.lift<=1||r.confidence<.15||seenPairs.has(pair))return false;seenPairs.add(pair);return true;}).slice(0,5).map(r=>{const a=productById.get(r.from),b=productById.get(r.to);return `<li>${escapeHtml(a.name)} 与 ${escapeHtml(b.name)}：可考虑邻近陈列，须另外核对冷链、食品与日化分隔及通道宽度。</li>`;});$('shelfSuggestions').innerHTML=`<p class="assumption">真实共购计算，布局建议仍需人工审查。</p><ul>${suggestions.join('')}</ul>`;}
function renderRecommendations(){const ids=new Set(cartLines().map(x=>x.product.id));const found=rules.filter(r=>ids.has(r.from)&&!ids.has(r.to)&&r.confidence>=.1).slice(0,3);$('recommendations').innerHTML=found.length?found.map(r=>`<div class="recommend-item"><div><b>${escapeHtml(productById.get(r.to).name)}</b><small>${escapeHtml(productById.get(r.from).name)} 的真实 train 共购；${ruleMetrics(r)}</small></div><button type="button" data-add="${r.to}">加入</button></div>`).join(''):'<p class="empty-note">将高频商品加入购物车后，可查看真实 train 购物篮计算的关联推荐；低频商品可能没有规则。</p>';}
function renderCrowd(){const sample=crowdSamples[state.slot],sum=sample.reduce((a,b)=>a+b,0);$('crowdSummary').textContent=`${timeSlots.find(x=>x.id===state.slot).label}：18 个货架附近共 ${sum} 人（教学样本）；0–2 人较低，3–4 人中等，5 人及以上较拥挤。`;$('crowdTable').innerHTML=shelves.map((s,i)=>`<div class="crowd-cell ${sample[i]>=5?'hot':sample[i]>=3?'warm':'cool'}"><b>${s.category}</b><small>${s.id} · ${sample[i]} 人</small></div>`).join('');scene3d?.setScenario(state.scenario,state.slot);}
function renderQueue(){
 const active=state.order;
 const entries=[...(active?[{order:active,label:state.awaitingPickup?'待顾客出口取货':state.running?'机器人购物中':state.shortage?'等待缺货确认':'当前待执行'}]:[]),...state.queue.map((order,i)=>({order,label:`排队第 ${i+1} 位`}))];
 $('orderQueue').innerHTML=entries.length?entries.map(({order,label})=>`<li><b>${order.id}</b><span>${label} · ${order.lines.reduce((n,x)=>n+x.qty,0)} 件</span>${order===active&&state.stage===0&&!state.running&&state.elapsed===0?'<button type="button" data-cancel-active="1">取消当前待执行订单</button>':order!==active?`<button type="button" data-cancel="${order.id}">取消排队</button>`:''}</li>`).join(''):'<li>暂无待处理订单</li>';
 if(state.completed.length)$('orderQueue').innerHTML+=state.completed.slice(-3).map(x=>`<li class="queue-done"><b>${x.id}</b><span>${x.status}</span></li>`).join('');
}
function renderStockout(){
 const select=$('stockoutSelect'),old=state.stockoutId;
 select.innerHTML='<option value="">不模拟缺货</option>'+(state.order?.lines||[]).map(x=>`<option value="${x.product.id}">${escapeHtml(x.product.name)} · 货架 ${x.product.shelfId}</option>`).join('');
 select.value=old&&state.order?.lines.some(x=>x.product.id===old)?old:'';
 select.disabled=!state.order||state.running||state.stage>0||state.awaitingPickup||!!state.shortage;
 $('stockoutPanel').hidden=!state.shortage;
 $('assistPanel').hidden=!state.assistPending;
 $('handoffPanel').hidden=!state.awaitingPickup;
 if(state.shortage){
  const {line,alternative}=state.shortage;
  $('stockoutDetail').textContent=`${line.product.name} × ${line.qty} 在货架 ${line.product.shelfId} 缺货。${alternative?`候选：${alternative.name} × ${line.qty}，${money(alternative.price*line.qty)}、${kg(alternative.weight*line.qty)}；须顾客确认。`:'没有预设的同类替代商品；可选择跳过。'} 模拟付款差额只显示，不处理真实补款或退款。`;
  $('acceptSubBtn').disabled=!alternative;
 }
 if(state.assistPending)$('assistDetail').textContent=`货架 ${state.assistPending.stop.shelfId}：${state.assistPending.names.join('、')} 需要员工核对实物并协助取货。网页未模拟真实抓取、条码识别或冷链设备。`;
 if(state.awaitingPickup){
  const code=state.order.id.slice(-4),count=state.bought.reduce((n,x)=>n+x.qty,0);
  $('handoffDetail').textContent=`机器人已到另一出口。请按订单 ${state.order.id}（演示取货码 ${code}）核对 ${count} 件实际商品；最终模拟金额 ${money(actualPrice())}。顾客确认取货后，队列才处理下一单。`;
 }
}
function renderOrderState(){
 $('orderListHeading').textContent=state.order?`${state.order.id} · ${state.order.lines.reduce((n,x)=>n+x.qty,0)} 件`:'等待顾客下单';
 $('shoppingList').innerHTML=state.order?state.order.lines.map(x=>{
  const resolution=state.resolutions.get(x.product.id),actual=resolution?.kind==='accept'?resolution.replacement:x.product;
  const bought=state.bought.some(b=>b.product.id===actual.id),skipped=resolution?.kind==='skip';
  return `<li class="${bought?'is-bought':''}"><span class="item-check">${bought?'✓':skipped?'—':''}</span><span class="item-name">${escapeHtml(x.product.name)} × ${x.qty}<small> · ${skipped?'缺货跳过':resolution?.kind==='accept'?`替代为 ${escapeHtml(actual.name)}`:`货架 ${x.product.shelfId}`}</small></span><span class="item-meta">${skipped?'未购买':kg(actual.weight*x.qty)}</span></li>`;
 }).join(''):'<li>请先在上方选择商品并完成教学模拟付款。</li>';
 const loaded=state.bought.reduce((n,x)=>n+x.product.weight*x.qty,0);
 $('loadText').textContent=`${kg(loaded)} / ${kg(CAPACITY)}`;
 $('loadFill').style.width=`${Math.min(100,loaded/CAPACITY*100)}%`;
 $('capacityWarning').hidden=!(state.order&&orderWeight()>CAPACITY);
 $('overloadBtn').setAttribute('aria-pressed',state.cart.has(products.find(p=>p.name==='饮料箱').id));
 renderQueue();renderStockout();
}
function populateFilters(){if(catalogIndex){$('categoryFilter').innerHTML='<option value="">全部部门</option>'+catalogIndex.departments.map(x=>`<option value="${x.id}">${escapeHtml(x.name)} (${x.count})</option>`).join('');updateSubcategories();}$('timeSlot').innerHTML=timeSlots.map(x=>`<option value="${x.id}">${x.label}</option>`).join('');}
function updateSubcategories(){if(!catalogIndex)return;const dept=$('categoryFilter').value,aisles=catalogIndex.aisles.filter(x=>!dept||x.departmentId===Number(dept));$('subcategoryFilter').innerHTML='<option value="">全部 aisle</option>'+aisles.map(x=>`<option value="${x.id}">${escapeHtml(x.name)}</option>`).join('');scheduleCatalogSearch();}
function scheduleCatalogSearch(){if(!catalogIndex)return;clearTimeout(catalogTimer);const request=++catalogRequest,query=$('productSearch').value,dept=$('categoryFilter').value,aisle=$('subcategoryFilter').value;if(!query&&!dept&&!aisle){catalogResults=catalogSeed.top.slice(0,36).map(row=>productById.get(`I${row.id}`));renderCatalogue();return;}$('catalogue').innerHTML='<p class="empty-note">正在搜索真实商品数据…</p>';catalogTimer=setTimeout(async()=>{try{const rows=await searchCatalog(catalogIndex,query,dept,aisle);if(request!==catalogRequest)return;catalogResults=rows.map(row=>{const id=`I${row.id}`;if(!productById.has(id))productById.set(id,convertProduct(row));return productById.get(id);});renderCatalogue();}catch(error){if(request===catalogRequest)$('catalogue').textContent=`商品数据载入失败：${error.message}`;}},250);}
function graph(){const nodes=new Map();function edge(a,b){for(const p of [a,b])if(!nodes.has(key(p)))nodes.set(key(p),{point:p,neighbors:[]});nodes.get(key(a)).neighbors.push(key(b));nodes.get(key(b)).neighbors.push(key(a));}const bottom=[5,...STORE.aisleXs,130,138];for(let i=1;i<bottom.length;i++)edge([bottom[i-1],8],[bottom[i],8]);for(const y of STORE.crossYs.slice(1))for(let i=1;i<STORE.aisleXs.length;i++)edge([STORE.aisleXs[i-1],y],[STORE.aisleXs[i],y]);for(const x of STORE.aisleXs)for(let i=1;i<STORE.verticalYs.length;i++)edge([x,STORE.verticalYs[i-1]],[x,STORE.verticalYs[i]]);return nodes;}
const nodes=graph();
function edgeCost(a,b,scenario,slot,mode='full'){const length=dist(a,b),center=[(a[0]+b[0])/2,(a[1]+b[1])/2];const nearby=shelves.filter(s=>dist(s.point,center)<20).map(s=>shelfCrowd(slot,s.id));const crowd=nearby.length?nearby.reduce((n,x)=>n+x,0)/nearby.length:0;const hot=scenario==='peak'&&a[1]===34&&b[1]===34&&Math.min(a[0],b[0])>=40&&Math.max(a[0],b[0])<=80;const predictedTime=length*(1+.025*crowd+(hot?2.6:0));const risk=length*(.025*crowd+(hot?2.8:0));const cost=mode==='distance'?length:mode==='time'?length+.45*predictedTime:length+.45*predictedTime+1.3*risk;return {length,predictedTime,risk,cost};}
function astar(start,finish,scenario,slot,mode='full'){const open=new Set([key(start)]),came=new Map(),g=new Map([[key(start),0]]),f=new Map([[key(start),dist(start,finish)]]);while(open.size){let current=[...open].reduce((a,b)=>(f.get(a)??Infinity)<=(f.get(b)??Infinity)?a:b);if(current===key(finish)){const points=[nodes.get(current).point];while(came.has(current)){current=came.get(current);points.unshift(nodes.get(current).point);}return points;}open.delete(current);for(const n of nodes.get(current).neighbors){const score=g.get(current)+edgeCost(nodes.get(current).point,nodes.get(n).point,scenario,slot,mode).cost;if(score<(g.get(n)??Infinity)){came.set(n,current);g.set(n,score);f.set(n,score+dist(nodes.get(n).point,finish));open.add(n);}}}return null;}
function avoidPeople(points,scenario,slot){const obstacles=getObstacleSnapshot(scenario,slot).map(x=>x.point);const out=[points[0]];for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=dist(a,b),horizontal=a[1]===b[1],direction=Math.sign(horizontal?b[0]-a[0]:b[1]-a[1]);const near=obstacles.map(p=>({along:(horizontal?p[0]-a[0]:p[1]-a[1])*direction,side:horizontal?p[1]-a[1]:p[0]-a[0]})).filter(p=>p.along>3.2&&p.along<length-3.2&&Math.abs(p.side)<2.2).sort((x,y)=>x.along-y.along);let last=0;for(const p of near){if(p.along-3<last)continue;const side=p.side>=0?-2:2;const pt=(d,s)=>horizontal?[a[0]+direction*d,a[1]+s]:[a[0]+s,a[1]+direction*d];out.push(pt(p.along-3,0),pt(p.along-1.5,side),pt(p.along+1.5,side),pt(p.along+3,0));last=p.along+3;}out.push(b);}return out;}
function planLeg(a,b,scenario,slot,mode='full'){const base=astar(a,b,scenario,slot,mode);if(!base)return null;const points=avoidPeople(base,scenario,slot),lengths=points.slice(1).map((p,i)=>dist(points[i],p));let cost=0,time=0,risk=0;for(let i=1;i<base.length;i++){const c=edgeCost(base[i-1],base[i],scenario,slot,mode);cost+=c.cost;time+=c.predictedTime;risk+=c.risk;}return {points,lengths,length:lengths.reduce((a,b)=>a+b,0),cost,time,risk};}
function uniqueStops(lines){const map=new Map();for(const line of lines){const s=map.get(line.product.shelfId)||{shelfId:line.product.shelfId,point:line.product.point,lines:[]};s.lines.push(line);map.set(s.shelfId,s);}return [...map.values()];}
function buildPlan(lines,scenario,slot,mode='full'){
 const stops=uniqueStops(lines),n=stops.length,cache=new Map();
 const leg=(a,b)=>{const k=`${key(a)}>${key(b)}`;if(!cache.has(k))cache.set(k,planLeg(a,b,scenario,slot,mode));return cache.get(k);};
 const finish=leg(STORE.checkout,STORE.exit);
 if(!finish)return null;
 const start=stops.map(s=>leg(STORE.entrance,s.point));
 const checkout=stops.map(s=>leg(s.point,STORE.checkout));
 const between=stops.map((a,i)=>stops.map((b,j)=>i===j?null:leg(a.point,b.point)));
 const order=[];let bestCost=Infinity,method='Held-Karp 精确访问顺序';
 if(n>12){
  // 13–18 个货架时避免在浏览器运行指数级动态规划；如实标明启发式结果。
  method='最近安全代价启发式访问顺序（不保证全局最优）';
  const remaining=new Set(stops.map((_,i)=>i));let previousStop=-1;
  while(remaining.size){let choice=-1,score=Infinity;for(const j of remaining){const candidate=previousStop<0?start[j]:between[previousStop][j];if(candidate&&candidate.cost<score){score=candidate.cost;choice=j;}}if(choice<0)return null;order.push(choice);remaining.delete(choice);previousStop=choice;}
  bestCost=start[order[0]].cost+order.slice(1).reduce((sum,j,i)=>sum+between[order[i]][j].cost,0)+checkout[order.at(-1)].cost+finish.cost;
 }else{
  // Held-Karp：枚举已访问货架集合，选入口到结账的最低代价顺序。
  const states=1<<n,all=states-1,costs=new Float64Array(states*n),previous=new Int8Array(states*n);
  costs.fill(Infinity);previous.fill(-1);
  for(let j=0;j<n;j++)if(start[j])costs[(1<<j)*n+j]=start[j].cost;
  for(let mask=1;mask<states;mask++)for(let bits=mask;bits;bits&=bits-1){
   const j=31-Math.clz32(bits&-bits),current=costs[mask*n+j];
   if(!Number.isFinite(current))continue;
   for(let remaining=all^mask;remaining;remaining&=remaining-1){
    const k=31-Math.clz32(remaining&-remaining),step=between[j][k];
    if(!step)continue;
    const index=((mask|(1<<k))*n+k),next=current+step.cost;
    if(next<costs[index]){costs[index]=next;previous[index]=j;}
   }
  }
  let last=-1;
  for(let j=0;j<n;j++)if(checkout[j]){const total=costs[all*n+j]+checkout[j].cost+finish.cost;if(total<bestCost){bestCost=total;last=j;}}
  if(last<0)return null;
  let mask=all;
  while(last>=0){order.unshift(last);const parent=previous[mask*n+last];mask^=1<<last;last=parent;}
 }
 const orderedStops=order.map(i=>stops[i]);
 const legs=[start[order[0]],...order.slice(1).map((j,i)=>between[order[i]][j]),checkout[order.at(-1)],finish];
 const best={stops:orderedStops,legs,cost:bestCost,method};
 best.points=legs.flatMap((l,i)=>i?l.points.slice(1):l.points);
 best.length=legs.reduce((sum,l)=>sum+l.length,0);
 best.time=legs.reduce((sum,l)=>sum+l.time,0)+n*3+5;
 best.risk=legs.reduce((sum,l)=>sum+l.risk,0);
 return best;
}
function drawBaseMap(){for(const x of STORE.aisleXs)svg('line',{x1:x*10,y1:820,x2:x*10,y2:80,class:'aisle-line'},$('aisles'));for(const y of STORE.crossYs)svg('line',{x1:50,y1:(90-y)*10,x2:1380,y2:(90-y)*10,class:'aisle-line'},$('aisles'));for(const s of shelves){const left=s.xMin*10,top=(90-s.yMax)*10,width=(s.xMax-s.xMin)*10,height=(s.yMax-s.yMin)*10;svg('rect',{x:left,y:top,width,height,rx:11,class:'shelf-rect'},$('shelves'));svg('text',{x:left+width/2,y:top+height/2-8,class:'shelf-caption'},$('shelves')).textContent=s.category;svg('text',{x:left+width/2,y:top+height/2+17,class:'shelf-code'},$('shelves')).textContent=`货架 ${s.id}`;}}
function drawFixtures(){for(const f of layoutFixtures){svg('rect',{x:(f.x-f.w/2)*10,y:(STORE.height-f.y-f.h/2)*10,width:f.w*10,height:f.h*10,rx:8,class:'fixture-'+f.kind},$('fixtures'));svg('text',{x:f.x*10,y:(STORE.height-f.y)*10+4,class:'fixture-label'},$('fixtures')).textContent=f.label;}}
function drawGate(point,label){svg('rect',{x:point[0]*10-28,y:(90-point[1])*10-14,width:56,height:28,rx:9,class:'gate'},$('destinations'));svg('text',{x:point[0]*10,y:(90-point[1])*10+4,class:'gate-label'},$('destinations')).textContent=label;}
function drawDestinations(){clear($('destinations'));const stops=state.plan?.stops||[];stops.forEach((s,i)=>{svg('circle',{cx:s.point[0]*10,cy:(90-s.point[1])*10,r:15,class:`destination-circle ${i<state.stage?'destination-done':''}`},$('destinations'));svg('text',{x:s.point[0]*10,y:(90-s.point[1])*10+4,class:'destination-label'},$('destinations')).textContent=i<state.stage?'✓':i+1;});drawGate(STORE.entrance,'入口');drawGate(STORE.checkout,'结账');drawGate(STORE.exit,'出口');scene3d.setPickups(stops.map(s=>s.point),Math.min(state.stage,stops.length));}
function drawPeople(delta=0){
 const group=$('movingPeople'),targets=peopleForScenario(state.scenario,state.slot,state.crowdClock);
 const positions=targets.map(person=>{
  const previous=state.people.get(person.id)||person.point;
  const distance=dist(previous,person.point),step=delta>0?Math.min(1,delta*3/Math.max(distance,.001)):0;
  let point=[previous[0]+(person.point[0]-previous[0])*step,previous[1]+(person.point[1]-previous[1])*step];
  // 行人接近机器人时沿原通道让开，避免双方同时停车造成死锁。
  if(dist(point,state.position)<7){
   point=[...previous];
   if(dist(previous,state.position)<7){
    const axis=person.id==='H2'||person.id==='H3'?0:1;
    const direction=Math.sign(previous[axis]-state.position[axis])||1;
    point[axis]+=direction*delta*3;
   }
  }
  state.people.set(person.id,point);
  return {...person,point};
 });
 state.visiblePeople=positions;
 if(group.children.length!==positions.length*2){clear(group);for(const p of positions){svg('circle',{r:13,class:'crowd-halo','data-person-id':p.id},group);svg('circle',{r:7,class:'crowd-person','data-person-id':p.id},group);}}
 positions.forEach((p,i)=>{for(const circle of [group.children[i*2],group.children[i*2+1]]){circle.setAttribute('cx',p.point[0]*10);circle.setAttribute('cy',(90-p.point[1])*10);circle.setAttribute('data-person-id',p.id);}});
 scene3d.setPeople(positions);
}
function drawCrowd(){clear($('crowd'));const counts=crowdSamples[state.slot];shelves.forEach((s,i)=>{const color=counts[i]>=5?'#ea7351':counts[i]>=3?'#efbc62':'#80bd91';svg('rect',{x:s.xMin*10,y:(90-s.yMax)*10,width:(s.xMax-s.xMin)*10,height:(s.yMax-s.yMin)*10,fill:color,opacity:counts[i]>=5?.38:.2,rx:11},$('crowd'));});scene3d.setScenario(state.scenario,state.slot);drawPeople();}
function drawRoutes(){clear($('comparisonRoute'));clear($('plannedRoute'));if(state.plan){if(state.scenario==='peak'&&state.normalPlan)svg('path',{d:pathData(state.normalPlan.points),class:'comparison-path'},$('comparisonRoute'));svg('path',{d:pathData(state.plan.points),class:'planned-path'},$('plannedRoute'));}scene3d.setRoutes(state.plan?.points||[],state.scenario==='peak'?state.normalPlan?.points:null);drawHistory();}
function drawHistory(){clear($('traveledRoute'));if(state.history.length>1)svg('path',{d:pathData(state.history),class:'traveled-path'},$('traveledRoute'));scene3d.setHistory(state.history);}
function drawRobot(){clear($('robotLayer'));const [x,y]=state.position;svg('circle',{cx:x*10,cy:(90-y)*10,r:23,class:'robot-body'},$('robotLayer'));scene3d.setRobot(state.position);}
function nextName(){if(state.awaitingPickup)return '另一出口交接';if(!state.plan)return '等待订单';if(state.stage<state.plan.stops.length)return state.plan.stops[state.stage].lines.map(x=>x.product.name).join('、');return state.stage===state.plan.stops.length?'结账处':'另一出口';}
function renderProgress(){
 const done=state.plan?.legs.slice(0,state.stage).reduce((n,l)=>n+l.length,0)||0;
 const percent=state.awaitingPickup?100:state.plan?Math.min(100,Math.round((done+state.legDistance)/state.plan.length*100)):0;
 $('progressFill').style.width=`${percent}%`;$('progressPercent').textContent=`${percent}%`;
 $('progressText').textContent=state.awaitingPickup?'等待顾客出口取货':state.shortage?'等待顾客确认缺货替代':state.running?`前往${nextName()}`:state.order?'等待播放 / 已暂停':'等待付款订单';
 $('nextTarget').textContent=`下一站：${nextName()}`;
}
function renderTimeline(){
 const steps=['读取已付款订单','检查载重并从入口进入','规划货架访问顺序与 A* 路径',...((state.plan?.stops||[]).map(s=>`到货架 ${s.shelfId} 核对并取货`)),'结账核对','从另一出口离开','顾客在出口核对并取货'];
 const active=Math.min(3+state.stage,steps.length-1);
 $('timeline').innerHTML=steps.map((step,i)=>`<li class="${!state.order?'':i<active?'is-done':i===active?'is-active':''}">${step}</li>`).join('');
}
function scoreExistingRoute(plan,scenario,slot){
 let cost=0,time=0,risk=0;
 for(const leg of plan.legs){
  const graphPoints=leg.points.filter(point=>nodes.has(key(point)));
  for(let i=1;i<graphPoints.length;i++){
   const edge=edgeCost(graphPoints[i-1],graphPoints[i],scenario,slot);
   cost+=edge.cost;time+=edge.predictedTime;risk+=edge.risk;
  }
 }
 return {...plan,cost,time:time+plan.stops.length*3+5,risk};
}
function renderComparison(){
 if(!state.order){$('comparisonBody').innerHTML='<tr><td colspan="3">付款后按当前订单计算</td></tr>';$('comparisonInsight').textContent='原路线与新路线均使用同一订单和时段；请先提交订单。';$('routeReason').textContent='付款后显示按订单计算的货架访问顺序和路径代价。';return;}
 const a=scoreExistingRoute(state.normalPlan,state.scenario,state.slot),b=state.plan,changed=a.points.map(key).join('|')!==b.points.map(key).join('|');
 $('routeReason').textContent=`访问顺序：入口 → ${b.stops.map(s=>`货架 ${s.shelfId}`).join(' → ')} → 结账 → 出口。${b.method}；逐段 A* 选路；当前综合代价 ${b.cost.toFixed(1)}（教学演示假设）。`;
 const rows=[['路线长度',`${a.length.toFixed(1)} 地图单位`,`${b.length.toFixed(1)} 地图单位`],['预计通行与取货时间',`${a.time.toFixed(1)} 演示秒`,`${b.time.toFixed(1)} 演示秒`],['安全风险值',a.risk.toFixed(1),b.risk.toFixed(1)],['综合路径代价',a.cost.toFixed(1),b.cost.toFixed(1)],['改道次数','0 次',changed?'1 次':'0 次']];
 $('comparisonBody').innerHTML=rows.map(row=>`<tr>${row.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('');
 $('comparisonInsight').textContent=`同一订单、${timeSlots.find(x=>x.id===state.slot).label} 教学样本，原路线也按当前客流重新评估：新路线比原路线${b.length>=a.length?'长':'短'} ${Math.abs(b.length-a.length).toFixed(1)} 地图单位，风险值${b.risk<=a.risk?'降低':'增加'} ${Math.abs(b.risk-a.risk).toFixed(1)}。${changed?'因当前人流风险重新规划。':'当前场景无需改道。'}代价 = 距离 + 0.45 × 预计时间 + 1.3 × 安全风险；数字均为教学演示假设，动画已加速。`;
}
function runBenchmark(){
 if(!state.order){$('benchmarkResult').textContent='请先完成教学模拟付款，再比较同一订单。';return;}
 const modes=[['仅距离','distance'],['距离＋时间','time'],['距离＋时间＋风险','full']];
 const rows=modes.map(([label,mode])=>{const plan=buildPlan(state.order.lines,state.scenario,state.slot,mode);return {label,score:plan&&scoreExistingRoute(plan,state.scenario,state.slot)};});
 if(rows.some(x=>!x.score)){$('benchmarkResult').textContent='当前地图无可比较的候选路线。';return;}
 const body=rows.map(({label,score})=>`<tr><td>${label}</td><td>${score.length.toFixed(1)}</td><td>${score.time.toFixed(1)}</td><td>${score.risk.toFixed(1)}</td></tr>`).join('');
 let checked=0,safer=0;
 for(const scenario of ['normal','peak'])for(const slot of timeSlots.map(x=>x.id)){const baseline=buildPlan(state.order.lines,scenario,slot,'distance'),full=buildPlan(state.order.lines,scenario,slot,'full');if(baseline&&full){checked++;if(full.risk<scoreExistingRoute(baseline,scenario,slot).risk)safer++;}}
 $('benchmarkResult').innerHTML=`<table><thead><tr><th>规划输入</th><th>长度</th><th>演示秒</th><th>风险值</th></tr></thead><tbody>${body}</tbody></table><p>以上三条候选路线均按当前同一场景评分；在 ${checked} 个固定教学场景中，完整成本的风险值低于仅距离基线 ${safer} 次。数字为教学样本计算，未进行随机重复实验。</p>`;
}
function renderDataAudit(){
 const counts=crowdSamples[state.slot],base=crowdSamples['09'],changed=counts.filter((n,i)=>Math.abs(n-base[i])>=3).length;
 $('dataAudit').textContent=research?`已提供清洗数据：${research.summary.products.toLocaleString()} 件商品、${research.summary.orders.toLocaleString()} 张订单、${research.summary.basketOrders.toLocaleString()} 张 train 购物篮。数据清洗前删除量无法从清洗文件反推；详情见上方数据质量工作台。`:'正在读取真实数据统计。';
 $('driftAudit').textContent=`当前 ${timeSlots.find(x=>x.id===state.slot).label} 与 09:00 基线相比，${changed}/${shelves.length} 个货架人数变化至少 3 人（教学预警阈值）。这提示重新采样，不代表真实模型发生漂移。`;
}
function renderPickupFeasibility(){const lines=state.order?.lines||['苹果','鲜虾','冷冻水饺','饮料箱'].map(name=>({product:products.find(p=>p.name===name),qty:1}));$('pickupFeasibility').innerHTML=`<ul>${lines.map(({product:p})=>`<li>${escapeHtml(p.name)}：${pickupProfile(p).label}</li>`).join('')}</ul>`;}
const faultAdvice={sensor:'传感器数据不可用：停车，员工检查传感器后恢复。',localization:'定位丢失：停车，重新定位并确认货架地图后恢复。',network:'订单网络中断：停车，核对本地订单与服务端状态后恢复。',battery:'电量不足：停车，由员工处理充电或接管订单。',wrongItem:'商品核对不一致：停车，员工复核名称与条码后恢复。'};
function renderFaultState(){$('faultState').textContent=state.fault?faultAdvice[state.fault]:'当前无故障。';$('suddenPersonBtn').setAttribute('aria-pressed',state.suddenPerson);$('suddenPersonBtn').textContent=state.suddenPerson?'行人已离开，解除安全停车':'模拟行人突然靠近';}
function setFault(active){state.fault=active?$('faultSelect').value:'';state.running=false;state.lastFrame=0;renderFaultState();if(active){status('故障安全停车',faultAdvice[state.fault],'等待人工排查');log(`故障演练：${faultAdvice[state.fault]}`);}else{status('故障已排查','请点击播放，从当前位置继续当前订单。','待机');log('员工已完成故障排查；机器人等待继续指令。');}renderScene();}
function toggleSuddenPerson(){state.suddenPerson=!state.suddenPerson;renderFaultState();if(state.suddenPerson){state.running=false;state.lastFrame=0;status('突发行人：安全停车','独立近距安全层阻止机器人继续移动。','安全停车');log('独立安全层：模拟行人突然靠近，立即停车。');}else{status('行人已离开','请点击播放，重新确认安全路线后继续。','待机');log('模拟行人已离开，等待继续指令。');}renderScene();}
function renderScene(){drawCrowd();drawRoutes();drawDestinations();drawRobot();renderOrderState();renderProgress();renderTimeline();renderPickupFeasibility();renderDataAudit();renderFaultState();$('normalBtn').setAttribute('aria-pressed',state.scenario==='normal');$('peakBtn').setAttribute('aria-pressed',state.scenario==='peak');$('safetyTestBtn').setAttribute('aria-pressed',state.blocked);$('safetyTestBtn').textContent=state.blocked?'解除封闭并继续':'模拟全部通道封闭';$('mapSituation').textContent=state.fault?'故障安全停车：等待人工排查':state.suddenPerson?'突发行人：独立安全层停车':state.blocked?'全部通道封闭：机器人安全停车等待':!state.order?'等待顾客教学模拟付款并下单':state.scenario==='peak'?'中部通道风险升高：显示原路线与重规划路线':'按照订单与当前客流选择最低安全代价路线';}
function resetPlayback(preserveSafety=false){
 const fault=state.fault,suddenPerson=state.suddenPerson;
 state.running=false;state.finished=false;state.awaitingPickup=false;state.shortage=null;state.resolutions=new Map();state.assistPending=null;state.assistedShelves=new Set();state.blocked=false;state.suddenPerson=preserveSafety&&suddenPerson;state.fault=preserveSafety?fault:'';state.stage=0;state.legDistance=0;state.pauseLeft=0;state.slowLeft=0;state.elapsed=0;state.crowdClock=0;state.lastFrame=0;state.bought=[];state.position=[...STORE.entrance];state.history=[[...STORE.entrance]];state.people=new Map();state.visiblePeople=[];state.detected=new Set();state.avoidanceId='';
 state.plan=state.order?buildPlan(state.order.lines,state.scenario,state.slot):null;
 state.normalPlan=state.order?buildPlan(state.order.lines,'normal',state.slot):null;
 $('playLabel').textContent='播放购物流程';$('playBtn').firstElementChild.textContent='▶';
 status(state.order?'已读取付款订单':'等待顾客下单',state.order?'订单已收到。点击播放，先检查载重再从入口出发。':'请先选择商品并完成教学模拟付款。','待机');
 if(state.fault)status('故障安全停车',faultAdvice[state.fault],'等待人工排查');
 else if(state.suddenPerson)status('突发行人：安全停车','独立近距安全层阻止机器人继续移动。','安全停车');
 renderScene();renderComparison();
}
function actualPrice(){return state.bought.reduce((n,x)=>n+x.product.price*x.qty,0);}
function activateNext(){
 state.order=state.queue.shift()||null;state.stockoutId='';resetPlayback();$('benchmarkResult').textContent=state.order?'订单已改变，请点击计算当前订单对照。':'请先模拟付款，再点击计算。';
 if(state.order){log(`队列轮到 ${state.order.id}：机器人读取已付款订单。`);if(orderWeight()>CAPACITY)status('无法出发：订单超载',`订单 ${kg(orderWeight())} 超过 ${kg(CAPACITY)} 上限；可取消当前待执行订单并重新下单。`,'超载');}
}
function submitOrder(){
 const lines=cartLines();if(!lines.length||cartPrice()<MIN_ORDER||lines.some(x=>x.qty>x.product.stock))return;
 const id=`教学模拟订单-${String(Date.now()).slice(-7)}-${++state.orderCounter}`;
 const order={id,lines:lines.map(x=>({product:x.product,qty:x.qty})),paid:cartPrice()};
 state.queue.push(order);state.cart.clear();renderCart();renderRecommendations();
 if(!state.order)activateNext();else renderOrderState();
 $('orderMessage').textContent=`${id}：教学模拟付款成功，${money(order.paid)}；${state.order===order?'机器人已读取。':`排队第 ${state.queue.length} 位。`}无真实交易。`;
 log(`${id} 已提交；${state.order===order?'开始处理':'进入等待队列'}。`);
}
function updateScenario(){if(!state.order||state.awaitingPickup){state.people=new Map();renderCrowd();renderScene();renderComparison();return;}resetPlayback(true);$('benchmarkResult').textContent='时段或人流条件已改变，请重新计算对照。';log(`切换至${state.scenario==='peak'?'工作日高峰':'普通人流'}、${state.slot}: 重新计算候选路线。`);if(state.scenario==='peak')log('中部通道教学样本拥堵，A* 改走风险较低的通道；橙色为普通场景原路线。');}
function positionOnLeg(leg,at){let left=at;for(let i=0;i<leg.lengths.length;i++){const len=leg.lengths[i];if(left<=len||i===leg.lengths.length-1){const t=len?Math.min(1,left/len):1,a=leg.points[i],b=leg.points[i+1];return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}left-=len;}return leg.points.at(-1);}
function completeStop(stop){
 for(const line of stop.lines){
  const resolution=state.resolutions.get(line.product.id);
  if(resolution?.kind==='skip'){log(`${line.product.name} 缺货，顾客拒绝替代：跳过，最终金额将按实购计算。`);continue;}
  const actual=resolution?.kind==='accept'?resolution.replacement:line.product;
  actual.stock=Math.max(0,actual.stock-line.qty);renderInventory();
  state.bought.push({product:actual,qty:line.qty});
  log(`货架 ${stop.shelfId}：核对并取走 ${actual.name} × ${line.qty}${resolution?'（顾客同意替代）':''}。`);
 }
 state.stage++;state.pauseLeft=.6;
 const loaded=state.bought.reduce((n,x)=>n+x.product.weight*x.qty,0);
 status('已核对并取货',`当前载重 ${kg(loaded)}，准备前往下一站。`,'取货中');renderScene();
}
function requestPickupAssist(stop,wasRunning){const names=stop.lines.filter(line=>state.resolutions.get(line.product.id)?.kind!=='skip').map(line=>state.resolutions.get(line.product.id)?.replacement||line.product).filter(p=>pickupProfile(p).assist).map(p=>p.name);if(!names.length||state.assistedShelves.has(stop.shelfId))return false;state.assistPending={stop,names,wasRunning};state.running=false;status('等待员工协助取货',`${names.join('、')} 需人工核对及取货。`,'人工协助');log(`货架 ${stop.shelfId}：${names.join('、')} 需要员工协助；机器人停车。`);renderScene();return true;}
function confirmPickupAssist(){if(!state.assistPending)return;const {stop,wasRunning}=state.assistPending;state.assistedShelves.add(stop.shelfId);state.assistPending=null;log(`员工已核对并协助取货：货架 ${stop.shelfId}。`);completeStop(stop);if(wasRunning&&!state.fault&&!state.suddenPerson&&!state.blocked){state.running=true;state.lastFrame=0;$('playLabel').textContent='暂停演示';$('playBtn').firstElementChild.textContent='Ⅱ';requestAnimationFrame(animate);}}
function arrive(){
 const index=state.stage,stops=state.plan.stops;
 state.position=[...(index<stops.length?stops[index].point:index===stops.length?STORE.checkout:STORE.exit)];
 state.history.push([...state.position]);
 if(index<stops.length){
  const stop=stops[index],line=stop.lines.find(x=>(x.product.id===state.stockoutId||x.product.stock<x.qty)&&!state.resolutions.has(x.product.id));
  if(line){const candidate=substituteFor(line.product),alternative=candidate?.stock>=line.qty?candidate:null;state.shortage={line,alternative,wasRunning:state.running};state.running=false;
   status('商品缺货，等待顾客确认',`${line.product.name} 在货架 ${stop.shelfId} 缺货；机器人停车等待替代决定。`,'等待顾客确认');
   log(`${line.product.name} 缺货：已停车，绝不自动替代。`);renderScene();return;}
  if(requestPickupAssist(stop,state.running))return;
  completeStop(stop);
 }else if(index===stops.length){
  log(`结账处：核对实际购买 ${state.bought.reduce((n,x)=>n+x.qty,0)} 件，最终模拟金额 ${money(actualPrice())}，与下单金额差额仅展示。`);
  status('结账核对完成','机器人将从另一出口前往顾客取货点。','结账中');state.pauseLeft=.8;state.stage++;renderScene();
 }else{
  state.running=false;state.finished=true;state.awaitingPickup=true;state.stage++;
  log(`机器人到达另一出口：等待顾客凭演示取货码核对并取货。`);
  status('等待顾客出口取货',`订单 ${state.order.id} 已到出口，顾客确认交接后再处理下一单。`,'待交接');
  $('playLabel').textContent='等待交接';$('playBtn').firstElementChild.textContent='✓';renderScene();
 }
 if(state.order)$('orderMessage').textContent=`${state.order.id}：${state.awaitingPickup?'机器人已到出口，待顾客确认取货':'机器人购物中'}；无真实付款。`;
}
function decideSubstitution(accept){
 if(!state.shortage)return;
 const {line,alternative,wasRunning}=state.shortage;
 if(accept&&!alternative)return;
 if(accept){const skipped=[...state.resolutions].filter(([,r])=>r.kind==='skip').reduce((n,[id])=>{const original=state.order.lines.find(x=>x.product.id===id);return n+original.product.weight*original.qty;},0);const projected=orderWeight()-skipped-line.product.weight*line.qty+alternative.weight*line.qty;
  if(projected>CAPACITY){status('替代后超载',`替代后的预计载重 ${kg(projected)} 超过 ${kg(CAPACITY)}，请拒绝替代。`,'超载');return;}}
 state.resolutions.set(line.product.id,accept?{kind:'accept',replacement:alternative}:{kind:'skip'});
 log(accept?`顾客确认：${line.product.name} → ${alternative.name}，按实际商品更新金额与载重。`:`顾客拒绝替代：${line.product.name} 跳过。`);
 state.shortage=null;if(requestPickupAssist(state.plan.stops[state.stage],wasRunning))return;completeStop(state.plan.stops[state.stage]);
 if(wasRunning&&!state.fault&&!state.suddenPerson&&!state.blocked){state.running=true;state.lastFrame=0;$('playLabel').textContent='暂停演示';$('playBtn').firstElementChild.textContent='Ⅱ';renderQueue();requestAnimationFrame(animate);}
}
function confirmHandoff(){
 if(!state.awaitingPickup)return;
 const finished=state.order;
 log(`出口交接完成：顾客核对 ${finished.id} 并取货；最终模拟金额 ${money(actualPrice())}。`);
 state.completed.push({id:finished.id,status:'已交接'});state.order=null;state.awaitingPickup=false;state.stockoutId='';
 activateNext();
 $('orderMessage').textContent=state.order?`${finished.id} 已交接。下一单 ${state.order.id} 已被机器人读取，点击播放。`:`${finished.id} 已交接。队列已清空。`;
}
function cancelOrder(id){
 const index=state.queue.findIndex(x=>x.id===id);if(index<0)return;
 state.queue.splice(index,1);state.completed.push({id,status:'已取消'});renderOrderState();log(`${id} 已从等待队列取消。`);
}
function cancelActive(){
 if(!state.order||state.running||state.stage>0||state.elapsed>0||state.awaitingPickup)return;
 const id=state.order.id;state.completed.push({id,status:'已取消'});state.order=null;activateNext();log(`${id} 已取消；机器人读取下一张排队订单。`);
}
function distanceToSegment(point,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy,t=length2?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length2)):0;return dist(point,[a[0]+dx*t,a[1]+dy*t]);}
function movementIsSafe(from,to,obstacles){
 if(to[0]<2||to[0]>138||to[1]<5||to[1]>84)return false;
 for(const shelf of shelves){
  const steps=Math.max(1,Math.ceil(dist(from,to)/.5));
  for(let i=0;i<=steps;i++){const x=from[0]+(to[0]-from[0])*i/steps,y=from[1]+(to[1]-from[1])*i/steps;
   if(x>shelf.xMin-1.1&&x<shelf.xMax+1.1&&y>shelf.yMin-1.1&&y<shelf.yMax+1.1)return false;}
 }
 return obstacles.every(o=>distanceToSegment(o.point,from,to)>=(o.type==='cart'?3.2:3));
}
function safeNextMove(leg,advance,obstacles){
 const from=state.position,progress=Math.min(leg.length,state.legDistance+advance),base=positionOnLeg(leg,progress);
 if(movementIsSafe(from,base,obstacles))return {point:base,progress,kind:'route'};
 const before=positionOnLeg(leg,state.legDistance),after=positionOnLeg(leg,Math.min(leg.length,progress+1));
 const dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)||1,normal=[-dy/length,dx/length];
 if(leg.length-progress>3.5){
  for(const side of [1,-1]){const point=[base[0]+normal[0]*side*3.5,base[1]+normal[1]*side*3.5];
   if(movementIsSafe(from,point,obstacles))return {point,progress,kind:'detour'};}
 }
 for(const side of [1,-1]){const point=[from[0]+normal[0]*side*Math.min(advance,1),from[1]+normal[1]*side*Math.min(advance,1)];
  if(dist(point,before)<=3.8&&movementIsSafe(from,point,obstacles))return {point,progress:state.legDistance,kind:'sidestep'};}
 return null;
}
function animate(now){
 if(!state.running)return;
 if(!state.lastFrame)state.lastFrame=now;
 const delta=Math.min((now-state.lastFrame)/1000,.08);
 state.lastFrame=now;state.elapsed+=delta;state.crowdClock+=delta;drawPeople(delta);
 if(state.blocked){status('安全停车等待','所有通道封闭，机器人保持当前位置，不穿过人群。','等待通道开放');requestAnimationFrame(animate);return;}
 if(state.pauseLeft>0){state.pauseLeft=Math.max(0,state.pauseLeft-delta);requestAnimationFrame(animate);return;}
 const leg=state.plan?.legs[state.stage];if(!leg)return;
 const sensed=getObstacleSnapshot(state.scenario,state.slot,state.crowdClock,state.visiblePeople);
 const obstacles=sensed;
 const advance=delta*(state.scenario==='peak'?22:26);
 const move=safeNextMove(leg,advance,obstacles);
 if(!move){
  const threat=sensed.filter(o=>dist(o.point,state.position)<8).sort((a,b)=>dist(a.point,state.position)-dist(b.point,state.position))[0];
  const id=threat?.id||'通道';
  if(state.avoidanceId!==`wait-${id}`){log(`前方${threat?.type==='cart'?'购物车':'行人'}占用安全距离：机器人停车等待通道畅通。`);state.avoidanceId=`wait-${id}`;}
  status('前方有人，停车等待','当前没有保持安全距离的绕行空间；行人离开后再继续。','安全停车');
  requestAnimationFrame(animate);return;
 }
 if(move.kind!=='route'){
  const threat=sensed.filter(o=>dist(o.point,state.position)<8).sort((a,b)=>dist(a.point,state.position)-dist(b.point,state.position))[0];
  const id=threat?.id||'通道';
  if(state.avoidanceId!==`detour-${id}`){log(`动态避障：识别前方${threat?.type==='cart'?'购物车':'行人'}，减速并从安全侧绕行。`);state.avoidanceId=`detour-${id}`;}
  status('识别障碍，减速避让','前方有行人或购物车，机器人选择可通行的侧边，并持续检查安全距离。','低速避让');
 }else if(state.avoidanceId){state.avoidanceId='';status(`前往${nextName()}`,'前方安全，沿路线继续行驶。','行驶中');}
 state.legDistance=move.progress;state.position=move.point;
 if(dist(state.history.at(-1),state.position)>.15)state.history.push([...state.position]);
 drawHistory();drawRobot();renderProgress();
 if(state.legDistance>=leg.length-.001){state.legDistance=0;arrive();}
 if(state.running)requestAnimationFrame(animate);
}
function playPause(){
 if(state.shortage){status('请先确认缺货替代','请在缺货面板选择「同意替代」或「不替代，跳过」。','等待顾客确认');return;}
 if(state.assistPending){status('请先完成员工协助取货','请在协助面板确认实物已核对并取货。','人工协助');return;}
 if(state.fault){status('故障安全停车',faultAdvice[state.fault],'等待人工排查');return;}
 if(state.suddenPerson){status('突发行人：安全停车','请先解除近距安全停车。','安全停车');return;}
 if(state.awaitingPickup){status('请先完成出口交接','请让顾客核对订单并点击「确认顾客已在出口取货」。','待交接');return;}
 if(!state.order){status('请先完成教学模拟付款','在上方选择商品、加入购物车，再点「教学模拟付款并提交订单」。','等待订单');log('未收到已付款订单，机器人不能出发。');return;}
 if(orderWeight()>CAPACITY){status('无法出发：载重超限',`订单 ${kg(orderWeight())} 超过 ${kg(CAPACITY)} 上限。`,'超载');log('载重检查失败，机器人保持在入口。');return;}
 if(state.running){state.running=false;state.lastFrame=0;$('playLabel').textContent='继续播放';$('playBtn').firstElementChild.textContent='▶';status('演示已暂停','点击继续播放，机器人会从当前位置继续。','暂停');renderProgress();renderQueue();return;}
 if(state.stage===0&&state.elapsed===0){log(`载重检查通过：${kg(orderWeight())} / ${kg(CAPACITY)}。`);log(`${state.plan.method}，逐段 A* 规划；机器人从入口进入。`);if(state.scenario==='peak')log('识别中部通道高拥堵与安全风险：重新规划，橙色原路线改为绿色安全路线。');}
 state.running=true;state.lastFrame=0;$('playLabel').textContent='暂停演示';$('playBtn').firstElementChild.textContent='Ⅱ';status(`前往${nextName()}`,'沿规划通道行驶，模拟识别人、购物车和固定货架。',state.blocked?'安全停车':'行驶中');renderProgress();renderQueue();requestAnimationFrame(animate);
}
function toggleBlock(){state.blocked=!state.blocked;log(state.blocked?'安全测试：全部通道封闭，机器人停车等待。':'安全测试：通道重新开放，可继续沿路线行驶。');if(state.blocked)status('安全停车等待','全部通道封闭，机器人不穿过人群。','安全停车');else status('通道重新开放','恢复安全路线后继续购物。',state.running?'行驶中':'待机');renderScene();}
function demoOrder(){
 const selectedShelves=new Set();
 const examples=(research?.top||catalogSeed.top).filter(p=>{const item=productById.get(`I${p.id}`);if(!item||p.weightG<=0||p.weightG>2000||selectedShelves.has(item.shelfId))return false;selectedShelves.add(item.shelfId);return true;}).slice(0,4);
 state.cart=new Map(examples.map(p=>[`I${p.id}`,1]));
 renderCart();renderRecommendations();renderOrderState();
 $('orderMessage').textContent='已装入 4 件课堂示例商品。点击教学模拟付款；若当前订单仍在执行，新订单会排队。';
}
function toggleOverload(){const id=products.find(p=>p.name==='饮料箱').id;changeQty(id,state.cart.has(id)?-state.cart.get(id):3);$('orderMessage').textContent=state.cart.has(id)?'已加入 3 箱 × 6 kg 教学压力测试饮料。提交后机器人会因超过 12 kg 而保持在入口。':'压力测试饮料箱已移除；当前已付款订单不受影响。';}
for(const row of catalogSeed.top){const id=`I${row.id}`;if(!productById.has(id))productById.set(id,convertProduct(row));}
catalogResults=catalogSeed.top.slice(0,36).map(row=>productById.get(`I${row.id}`));
renderCatalogue();populateFilters();
scene3d=createStoreScene($('scene3d'),$('storeMap'));drawBaseMap();drawFixtures();renderCart();renderInventory();renderRecommendations();renderCrowd();resetPlayback();
let lastCrowdTick=performance.now();
setInterval(()=>{const now=performance.now(),delta=Math.min((now-lastCrowdTick)/1000,.15);lastCrowdTick=now;if(!state.running){state.crowdClock+=delta;drawPeople(delta);}},100);
loadResearch().then(data=>{
 research=data;
 catalogIndex=data.index;
 for(const row of [...data.top,...Object.values(data.rules.products)]){const id=`I${row.id}`;if(!productById.has(id))productById.set(id,convertProduct(row));}
 rules=data.rules.rules.map(rule=>({...rule,from:`I${rule.from}`,to:`I${rule.to}`}));
 populateFilters();scheduleCatalogSearch();renderRules();renderRecommendations();renderResearchDashboard(data);renderDataAudit();
}).catch(error=>{$('miningMethod').textContent=`研究统计加载失败：${error.message}；商品目录仍可使用。`;});
$('benchmarkBtn').addEventListener('click',runBenchmark);
$('suddenPersonBtn').addEventListener('click',toggleSuddenPerson);
$('injectFaultBtn').addEventListener('click',()=>setFault(true));
$('clearFaultBtn').addEventListener('click',()=>setFault(false));
$('confirmAssistBtn').addEventListener('click',confirmPickupAssist);
$('inventoryAlerts').addEventListener('click',e=>{const id=e.target.closest('[data-restock]')?.dataset.restock;if(id)restock(id);});
$('catalogue').addEventListener('click',e=>{const id=e.target.closest('[data-add]')?.dataset.add;if(id)changeQty(id,1);});$('recommendations').addEventListener('click',e=>{const id=e.target.closest('[data-add]')?.dataset.add;if(id)changeQty(id,1);});$('cartList').addEventListener('click',e=>{const plus=e.target.closest('[data-plus]')?.dataset.plus,minus=e.target.closest('[data-minus]')?.dataset.minus;if(plus)changeQty(plus,1);if(minus)changeQty(minus,-1);});$('productSearch').addEventListener('input',scheduleCatalogSearch);$('categoryFilter').addEventListener('change',updateSubcategories);$('subcategoryFilter').addEventListener('change',scheduleCatalogSearch);$('demoOrderBtn').addEventListener('click',demoOrder);$('submitOrderBtn').addEventListener('click',submitOrder);$('normalBtn').addEventListener('click',()=>{state.scenario='normal';updateScenario();});$('peakBtn').addEventListener('click',()=>{state.scenario='peak';updateScenario();});$('timeSlot').addEventListener('change',()=>{state.slot=$('timeSlot').value;renderCrowd();updateScenario();});$('playBtn').addEventListener('click',playPause);$('resetBtn').addEventListener('click',()=>{resetPlayback();log('已重开当前教学模拟订单，机器人回到入口。');});$('safetyTestBtn').addEventListener('click',toggleBlock);$('overloadBtn').addEventListener('click',toggleOverload);$('cameraResetBtn').addEventListener('click',()=>scene3d.resetCamera());$('stockoutSelect').addEventListener('change',()=>{state.stockoutId=$('stockoutSelect').value;log(state.stockoutId?`缺货演示已选中 ${productById.get(state.stockoutId).name}；机器人到货架时等待顾客决定。`:'缺货演示已关闭。');});$('acceptSubBtn').addEventListener('click',()=>decideSubstitution(true));$('skipSubBtn').addEventListener('click',()=>decideSubstitution(false));$('handoffBtn').addEventListener('click',confirmHandoff);$('orderQueue').addEventListener('click',e=>{const id=e.target.closest('[data-cancel]')?.dataset.cancel;if(id)cancelOrder(id);if(e.target.closest('[data-cancel-active]'))cancelActive();});
