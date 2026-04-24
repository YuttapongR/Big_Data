import pandas as pd
import os
from datetime import datetime

def clean_steam_data():
    """ทำความสะอาดข้อมูล Steam Dataset 2025 ด้วย Pandas"""
    
    raw_dir = "/opt/airflow/data/raw"
    processed_dir = "/opt/airflow/data/processed"
    os.makedirs(processed_dir, exist_ok=True)

    # ========== Clean Reviews ==========
    reviews_path = os.path.join(raw_dir, "reviews.csv")
    cleaned_reviews_path = os.path.join(processed_dir, "cleaned_reviews.parquet")

    print(f"📥 Reading reviews.csv...")
    reviews_df = pd.read_csv(
        reviews_path,
        usecols=[
            "recommendationid", "appid", "author_steamid",
            "author_playtime_forever", "author_playtime_at_review",
            "language", "review_text", "timestamp_created",
            "voted_up", "votes_up", "votes_funny",
            "weighted_vote_score", "steam_purchase"
        ],
        dtype={
            "recommendationid": "int64",
            "appid": "int64",
            "author_steamid": "str",
            "voted_up": "str",
            "steam_purchase": "str",
        },
        low_memory=False
    )

    original_reviews = len(reviews_df)
    print(f"📥 Read {original_reviews:,} reviews")

    # 1. ลบ null ในคอลัมน์สำคัญ
    reviews_df = reviews_df.dropna(subset=["appid", "author_steamid", "voted_up", "timestamp_created"])

    # 2. แปลง voted_up เป็น boolean
    reviews_df["is_positive"] = reviews_df["voted_up"].astype(str).str.strip().str.lower() == "true"

    # 3. แปลง timestamp_created เป็น review_date
    reviews_df["review_date"] = pd.to_datetime(reviews_df["timestamp_created"], unit="s", errors="coerce").dt.date

    # 4. แปลง playtime เป็นชั่วโมง
    reviews_df["playtime_hours"] = (reviews_df["author_playtime_forever"].fillna(0) / 60).round(1)

    # 5. ลบ duplicate
    reviews_df = reviews_df.drop_duplicates(subset=["recommendationid"])

    # 6. ลบแถวที่ review_date เป็น NaT
    reviews_df = reviews_df.dropna(subset=["review_date"])

    cleaned_reviews = len(reviews_df)
    reviews_df.to_parquet(cleaned_reviews_path, index=False)
    print(f"✅ Reviews cleaned: {original_reviews:,} → {cleaned_reviews:,} (removed {original_reviews - cleaned_reviews:,})")

    # ========== Clean Applications ==========
    apps_path = os.path.join(raw_dir, "applications.csv")
    cleaned_apps_path = os.path.join(processed_dir, "cleaned_apps.parquet")

    print(f"📥 Reading applications.csv...")
    apps_df = pd.read_csv(
        apps_path,
        usecols=[
            "appid", "name", "type", "is_free", "release_date",
            "metacritic_score", "recommendations_total",
            "mat_final_price", "mat_currency"
        ],
        dtype={"appid": "int64", "name": "str", "type": "str"},
        low_memory=False
    )

    original_apps = len(apps_df)
    print(f"📥 Read {original_apps:,} applications")

    # 1. ลบ null
    apps_df = apps_df.dropna(subset=["appid", "name"])

    # 2. เลือกเฉพาะ type = 'game'
    apps_df = apps_df[apps_df["type"] == "game"]

    # 3. ลบชื่อว่าง
    apps_df = apps_df[apps_df["name"].str.strip().str.len() > 0]

    # 4. ลบ duplicate
    apps_df = apps_df.drop_duplicates(subset=["appid"])

    cleaned_apps = len(apps_df)
    apps_df.to_parquet(cleaned_apps_path, index=False)
    print(f"✅ Applications cleaned: {original_apps:,} → {cleaned_apps:,} (removed {original_apps - cleaned_apps:,})")

if __name__ == "__main__":
    clean_steam_data()
