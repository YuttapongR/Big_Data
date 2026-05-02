import pandas as pd
import os

print("Starting Data Hotfix (Smart OS Inference)...")

csv_path = 'data/raw/applications.csv'
parq_path = 'data/processed/games_analytics.parquet'
output_path = 'data/processed/games_analytics_v3.parquet' # Use V3 to avoid lock

if os.path.exists(csv_path) and os.path.exists(parq_path):
    csv_df = pd.read_csv(csv_path, low_memory=False)
    parq_df = pd.read_parquet(parq_path)

    # Ensure appid is numeric
    csv_df['appid'] = pd.to_numeric(csv_df['appid'], errors='coerce')
    parq_df['appid'] = pd.to_numeric(parq_df['appid'], errors='coerce')

    # Mapping with smart inference
    # If the boolean column is True but the 'mat_pc_os_min' doesn't mention Mac/Linux, we mark as False
    csv_df['mat_pc_os_min'] = csv_df['mat_pc_os_min'].fillna('').astype(str).str.lower()
    
    csv_df['mat_supports_mac_fixed'] = csv_df.apply(
        lambda x: True if ('mac' in x['mat_pc_os_min'] or 'osx' in x['mat_pc_os_min']) else False, axis=1
    )
    csv_df['mat_supports_linux_fixed'] = csv_df.apply(
        lambda x: True if ('linux' in x['mat_pc_os_min'] or 'ubuntu' in x['mat_pc_os_min'] or 'steamos' in x['mat_pc_os_min']) else False, axis=1
    )

    mapping_mac = csv_df.dropna(subset=['appid']).drop_duplicates('appid').set_index('appid')['mat_supports_mac_fixed']
    mapping_lin = csv_df.dropna(subset=['appid']).drop_duplicates('appid').set_index('appid')['mat_supports_linux_fixed']
    
    parq_df['mat_supports_mac'] = parq_df['appid'].map(mapping_mac)
    parq_df['mat_supports_linux'] = parq_df['appid'].map(mapping_lin)
    
    # Windows is usually correct or always True for Steam
    parq_df['mat_supports_windows'] = True

    print(f"Updated Mac counts: \n{parq_df['mat_supports_mac'].value_counts()}")
    print(f"Updated Linux counts: \n{parq_df['mat_supports_linux'].value_counts()}")

    parq_df.to_parquet(output_path)
    print(f"Hotfix successful! Saved to {output_path}")
else:
    print("Files not found.")
