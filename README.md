# INT6143 Group 3 超市购物机器人

这是可在 GitHub Pages 运行的静态教学网站。顾客从 Instacart 商品目录选货、教学模拟付款；原有 3D 场景、订单队列、A* 分段路径、Held-Karp 访问顺序、安全停车与出口交接继续运行。数据挖掘在开发阶段用 Python 完成，网页只读取 `public/data` 中的静态结果。

## 数据与可复现构建

输入文件为用户提供的 `products_enriched_clean.csv`、`orders_clean.csv`、`order_products_train_clean.csv`、`aisles_clean.csv`、`departments_clean.csv`。原始 CSV 不放进 GitHub Pages，也不修改 ID。运行：

```bash
/Users/joe/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/build_data.py --source '/Users/joe/Downloads/instacart_cleaned_enriched_data(1)'
```

脚本使用 Python 标准库和 NumPy。输出包括按 department 分片的商品目录、按名称首字母分片的轻量搜索索引、总体统计、Apriori 规则、K-means 聚类和高频商品。构建时间记录在各 JSON 中。前端不会加载 342 万张订单，也不会一次加载全部商品详情。

## 方法边界

- Apriori 使用 131,209 张真实 train 购物篮。只在购买频次前 600 件候选商品中挖掘一项和二项频繁集；最小共购计数 35。页面可调整支持度、置信度筛选，但不会在浏览器重新挖掘遗漏的候选。共购不代表因果或增购效果。
- K-means 使用 4,000 件购买频次较高且有热量估算的食品商品。数值特征经对数变换和标准化，aisle／department 做 one-hot。比较 K=3–7 的类内平方和与 400 件样本轮廓系数，按肘部法选 K。非食品没有热量值，不参加此食品聚类。聚类输出不是最优货架布局。
- 商品名、类别、购买关系来自提供的 Instacart 清洗数据。`estimated_price_usd`、`weight_g` 和食品热量是补充估算，其中重量仅少数由名称解析。页面以固定 1 USD＝¥7 的**教学假设**计算人民币起购金额；该换算不是实际交易汇率。
- 商品货架位置、库存、12 kg 机器人载重、人流、障碍物分类、通行时间和 3D 行为均为教学模拟。Instacart 下单时段不能作为店内货架客流或通道时间标签；没有真实传感器分类器、通行时间回归指标或实物机器人性能。
- 对提供的已清洗 CSV 执行了重复、缺失、无效键和属性值检查。原始数据在清洗前的删除数无法由已清洗文件反推，网页不声称已重做原始清洗。

## 未来传感器接口

`sensorAdapter.js` 默认提供教学模拟障碍物。未来如有已标注、已分类的实际传感器流，可以调用 `window.INT6143_SENSOR.registerProvider(fn)`，其中同步函数返回 `{id, type: 'person'|'cart', zone, point: [x,y]}` 数组；传入 `null` 恢复模拟。接口校验格式并供避障层读取，但没有训练或验证真实分类器，也没有把外部数据绘制成真实 3D 场景。接入实物前仍需对时间戳、坐标系、制动距离和安全认证另行验证。

## 部署

`.github/workflows/expire-pages.yml` 从 `main` 构建静态站点，复制根目录页面代码、`vendor` 和 `public/data`。保留原站点地址和截至北京时间 2026-12-31 的展示期限。更新数据需重新运行脚本并提交生成的 JSON。
