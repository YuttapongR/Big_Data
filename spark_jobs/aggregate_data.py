from pyspark.sql import SparkSession
from pyspark.sql.functions import col, count, sum as _sum, mean, countDistinct, round, first, date_format, lower, regexp_replace, explode, split, length
from pyspark.ml.feature import StopWordsRemover
import os
from datetime import datetime
import json

def aggregate_steam_data():
    """Aggregate ข้อมูล Steam Dataset 2025 ด้วย PySpark"""

    # เริ่มต้น SparkSession พร้อมตั้งค่าหน่วยความจำและการจัดการไฟล์ Parquet
    spark = SparkSession.builder \
        .appName("Steam Data Aggregation") \
        .config("spark.sql.parquet.compression.codec", "snappy") \
        .config("spark.driver.memory", "2g") \
        .config("spark.executor.memory", "2g") \
        .config("spark.sql.shuffle.partitions", "10") \
        .getOrCreate()
        
    spark.sparkContext.setLogLevel("WARN")

    # กำหนด Path สำหรับโหลดและบันทึกข้อมูล
    processed_dir = "/opt/airflow/data/processed"
    cleaned_reviews_path = os.path.join(processed_dir, "cleaned_reviews.parquet")
    cleaned_apps_path = os.path.join(processed_dir, "cleaned_apps.parquet")
    daily_data_path = os.path.join(processed_dir, "daily_steam_reviews.parquet")
    top_games_path = os.path.join(processed_dir, "top_games.parquet")

    print("📥 Reading cleaned data with PySpark...")
    
    try:
        # อ่านข้อมูลจากไฟล์ Parquet ที่เตรียมไว้ และใช้ Cache เพื่อลดเวลาโหลดซ้ำ
        reviews_df = spark.read.parquet(cleaned_reviews_path)
        apps_df = spark.read.parquet(cleaned_apps_path)
        
        reviews_df.cache()
        apps_df.cache()
        
        total_reviews = reviews_df.count()
        total_apps = apps_df.count()
        print(f"📥 {total_reviews:,} reviews, {total_apps:,} apps")

        # ===== 1. สรุปผลรีวิวรายวัน (Daily Summary) =====
        print("⏳ Aggregating daily summary...")
        daily_df = reviews_df.groupBy("review_date").agg(
            count("recommendationid").alias("total_reviews"),
            _sum(col("is_positive").cast("int")).alias("positive_reviews"),
            round(mean("playtime_hours"), 1).alias("avg_playtime_hours"),
            countDistinct("appid").alias("unique_games"),
            countDistinct("author_steamid").alias("unique_reviewers")
        )

        # คำนวณจำนวนรีวิวเชิงลบ และเรียงตามลำดับวันที่
        daily_df = daily_df.withColumn(
            "negative_reviews", col("total_reviews") - col("positive_reviews")
        )
        
        daily_df = daily_df.orderBy("review_date")

        # แปลง review_date เป็น string เพื่อให้ส่งเป็น JSON ได้ง่าย (ใน Python)
        daily_df = daily_df.withColumn("review_date", date_format(col("review_date"), "yyyy-MM-dd"))

        daily_count = daily_df.count()
        # บันทึกผลรายวันเป็นไฟล์เดียวเพื่อให้ Backend อ่านง่าย
        daily_df.coalesce(1).write.mode("overwrite").parquet(daily_data_path)
        print(f"✅ Daily aggregation: {daily_count} rows → {daily_data_path}")

        # ===== 2. สรุปผลเกมยอดนิยม (Top Games) =====
        print("⏳ Aggregating top games...")
        apps_selected = apps_df.select(
            "appid", "name", "is_free", "metacritic_score", 
            "mat_final_price", "recommendations_total"
        )
        
        # เชื่อมข้อมูลรีวิวกับข้อมูลแอป (App Name, Price)
        reviews_with_names = reviews_df.join(apps_selected, on="appid", how="inner")

        # จัดกลุ่มรายเกมเพื่อหาค่าเฉลี่ยและยอดแนะนำรวม
        top_games_df = reviews_with_names.groupBy("appid", "name").agg(
            count("recommendationid").alias("total_reviews"),
            _sum(col("is_positive").cast("int")).alias("positive_reviews"),
            round(mean("playtime_hours"), 1).alias("avg_playtime_hours"),
            countDistinct("author_steamid").alias("unique_reviewers"),
            first("recommendations_total").alias("recommendations_total"),
            first("metacritic_score").alias("metacritic_score"),
            first("mat_final_price").alias("price")
        )

        top_games_df = top_games_df.withColumn(
            "negative_reviews", col("total_reviews") - col("positive_reviews")
        )
        
        top_games_df = top_games_df.withColumn(
            "positive_rate", 
            round((col("positive_reviews") / col("total_reviews")) * 100, 1)
        )

        # กรองเฉพาะที่มีชื่อเกม + เรียงด้วย recommendations_total 
        top_games_df = top_games_df.filter(col("name").isNotNull())
        top_games_df = top_games_df.orderBy(col("recommendations_total").desc()).limit(50)

        top_games_count = top_games_df.count()
        top_games_df.coalesce(1).write.mode("overwrite").parquet(top_games_path)
        print(f"✅ Top games: {top_games_count} rows → {top_games_path}")


        # ===== วิเคราะห์คำยอดฮิตจากรีวิว (NLP Keywords) =====
        print("⏳ Extracting common words from reviews...")
        # ทำความสะอาดรีวิวเบื้องต้นเพื่อสกัดคำ (Tokenization)
        words_df = reviews_df.filter(col("review_text").isNotNull()) \
            .withColumn("text", lower(col("review_text"))) \
            .withColumn("text", regexp_replace(col("text"), "[^a-z0-9 ]", " ")) \
            .withColumn("words", split(col("text"), "\\s+"))
        
        # ลบคำฟุ่มเฟือย (Stop Words) เช่น 'the', 'a', 'is' ออก
        remover = StopWordsRemover(inputCol="words", outputCol="filtered")
        words_df = remover.transform(words_df)
        
        # นับจำนวนคำที่พบมากที่สุด 30 อันดับแรก
        keywords_df = words_df.withColumn("word", explode(col("filtered"))) \
            .filter(length(col("word")) > 3) \
            .groupBy("word") \
            .count() \
            .orderBy(col("count").desc()) \
            .limit(30)

        keywords_count = keywords_df.count()
        keywords_path = os.path.join(processed_dir, "common_words.parquet")
        keywords_df.coalesce(1).write.mode("overwrite").parquet(keywords_path)
        print(f"✅ Common words: {keywords_count} words extracted → {keywords_path}")

        # ===== สรุปข้อมูลสำหรับ Dashboard (Slicers & Charts) =====
        print("⏳ Aggregating games analytics for dashboard...")
        # ดึงหมวดหมู่เกม (Genres) มาเชื่อมโยงกับ AppID
        try:
            raw_dir = "/opt/airflow/data/raw"
            app_genres_df = spark.read.csv(os.path.join(raw_dir, "application_genres.csv"), header=True, inferSchema=True)
            genres_name_df = spark.read.csv(os.path.join(raw_dir, "genres.csv"), header=True, inferSchema=True)
            first_genre_df = app_genres_df.join(genres_name_df, app_genres_df.genre_id == genres_name_df.id, "inner") \
                .groupBy("appid").agg(first("name").alias("genre"))
        except Exception as e:
            print(f"Warning: Could not read genre data: {e}")
            from pyspark.sql.functions import lit
            first_genre_df = apps_df.select("appid").withColumn("genre", lit("Unknown"))

        # รวมข้อมูลแอปและยอดรีวิวสะสมรายเกม
        analytics_apps = apps_df.select(
            "appid", "name", "release_date", "mat_final_price", "recommendations_total", "metacritic_score",
            "supported_languages",
            "mat_achievement_count", "mat_pc_os_min"
        )
        
        analytics_apps = analytics_apps.join(first_genre_df, "appid", "left")
            
        app_reviews_agg = reviews_df.groupBy("appid").agg(
            count("recommendationid").alias("total_reviews"),
            _sum(col("is_positive").cast("int")).alias("positive_reviews"),
            round(mean("playtime_hours"), 1).alias("avg_playtime_hours")
        )
        
        analytics_df = analytics_apps.join(app_reviews_agg, "appid", "inner")
        
        from pyspark.sql.functions import year, coalesce, size, lit
        
        # คำนวณ Metrics เชิงธุรกิจ: ปีที่ออกขาย, อัตราความชอบ, รายได้โดยประมาณ, และจำนวนภาษา
        analytics_df = analytics_df.withColumn("release_year", year("release_date"))
        analytics_df = analytics_df.withColumn("positive_rate", round((col("positive_reviews") / col("total_reviews")) * 100, 1))
        analytics_df = analytics_df.withColumn("price", coalesce(col("mat_final_price"), lit(0.0)))
        analytics_df = analytics_df.withColumn("estimated_revenue", col("price") * col("total_reviews") * 30)
        analytics_df = analytics_df.withColumn("language_count", size(split(col("supported_languages"), ",")))
        
        # หมายเหตุ: ข้อมูล OS Support ถูกถอดออกเนื่องจากเปลี่ยนไปวิเคราะห์สัดส่วนเกมฟรี/จ่ายเงินแทน
        # Windows is usually the baseline

        
        analytics_df = analytics_df.orderBy(col("total_reviews").desc()).limit(5000)
        
        analytics_path = os.path.join(processed_dir, "games_analytics.parquet")
        analytics_df.coalesce(1).write.mode("overwrite").parquet(analytics_path)
        print(f"✅ Games analytics: 5000 rows → {analytics_path}")

        # ===== สรุปภาพรวมระดับ Global (KPIs) =====
        print("⏳ Generating global summary...")
        # คำนวณยอดสรุปเพื่อแสดงผลเป็นตัวเลข KPI หน้า Dashboard
        positive_count = reviews_df.filter(col("is_positive") == True).count()
        positive_rate = float(f"{(positive_count / total_reviews) * 100:.1f}") if total_reviews > 0 else 0.0
        unique_reviewers = reviews_df.select("author_steamid").distinct().count()

        summary = {
            "total_reviews": int(total_reviews),
            "total_games": int(total_apps),
            "positive_rate": float(positive_rate),
            "unique_reviewers": int(unique_reviewers),
            "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        summary_path = os.path.join(processed_dir, "summary.json")
        with open(summary_path, "w") as f:
            json.dump(summary, f)
        print(f"✅ Global summary: {summary_path}")

    except Exception as e:
        print(f"❌ Error during aggregation: {str(e)}")
        
    finally:
        spark.stop()

if __name__ == "__main__":
    aggregate_steam_data()
