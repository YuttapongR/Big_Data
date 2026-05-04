import json, urllib.request, sys
sys.stdout.reconfigure(encoding='utf-8')

url = "http://localhost:8000/api/games-analytics?genre=All"
data = json.loads(urllib.request.urlopen(url).read())["data"]

# Filter games with revenue and price, then sort by estimated_revenue
top_revenue = [d for d in data if d.get("estimated_revenue", 0) > 0 and d.get("price", 0) > 0]
top_revenue.sort(key=lambda x: x["estimated_revenue"], reverse=True)
top_15 = top_revenue[:15]

print(f"{'Rank':<4} {'Game Name':<30} {'Revenue ($)':>15} {'Price':>10} {'Reviews':>12}")
print("-" * 75)

for i, g in enumerate(top_15, 1):
    name = g['name'][:28] + '..' if len(g['name']) > 28 else g['name']
    rev = f"{g['estimated_revenue']:,.0f}"
    print(f"{i:<4} {name:<30} {rev:>15} ${g['price']:>9.2f} {g['total_reviews']:>12,}")
