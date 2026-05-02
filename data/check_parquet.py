import pandas as pd
df = pd.read_parquet('/opt/airflow/data/processed/top_games.parquet')
print("Columns:", df.columns.tolist())
print("\nTop 5 games:")
cols = [c for c in ['name','total_reviews','recommendations_total','positive_rate'] if c in df.columns]
print(df.head(5)[cols].to_string())
