from pyspark.sql import SparkSession
import time
import os

def benchmark_format_performance():
    spark = SparkSession.builder \
        .appName("Format Benchmark") \
        .getOrCreate()
    
    spark.sparkContext.setLogLevel("ERROR")
    
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    csv_path = os.path.join(base_dir, "data", "raw", "reviews.csv")
    parquet_path = os.path.join(base_dir, "data", "processed", "cleaned_reviews.parquet")
    
    print("-" * 50)
    print(f"{'Data Format':<15} | {'Read Time (seconds)':<20}")
    print("-" * 50)
    
    # Benchmark CSV
    if os.path.exists(csv_path):
        start_time = time.time()
        # Loading CSV with full options to match current pipeline
        df_csv = spark.read.csv(csv_path, header=True, inferSchema=True, multiLine=True, escape='"')
        csv_count = df_csv.count()
        csv_duration = time.time() - start_time
        print(f"{'CSV':<15} | {csv_duration:<20.2f} (Rows: {csv_count:,})")
    else:
        print("CSV file not found.")
        csv_duration = None

    # Benchmark Parquet
    if os.path.exists(parquet_path):
        start_time = time.time()
        df_parquet = spark.read.parquet(parquet_path)
        parquet_count = df_parquet.count()
        parquet_duration = time.time() - start_time
        print(f"{'Parquet':<15} | {parquet_duration:<20.2f} (Rows: {parquet_count:,})")
    else:
        print("Parquet file not found.")
        parquet_duration = None

    if csv_duration and parquet_duration:
        diff = csv_duration - parquet_duration
        speedup = csv_duration / parquet_duration if parquet_duration > 0 else 0
        print("-" * 50)
        print(f"Parquet is {diff:.2f} seconds faster than CSV.")
        print(f"Performance Speedup: {speedup:.1f}x faster")
        print("-" * 50)

    spark.stop()

if __name__ == "__main__":
    benchmark_format_performance()
