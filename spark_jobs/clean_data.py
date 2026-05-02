from pyspark.sql import SparkSession
from pyspark.sql.functions import col, to_timestamp, to_date, round, lower, trim, when
import os
import json

def clean_steam_data():
    """ทำความสะอาดข้อมูล Steam Dataset 2025 ด้วย PySpark"""
    
    # Initialize SparkSession
    spark = SparkSession.builder \
        .appName("Steam Data Cleaning") \
        .config("spark.sql.parquet.compression.codec", "snappy") \
        .getOrCreate()
        
    spark.sparkContext.setLogLevel("WARN")

    raw_dir = "/opt/airflow/data/raw"
    processed_dir = "/opt/airflow/data/processed"
    os.makedirs(processed_dir, exist_ok=True)

    # ========== Clean Reviews ==========
    reviews_path = os.path.join(raw_dir, "reviews.csv")
    cleaned_reviews_path = os.path.join(processed_dir, "cleaned_reviews.parquet")

    print(f"📥 Reading reviews.csv with PySpark...")
    
    # Read CSV with PySpark
    try:
        reviews_df = spark.read.csv(
            reviews_path,
            header=True,
            inferSchema=True,
            mode="DROPMALFORMED", # Drop rows with parsing errors
            multiLine=True, # For review text with newlines
            escape='"'
        )
        
        original_count = reviews_df.count()
        
        print(f"📥 Found {original_count:,} reviews. Processing all rows.")
        
        # 1. ลบ null ในคอลัมน์สำคัญ
        reviews_df = reviews_df.dropna(subset=["appid", "author_steamid", "voted_up", "timestamp_created"])

        # 2. แปลง voted_up เป็น boolean (is_positive)
        reviews_df = reviews_df.withColumn(
            "is_positive", 
            when(lower(trim(col("voted_up"))) == "true", True).otherwise(False)
        )

        # 3. แปลง timestamp_created เป็น review_date
        reviews_df = reviews_df.withColumn(
            "review_date",
            to_date(to_timestamp(col("timestamp_created")))
        )

        # 4. แปลง playtime เป็นชั่วโมง
        reviews_df = reviews_df.withColumn(
            "playtime_hours",
            round(col("author_playtime_forever") / 60, 1)
        )
        reviews_df = reviews_df.fillna({"playtime_hours": 0.0})

        # 5. ลบ duplicate
        reviews_df = reviews_df.dropDuplicates(["recommendationid"])

        # 6. ลบแถวที่ review_date เป็น null
        reviews_df = reviews_df.dropna(subset=["review_date"])

        # เลือกเฉพาะคอลัมน์ที่จำเป็น
        reviews_df = reviews_df.select(
            "recommendationid", "appid", "author_steamid",
            "playtime_hours", "author_playtime_at_review",
            "language", "review_text", "review_date",
            "is_positive", "votes_up", "votes_funny",
            "weighted_vote_score", "steam_purchase"
        )

        cleaned_count = reviews_df.count()
        
        # Write to Parquet
        reviews_df.write.mode("overwrite").parquet(cleaned_reviews_path)
        print(f"✅ Reviews cleaned: {original_count:,} → {cleaned_count:,} (removed {original_count - cleaned_count:,} invalid rows)")
        
    except Exception as e:
        print(f"❌ Error processing reviews: {str(e)}")

    # ========== Clean Applications ==========
    apps_path = os.path.join(raw_dir, "applications.csv")
    cleaned_apps_path = os.path.join(processed_dir, "cleaned_apps.parquet")

    print(f"📥 Reading applications.csv with PySpark...")
    
    try:
        apps_df = spark.read.csv(
            apps_path,
            header=True,
            inferSchema=True,
            mode="DROPMALFORMED",
            escape='"'
        )
        
        original_apps_count = apps_df.count()
        print(f"📥 Read {original_apps_count:,} applications")

        # 1. ลบ null
        apps_df = apps_df.dropna(subset=["appid", "name"])

        # 2. เลือกเฉพาะ type = 'game'
        apps_df = apps_df.filter(col("type") == "game")

        # 3. ลบชื่อว่าง
        apps_df = apps_df.filter(trim(col("name")) != "")

        # 4. ลบ duplicate
        apps_df = apps_df.dropDuplicates(["appid"])
        
        # เลือกคอลัมน์ที่จำเป็น
        apps_df = apps_df.select(
            "appid", "name", "type", "is_free", "release_date",
            "metacritic_score", "recommendations_total",
            "mat_final_price", "mat_currency"
        )

        cleaned_apps_count = apps_df.count()
        
        # Write to Parquet
        apps_df.write.mode("overwrite").parquet(cleaned_apps_path)
        print(f"✅ Applications cleaned: {original_apps_count:,} → {cleaned_apps_count:,} (removed {original_apps_count - cleaned_apps_count:,})")
        
        # Save error summary
        error_log = {
            "reviews_total_scanned": original_count,
            "reviews_processed_limit": original_count,
            "reviews_cleaned_count": cleaned_count,
            "reviews_dropped": original_count - cleaned_count,
            "apps_total": original_apps_count,
            "apps_cleaned": cleaned_apps_count,
            "apps_dropped": original_apps_count - cleaned_apps_count
        }
        
        with open(os.path.join(processed_dir, "data_quality_log.json"), "w") as f:
            json.dump(error_log, f, indent=4)
            
    except Exception as e:
        print(f"❌ Error processing applications: {str(e)}")

    spark.stop()

if __name__ == "__main__":
    clean_steam_data()
