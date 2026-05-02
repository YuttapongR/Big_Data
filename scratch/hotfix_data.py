import pandas as pd
import os

print("Starting Data Hotfix...")

csv_path = 'data/raw/applications.csv'
parq_path = 'data/processed/games_analytics.parquet'

if os.path.exists(csv_path) and os.path.exists(parq_path):
    # Pandas handles multi-line CSVs much better than the basic Spark setup
    csv_df = pd.read_csv(csv_path, low_memory=False)
    parq_df = pd.read_parquet(parq_path)

    # Ensure appid is numeric for matching
    csv_df['appid'] = pd.to_numeric(csv_df['appid'], errors='coerce')
    parq_df['appid'] = pd.to_numeric(parq_df['appid'], errors='coerce')

    # Correct mapping
    mapping = csv_df.dropna(subset=['appid']).drop_duplicates('appid').set_index('appid')[['mat_supports_windows', 'mat_supports_mac', 'mat_supports_linux']]
    
    for col in mapping.columns:
        parq_df[col] = parq_df['appid'].map(mapping[col])
        print(f"Updated {col} counts: \n{parq_df[col].value_counts()}")

    parq_df.to_parquet('data/processed/games_analytics_v2.parquet')
    print("Hotfix successful! Data has been saved to games_analytics_v2.parquet")
else:
    print("CSV or Parquet file not found.")
