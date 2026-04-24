import pandas as pd
import os
from datetime import datetime

def aggregate_steam_data():
    """Aggregate ข้อมูล Steam Dataset 2025 ด้วย Pandas"""

    processed_dir = "/opt/airflow/data/processed"
    cleaned_reviews_path = os.path.join(processed_dir, "cleaned_reviews.parquet")
    cleaned_apps_path = os.path.join(processed_dir, "cleaned_apps.parquet")
    daily_data_path = os.path.join(processed_dir, "daily_steam_reviews.parquet")
    top_games_path = os.path.join(processed_dir, "top_games.parquet")

    print("📥 Reading cleaned data...")
    reviews_df = pd.read_parquet(cleaned_reviews_path)
    apps_df = pd.read_parquet(cleaned_apps_path)
    print(f"📥 {len(reviews_df):,} reviews, {len(apps_df):,} apps")

    # ===== Aggregation 1: Daily Summary =====
    reviews_df["review_date"] = pd.to_datetime(reviews_df["review_date"])

    daily_df = reviews_df.groupby("review_date").agg(
        total_reviews=("recommendationid", "count"),
        positive_reviews=("is_positive", "sum"),
        avg_playtime_hours=("playtime_hours", "mean"),
        unique_games=("appid", "nunique"),
        unique_reviewers=("author_steamid", "nunique"),
    ).reset_index()

    daily_df["negative_reviews"] = daily_df["total_reviews"] - daily_df["positive_reviews"]
    daily_df["avg_playtime_hours"] = daily_df["avg_playtime_hours"].round(1)
    daily_df = daily_df.sort_values("review_date")

    # แปลง review_date เป็น string เพื่อให้ส่งเป็น JSON ได้ง่าย
    daily_df["review_date"] = daily_df["review_date"].dt.strftime("%Y-%m-%d")

    daily_df.to_parquet(daily_data_path, index=False)
    print(f"✅ Daily aggregation: {len(daily_df)} rows → {daily_data_path}")

    # ===== Aggregation 2: Top Games =====
    # Join reviews กับ apps เพื่อได้ชื่อเกม + recommendations_total
    reviews_with_names = reviews_df.merge(
        apps_df[["appid", "name", "is_free", "metacritic_score", "mat_final_price", "recommendations_total"]],
        on="appid",
        how="inner"
    )

    top_games_df = reviews_with_names.groupby(["appid", "name"]).agg(
        total_reviews=("recommendationid", "count"),
        positive_reviews=("is_positive", "sum"),
        avg_playtime_hours=("playtime_hours", "mean"),
        unique_reviewers=("author_steamid", "nunique"),
        recommendations_total=("recommendations_total", "first"),
        metacritic_score=("metacritic_score", "first"),
        price=("mat_final_price", "first"),
    ).reset_index()

    top_games_df["negative_reviews"] = top_games_df["total_reviews"] - top_games_df["positive_reviews"]
    top_games_df["avg_playtime_hours"] = top_games_df["avg_playtime_hours"].round(1)
    top_games_df["positive_rate"] = ((top_games_df["positive_reviews"] / top_games_df["total_reviews"]) * 100).round(1)

    # กรองเฉพาะที่มีชื่อเกม + เรียงด้วย recommendations_total (จำนวนรีวิวจริงจากทั้ง Steam)
    top_games_df = top_games_df.dropna(subset=["name"])
    top_games_df = top_games_df.sort_values("recommendations_total", ascending=False).head(50)

    top_games_df.to_parquet(top_games_path, index=False)
    print(f"✅ Top games: {len(top_games_df)} rows → {top_games_path}")

    # ===== Aggregation 3: Global Summary =====
    summary = {
        "total_reviews": int(len(reviews_df)),
        "total_games": int(len(apps_df)),
        "positive_rate": float(((reviews_df["is_positive"].sum() / len(reviews_df)) * 100).round(1)),
        "unique_reviewers": int(reviews_df["author_steamid"].nunique()),
        "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    
    import json
    summary_path = os.path.join(processed_dir, "summary.json")
    with open(summary_path, "w") as f:
        json.dump(summary, f)
    print(f"✅ Global summary: {summary_path}")

if __name__ == "__main__":
    aggregate_steam_data()
