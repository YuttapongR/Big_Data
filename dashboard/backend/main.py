from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from typing import Optional
import pandas as pd
import os
import json
from datetime import datetime

app = FastAPI(title="Steam Reviews Big Data Dashboard API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
DATA_PATH = os.environ.get("DATA_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/daily_steam_reviews.parquet"))
TOP_GAMES_PATH = os.environ.get("TOP_GAMES_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/top_games.parquet"))
PIPELINE_STATUS_PATH = os.environ.get("PIPELINE_STATUS_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/.pipeline_status.json"))
SUMMARY_PATH = os.path.join(os.path.dirname(DATA_PATH), "summary.json")
DATA_QUALITY_PATH = os.path.join(os.path.dirname(DATA_PATH), "data_quality_log.json")

# Resolve paths
DATA_PATH = os.path.abspath(DATA_PATH)
TOP_GAMES_PATH = os.path.abspath(TOP_GAMES_PATH)
PIPELINE_STATUS_PATH = os.path.abspath(PIPELINE_STATUS_PATH)
SUMMARY_PATH = os.path.abspath(SUMMARY_PATH)
DATA_QUALITY_PATH = os.path.abspath(DATA_QUALITY_PATH)

@app.get("/api/dashboard-data")
async def get_dashboard_data(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """ดึงข้อมูล Daily Reviews แบบมี Filter วันที่"""
    if os.path.exists(DATA_PATH):
        try:
            df = pd.read_parquet(DATA_PATH)
            
            if 'review_date' in df.columns:
                # Ensure it's string for filtering
                df['review_date'] = df['review_date'].astype(str)
                
            # Filter by date if provided
            if start_date:
                df = df[df['review_date'] >= start_date]
            if end_date:
                df = df[df['review_date'] <= end_date]
                
            # If no filters, return last 90 days to show more data
            if not start_date and not end_date:
                df = df.sort_values('review_date').tail(90)
                
            df = df.fillna(0)
            records = df.to_dict(orient="records")
            
            summary = None
            if os.path.exists(SUMMARY_PATH):
                try:
                    with open(SUMMARY_PATH, "r") as f:
                        summary = json.load(f)
                except: pass
                
            return {"data": records, "is_mock": False, "count": len(records), "summary": summary}
        except Exception as e:
            print(f"Error reading parquet: {e}")

    # Return empty data if no real data found
    return {"data": [], "is_mock": False, "count": 0, "summary": None}

@app.get("/api/top-games")
async def get_top_games(search: Optional[str] = None, limit: int = Query(50, le=100)):
    """ดึงข้อมูล Top Games และกรองด้วยการค้นหาชื่อ"""
    if os.path.exists(TOP_GAMES_PATH):
        try:
            df = pd.read_parquet(TOP_GAMES_PATH)
            
            if search:
                df = df[df['name'].str.contains(search, case=False, na=False)]
                
            sort_col = 'recommendations_total' if 'recommendations_total' in df.columns else 'total_reviews'
            df = df.sort_values(sort_col, ascending=False).head(limit)
            df = df.fillna(0)
            records = df.to_dict(orient="records")
            return {"data": records, "is_mock": False, "count": len(records)}
        except Exception as e:
            print(f"Error reading top games parquet: {e}")

    return {"data": [], "is_mock": False, "count": 0}

@app.get("/api/data-quality")
async def get_data_quality():
    """ดึงข้อมูล Quality log ที่ PySpark สรุปไว้ตอน Clean"""
    if os.path.exists(DATA_QUALITY_PATH):
        try:
            with open(DATA_QUALITY_PATH, "r") as f:
                log = json.load(f)
            return {"data": log, "is_mock": False}
        except Exception as e:
            pass
            
    return {"data": {
        "reviews_total_scanned": 0,
        "reviews_processed_limit": 0,
        "reviews_cleaned_count": 0,
        "reviews_dropped": 0,
        "apps_total": 0,
        "apps_cleaned": 0,
        "apps_dropped": 0
    }, "is_mock": False}

@app.get("/api/pipeline-status")
async def get_pipeline_status():
    if os.path.exists(PIPELINE_STATUS_PATH):
        try:
            with open(PIPELINE_STATUS_PATH, "r") as f:
                status = json.load(f)
            return status
        except Exception as e:
            return {"status": "unknown", "error": str(e)}
    return {
        "status": "waiting",
        "message": "No pipeline has been run yet. Waiting for PySpark job to finish processing raw data.",
        "last_run": None
    }

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "data_available": os.path.exists(DATA_PATH),
        "timestamp": datetime.now().isoformat()
    }

# ===== Serve Frontend =====
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
frontend_path = os.path.abspath(frontend_path)

@app.get("/")
async def serve_frontend():
    return FileResponse(os.path.join(frontend_path, "index.html"))

app.mount("/static", StaticFiles(directory=frontend_path), name="static")

if __name__ == "__main__":
    import uvicorn
    print(f"🎮 Steam Reviews Dashboard starting...")
    uvicorn.run(app, host="0.0.0.0", port=8000)
