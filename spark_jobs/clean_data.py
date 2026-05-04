from pyspark.sql import SparkSession
from pyspark.sql.functions import col, to_timestamp, to_date, round, lower, trim, when
import os
import json

def get_size_mb(path):
    """คำนวณขนาดไฟล์หรือโฟลเดอร์ในหน่วย MB"""
    if not os.path.exists(path):
        return 0
    if os.path.isfile(path):
        # Use Python built-in round to avoid conflict with pyspark.sql.functions.round
        return __builtins__.round(os.path.getsize(path) / (1024 * 1024), 2)
    
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if not os.path.islink(fp):
                total_size += os.path.getsize(fp)
    return __builtins__.round(total_size / (1024 * 1024), 2)

def clean_steam_data():
    """ทำความสะอาดข้อมูล Steam Dataset 2025 ด้วย PySpark"""
    
    # Initialize SparkSession
    spark = SparkSession.builder \
        .appName("Steam Data Cleaning") \
        .config("spark.sql.parquet.compression.codec", "snappy") \
        .getOrCreate()
        
    spark.sparkContext.setLogLevel("WARN")

    # ปรับพาธให้เป็น relative เพื่อให้ใช้งานได้ทั้งบน Local และ Docker
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    raw_dir = os.path.join(base_dir, "data", "raw")
    processed_dir = os.path.join(base_dir, "data", "processed")
    os.makedirs(processed_dir, exist_ok=True)

    # ========== Clean Reviews ==========
    reviews_path = os.path.join(raw_dir, "reviews.csv")
    cleaned_reviews_path = os.path.join(processed_dir, "cleaned_reviews.parquet")
    
    reviews_raw_size = get_size_mb(reviews_path)
    print(f"Reviews raw size: {reviews_raw_size} MB")

    print(f"Reading reviews.csv with PySpark...")
    
    # Read CSV with PySpark
    try:
        reviews_df = spark.read.csv(
            reviews_path, 
            header=True, # บรรทัดแรกของไฟล์คือชื่อคอลัมน์ ไม่ใช่ข้อมูล
            inferSchema=True, # สั่งให้ Spark เดาประเภทข้อมูล ให้โดยอัตโนมัติ (เช่น คอลัมน์ไหนเป็นตัวเลข คอลัมน์ไหนเป็นข้อความ หรือค่าความจริง)
            mode="DROPMALFORMED", # เป็นโหมดจัดการข้อมูลที่ผิดพลาด (Parsing errors) โดยถ้าเจอแถวไหนที่ รูปแบบเสียหรืออ่านไม่ได้
            multiLine=True, #   เพราะข้อความรีวิวเกมมักจะมีการขึ้นบรรทัดใหม่ (Newline) ภายในข้อความเดียว
            escape='"'
        )
        
        original_count = reviews_df.count()
        
        print(f"Found {original_count:,} reviews. Processing all rows.")
        
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
        reviews_cleaned_size = get_size_mb(cleaned_reviews_path)
        print(f"Reviews cleaned: {original_count:,} → {cleaned_count:,} (removed {original_count - cleaned_count:,} invalid rows)")
        print(f"Reviews cleaned size: {reviews_cleaned_size} MB")
        
    except Exception as e:
        print(f"Error processing reviews: {str(e)}")
        cleaned_count = 0
        reviews_cleaned_size = 0

    # ========== Clean Applications ==========
    apps_path = os.path.join(raw_dir, "applications.csv")
    cleaned_apps_path = os.path.join(processed_dir, "cleaned_apps.parquet")

    apps_raw_size = get_size_mb(apps_path)
    print(f"Apps raw size: {apps_raw_size} MB")

    print(f"Reading applications.csv with PySpark...")
    
    try:
        apps_df = spark.read.csv(
            apps_path,
            header=True,
            inferSchema=True,
            mode="DROPMALFORMED",
            escape='"',
            multiLine=True
        )
        
        original_apps_count = apps_df.count()
        print(f"Read {original_apps_count:,} applications")

        # 1. ลบ null
        apps_df = apps_df.dropna(subset=["appid", "name"])

        # 2. เลือกเฉพาะ type = 'game'
        apps_df = apps_df.filter(col("type") == "game")

        # 3. ลบชื่อว่าง
        apps_df = apps_df.filter(trim(col("name")) != "")

        # 4. ลบ duplicate
        apps_df = apps_df.dropDuplicates(["appid"])

        # 5. แปลงประเภทข้อมูลให้ถูกต้อง
        from pyspark.sql.types import IntegerType
        apps_df = apps_df.withColumn("recommendations_total", col("recommendations_total").cast(IntegerType()))
        apps_df = apps_df.fillna({"recommendations_total": 0})
        
        # เลือกคอลัมน์ที่จำเป็น
        apps_df = apps_df.select(
            "appid", "name", "type", "is_free", "release_date",
            "metacritic_score", "recommendations_total",
            "mat_final_price", "mat_currency",
            "supported_languages", "mat_achievement_count"
        )

        cleaned_apps_count = apps_df.count()
        
        # Write to Parquet
        apps_df.write.mode("overwrite").parquet(cleaned_apps_path)
        apps_cleaned_size = get_size_mb(cleaned_apps_path)
        print(f"Applications cleaned: {original_apps_count:,} → {cleaned_apps_count:,} (removed {original_apps_count - cleaned_apps_count:,})")
        print(f"Apps cleaned size: {apps_cleaned_size} MB")
        
        # Save error summary
        error_log = {
            "reviews_total_scanned": original_count if 'original_count' in locals() else 0, 
            "reviews_processed_limit": original_count if 'original_count' in locals() else 0, 
            "reviews_cleaned_count": cleaned_count if 'cleaned_count' in locals() else 0, 
            "reviews_dropped": (original_count - cleaned_count) if 'original_count' in locals() and 'cleaned_count' in locals() else 0,
            "reviews_raw_size_mb": reviews_raw_size,
            "reviews_cleaned_size_mb": reviews_cleaned_size if 'reviews_cleaned_size' in locals() else 0,
            "apps_total": original_apps_count, 
            "apps_cleaned": cleaned_apps_count, 
            "apps_dropped": original_apps_count - cleaned_apps_count,
            "apps_raw_size_mb": apps_raw_size,
            "apps_cleaned_size_mb": apps_cleaned_size
        }
        
        with open(os.path.join(processed_dir, "data_quality_log.json"), "w") as f:
            json.dump(error_log, f, indent=4)
            
    except Exception as e:
        print(f"Error processing applications: {str(e)}")

    spark.stop()

if __name__ == "__main__":
    clean_steam_data()
