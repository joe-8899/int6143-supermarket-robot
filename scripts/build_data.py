"""从用户提供的 Instacart 清洗 CSV 生成静态站点数据；不修改源 CSV。"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
import time
from statistics import median
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/data"
FIELDS = ["estimated_price_usd", "weight_g", "calories_kcal_per_100g"]


def rows(path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def write(name, value):
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(name, path.stat().st_size, "bytes", flush=True)


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def kmeans(x, k, seed=6143, iterations=35):
    rng = np.random.default_rng(seed + k)
    centers = [x[rng.integers(len(x))]]
    for _ in range(1, k):
        nearest = np.min([((x-c)**2).sum(axis=1) for c in centers], axis=0)
        total = nearest.sum()
        centers.append(x[rng.choice(len(x), p=nearest/total)] if total else x[rng.integers(len(x))])
    centers = np.array(centers)
    for _ in range(iterations):
        d = ((x[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        labels = d.argmin(axis=1)
        next_centers = centers.copy()
        for i in range(k):
            group = x[labels == i]
            next_centers[i] = group.mean(axis=0) if len(group) else x[rng.integers(len(x))]
        if np.allclose(centers, next_centers, atol=1e-4):
            centers = next_centers
            break
        centers = next_centers
    d = ((x[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
    labels = d.argmin(axis=1)
    return labels, float(d[np.arange(len(x)), labels].sum())


def silhouette_sample(x, labels, seed=6143, n=400):
    rng = np.random.default_rng(seed)
    ix = rng.choice(len(x), min(n, len(x)), replace=False)
    points, groups = x[ix], labels[ix]
    distance = np.sqrt(np.maximum(0, ((points[:, None, :] - points[None, :, :]) ** 2).sum(axis=2)))
    values = []
    for i, label in enumerate(groups):
        same = groups == label
        if same.sum() <= 1:
            continue
        a = distance[i, same].sum() / (same.sum() - 1)
        b = min(distance[i, groups == other].mean() for other in set(groups) if other != label)
        values.append((b - a) / max(a, b) if max(a, b) else 0)
    return round(float(np.mean(values)), 4) if values else None


def main(source):
    started = time.perf_counter()
    paths = {name: source / name for name in (
        "products_enriched_clean.csv", "orders_clean.csv", "order_products_train_clean.csv",
        "aisles_clean.csv", "departments_clean.csv")}
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        raise SystemExit("缺少数据文件: " + ", ".join(missing))
    products, raw_products = [], 0
    product_ids, duplicate_products = set(), 0
    missing_fields = Counter()
    methods = {name: Counter() for name in ("price_method", "weight_method", "calorie_method", "data_quality")}
    by_department = defaultdict(list)
    department_names, aisle_names = {}, {}
    for row in rows(paths["departments_clean.csv"]):
        department_names[int(row["department_id"])] = row["department"]
    for row in rows(paths["aisles_clean.csv"]):
        aisle_names[int(row["aisle_id"])] = row["aisle"]
    for row in rows(paths["products_enriched_clean.csv"]):
        raw_products += 1
        pid = int(row["product_id"])
        if pid in product_ids:
            duplicate_products += 1
            continue
        product_ids.add(pid)
        for field in FIELDS:
            if number(row[field]) is None:
                missing_fields[field] += 1
        p = {
            "id": pid, "name": row["product_name"], "aisleId": int(row["aisle_id"]),
            "aisle": row["aisle"], "departmentId": int(row["department_id"]),
            "department": row["department"], "priceUsd": number(row["estimated_price_usd"]),
            "weightG": number(row["weight_g"]), "calories100g": number(row["calories_kcal_per_100g"]),
            "priceMethod": row["price_method"], "weightMethod": row["weight_method"],
            "calorieMethod": row["calorie_method"], "quality": row["data_quality"]
        }
        products.append(p)
        by_department[p["departmentId"]].append(p)
    aisle_defaults = defaultdict(list)
    for p in products:
        if p["weightMethod"] == "category_default" and p["weightG"] is not None:
            aisle_defaults[p["aisleId"]].append(p["weightG"])
    corrected_parsed_weights = 0
    for p in products:
        suspicious_size = bool(re.search(r"\b(?:diapers?|training pants|pull-ups|up to|less than)\b", p["name"], re.I))
        if p["weightMethod"] == "parsed_lb" and (suspicious_size or (p["weightG"] or 0) >= 100000):
            p["originalWeightG"] = p["weightG"]
            p["weightG"] = median(aisle_defaults[p["aisleId"]]) if aisle_defaults[p["aisleId"]] else 500.0
            p["weightMethod"] = "category_default_after_spec_guard"
            p["quality"] = "corrected_estimate"
            corrected_parsed_weights += 1
    for p in products:
        for field, key in (("price_method", "priceMethod"), ("weight_method", "weightMethod"),
                           ("calorie_method", "calorieMethod"), ("data_quality", "quality")):
            methods[field][p[key]] += 1
    invalid_links = Counter()
    invalid_values = Counter()
    for p in products:
        if p["aisleId"] not in aisle_names:
            invalid_links["aisle"] += 1
        if p["departmentId"] not in department_names:
            invalid_links["department"] += 1
        if p["priceUsd"] is not None and p["priceUsd"] <= 0:
            invalid_values["nonPositivePrice"] += 1
        if p["weightG"] is not None and p["weightG"] <= 0:
            invalid_values["nonPositiveWeight"] += 1
        if p["calories100g"] is not None and p["calories100g"] < 0:
            invalid_values["negativeCalories"] += 1
    products_by_id = {p["id"]: p for p in products}
    order_ids, order_hour = set(), Counter()
    raw_orders = 0
    train_orders = set()
    duplicate_orders = 0
    missing_prior_interval = 0
    for row in rows(paths["orders_clean.csv"]):
        raw_orders += 1
        oid = int(row["order_id"])
        if oid in order_ids:
            duplicate_orders += 1
            continue
        order_ids.add(oid)
        if not row["days_since_prior_order"]:
            missing_prior_interval += 1
        order_hour[row["order_hour_of_day"]] += 1
        if row["eval_set"] == "train":
            train_orders.add(oid)
    baskets = defaultdict(set)
    frequency, reordered = Counter(), Counter()
    invalid_train = Counter()
    raw_lines = 0
    duplicate_lines = 0
    line_keys = set()
    for row in rows(paths["order_products_train_clean.csv"]):
        raw_lines += 1
        oid, pid = int(row["order_id"]), int(row["product_id"])
        if (oid, pid) in line_keys:
            duplicate_lines += 1
            continue
        line_keys.add((oid, pid))
        if oid not in train_orders:
            invalid_train["order_id"] += 1
            continue
        if pid not in products_by_id:
            invalid_train["product_id"] += 1
            continue
        baskets[oid].add(pid)
        frequency[pid] += 1
        reordered[pid] += int(row["reordered"])
    n_baskets = len(baskets)
    for p in products:
        count = frequency[p["id"]]
        p["frequency"] = count
        p["reorderedCount"] = reordered[p["id"]]
        p["reorderRate"] = round(reordered[p["id"]]/count, 4) if count else None
    for dept, items in by_department.items():
        write(f"catalog/department-{dept}.json", items)
    search_shards = defaultdict(list)
    for p in products:
        initials = {word[0] for word in re.findall(r"[a-z0-9]+", p["name"].lower())}
        for initial in initials or {"_"}:
            search_shards[initial].append([p["id"], p["name"], p["departmentId"]])
    for initial, entries in search_shards.items():
        write(f"catalog/search-{initial}.json", entries)
    write("catalog/index.json", {
        "count": len(products),
        "departments": [{"id": i, "name": name, "count": len(by_department[i])} for i, name in department_names.items()],
        "aisles": [{"id": i, "name": name, "departmentId": next((p["departmentId"] for p in products if p["aisleId"] == i), None)} for i, name in aisle_names.items()]
    })
    write("top-products.json", [dict(products_by_id[pid], frequency=count, reorderRate=round(reordered[pid]/count, 4)) for pid, count in frequency.most_common(50)])
    write("top-reordered.json", [dict(products_by_id[pid], reorderedCount=count, frequency=frequency[pid]) for pid, count in reordered.most_common(10)])

    # Apriori：在真实 train 购物篮中先筛选支持度合格的单项，再生成二项候选。
    mining_start = time.perf_counter()
    min_count, max_items = 35, 600
    frequent = {pid for pid, count in frequency.most_common(max_items) if count >= min_count}
    pairs = Counter()
    for basket in baskets.values():
        ids = sorted(basket & frequent)
        for i, a in enumerate(ids):
            for b in ids[i+1:]:
                pairs[(a, b)] += 1
    frequent_pairs = {pair: count for pair, count in pairs.items() if count >= min_count}
    rules = []
    for (a, b), count in frequent_pairs.items():
        for antecedent, consequent in ((a, b), (b, a)):
            confidence = count / frequency[antecedent]
            rules.append({
                "from": antecedent, "to": consequent, "count": count,
                "support": round(count/n_baskets, 8), "confidence": round(confidence, 6),
                "lift": round(confidence/(frequency[consequent]/n_baskets), 5)
            })
    rules.sort(key=lambda r: (-r["lift"], -r["confidence"], -r["count"]))
    write("rules.json", {
        "algorithm": "Apriori (frequent 1-itemsets and 2-itemsets)",
        "baskets": n_baskets, "distinctProducts": len(frequency), "candidateProducts": len(frequent),
        "minSupportCount": min_count, "minSupport": round(min_count/n_baskets, 8),
        "minConfidenceComputed": 0, "itemsets": len(frequent) + len(frequent_pairs),
        "ruleCount": len(rules), "seconds": round(time.perf_counter()-mining_start, 3),
        "scope": "仅从购买频次前 600 件商品筛选；仅挖掘最多 2 项的频繁集。阈值筛选只在已计算规则内进行。",
        "products": {str(pid): products_by_id[pid] for pid in frequent},
        "rules": rules
    })

    # K-means 输入为有食品热量估算的高频商品。无热量的非食品不硬填数值。
    clustering_start = time.perf_counter()
    candidates = [p for p in products if p["calories100g"] is not None and p["priceUsd"] is not None and p["weightG"] is not None]
    candidates.sort(key=lambda p: (-frequency[p["id"]], p["id"]))
    candidates = candidates[:4000]
    n = len(candidates)
    aisle_ids = sorted({p["aisleId"] for p in candidates})
    dept_ids = sorted({p["departmentId"] for p in candidates})
    numerical = np.array([[math.log1p(p["priceUsd"]), math.log1p(p["weightG"]), math.log1p(p["calories100g"]),
                           math.log1p(frequency[p["id"]]), reordered[p["id"]]/frequency[p["id"]] if frequency[p["id"]] else 0]
                          for p in candidates], dtype=np.float32)
    mean, std = numerical.mean(axis=0), numerical.std(axis=0)
    numerical = (numerical-mean)/np.where(std == 0, 1, std)
    categories = np.zeros((n, len(aisle_ids)+len(dept_ids)), dtype=np.float32)
    aisle_pos = {x: i for i, x in enumerate(aisle_ids)}
    dept_pos = {x: i+len(aisle_ids) for i, x in enumerate(dept_ids)}
    for i, p in enumerate(candidates):
        categories[i, aisle_pos[p["aisleId"]]] = 1
        categories[i, dept_pos[p["departmentId"]]] = 1
    x = np.concatenate((numerical, categories), axis=1)
    diagnostics = []
    solutions = {}
    for k in range(3, 8):
        attempts = [kmeans(x, k, seed=6143+i*97) for i in range(5)]
        labels, inertia = min(attempts, key=lambda solution: solution[1])
        diagnostics.append({"k": k, "inertia": round(inertia, 2), "silhouette": silhouette_sample(x, labels)})
        solutions[k] = labels
    first, last = diagnostics[0], diagnostics[-1]
    selected = max(diagnostics[1:-1], key=lambda d:
                   (first["inertia"] + (last["inertia"]-first["inertia"])*(d["k"]-first["k"])/(last["k"]-first["k"])) - d["inertia"])["k"]
    labels = solutions[selected]
    # PCA 的二维投影只用于可视化，不参与训练。
    centered = x - x.mean(axis=0)
    _, _, vt = np.linalg.svd(centered, full_matrices=False)
    projection = centered @ vt[:2].T
    extent = np.maximum(np.percentile(np.abs(projection), 98, axis=0), .001)
    sample_ix = np.linspace(0, n-1, min(n, 800), dtype=int)
    clusters = []
    for label in range(selected):
        group = [candidates[i] for i in range(n) if labels[i] == label]
        def avg(fn):
            return round(sum(fn(p) for p in group)/len(group), 3) if group else None
        clusters.append({"id": label+1, "count": len(group), "avgPriceUsd": avg(lambda p:p["priceUsd"]),
                         "avgWeightG": avg(lambda p:p["weightG"]), "avgCalories100g": avg(lambda p:p["calories100g"]),
                         "avgReorderRate": avg(lambda p: reordered[p["id"]]/frequency[p["id"]] if frequency[p["id"]] else 0),
                         "representatives": [p["name"] for p in sorted(group, key=lambda p:-frequency[p["id"]])[:5]]})
    write("clusters.json", {
        "algorithm": "K-means", "sampleSize": n, "sourceEligible": sum(p["calories100g"] is not None for p in products),
        "selection": "按 train 购买频次取前 4000 件有热量估算的食品商品；非食品不参与。",
        "features": ["log估算价格", "log估算重量", "log估算热量/100g", "log购买频次", "复购比例", "aisle one-hot", "department one-hot"],
        "missing": "缺少价格、重量或食品热量者排除；数值标准化，类别 one-hot。",
        "kValues": diagnostics, "selectedK": selected, "kSelection": "类内平方和曲线的最大肘点距离；轮廓系数仅作效果评价。",
        "silhouetteSample": min(400, n),
        "seconds": round(time.perf_counter()-clustering_start, 3), "clusters": clusters,
        "points": [[round(float(np.clip(projection[i,0]/extent[0], -1, 1)), 3), round(float(np.clip(projection[i,1]/extent[1], -1, 1)), 3), int(labels[i])+1] for i in sample_ix]
    })
    summary = {
        "source": "Instacart cleaned/enriched CSV supplied by user; train order-product table",
        "products": len(products), "orders": len(order_ids), "trainOrders": len(train_orders),
        "basketOrders": n_baskets, "orderProductLines": raw_lines-duplicate_lines-sum(invalid_train.values()),
        "aisles": len(aisle_names), "departments": len(department_names),
        "meanTrainBasketSize": round(sum(map(len, baskets.values()))/n_baskets, 3),
        "orderHour": {str(i): order_hour[str(i)] for i in range(24)},
        "priceDistribution": histogram([p["priceUsd"] for p in products], [0, 2, 5, 10, 20, 50, 100, 100000]),
        "weightDistribution": histogram([p["weightG"] for p in products], [0, 100, 250, 500, 1000, 2000, 5000, 1000000]),
        "calorieDistribution": histogram([p["calories100g"] for p in products if p["calories100g"] is not None], [0, 50, 100, 200, 300, 500, 1000]),
        "methods": {k: dict(v) for k, v in methods.items()},
        "quality": {
            "rawRows": {"products":raw_products,"orders":raw_orders,"orderProductsTrain":raw_lines},
            "cleanRows": {"products":len(products),"orders":len(order_ids),"orderProductsTrain":raw_lines-duplicate_lines-sum(invalid_train.values())},
            "duplicateRowsInProvidedCleanFiles": {"products":duplicate_products,"orders":duplicate_orders,"orderProductsTrain":duplicate_lines},
            "invalidLinksInProvidedCleanFiles": {**dict(invalid_links), **dict(invalid_train)},
            "invalidAttributeValues": dict(invalid_values),
            "correctedParsedWeights": corrected_parsed_weights,
            "missingProductFields": dict(missing_fields),
            "missingPriorOrderInterval": missing_prior_interval,
            "note": "原始→清洗前的删除量不可从已清洗文件反推；此处只统计提供的清洗文件本身，不声称执行了原始数据清洗。"
        },
        "buildSeconds": round(time.perf_counter()-started, 3)
    }
    write("summary.json", summary)


def histogram(values, edges):
    counts = [0]*(len(edges)-1)
    for value in values:
        if value is None:
            continue
        for i in range(len(counts)):
            if edges[i] <= value < edges[i+1]:
                counts[i] += 1
                break
    return [{"range":f"{edges[i]}–{edges[i+1]}","count":count} for i,count in enumerate(counts)]


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    main(parser.parse_args().source)
