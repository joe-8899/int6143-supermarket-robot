// 未来传感器接入点。当前默认返回明确标注的教学模拟障碍物，不包含真实分类模型。
import { peopleForScenario } from './storeData.js?v=20261122-dynamic';

let provider = null;
export function registerSensorProvider(nextProvider) {
  if (nextProvider !== null && typeof nextProvider !== 'function') throw new TypeError('传感器提供者必须是同步函数或 null');
  provider = nextProvider;
}

export function getObstacleSnapshot(scenario, slot, time=0, visiblePeople=null) {
  const simulated = (visiblePeople||peopleForScenario(scenario, slot, time)).map(person => ({...person, type:'person'}));
  simulated.push({id:'cart', type:'cart', zone:'购物车', point:scenario==='peak'?[74,36.5]:[106,81]});
  if (!provider) return simulated;
  try {
    const values = provider({scenario, slot, time});
    if (!Array.isArray(values)) return simulated;
    return values.filter(item => item && ['person','cart'].includes(item.type)
      && Array.isArray(item.point) && item.point.length===2
      && item.point.every(value => Number.isFinite(value)))
      .map((item, i) => ({id:String(item.id ?? `external-${i}`), type:item.type,
        zone:String(item.zone ?? '未标注区域'), point:[...item.point]}));
  } catch (error) {
    console.warn('传感器接口不可用，回退教学模拟障碍物。', error);
    return simulated;
  }
}
