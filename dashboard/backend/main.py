from fastapi import FastAPI, Query, Response
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
PIPELINE_STATUS_PATH = os.environ.get("PIPELINE_STATUS_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/.pipeline_status.json"))
SUMMARY_PATH = os.path.join(os.path.dirname(DATA_PATH), "summary.json")
DATA_QUALITY_PATH = os.path.join(os.path.dirname(DATA_PATH), "data_quality_log.json")
COMMON_WORDS_PATH = os.environ.get("COMMON_WORDS_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/common_words.parquet"))

# Resolve paths
DATA_PATH = os.path.abspath(DATA_PATH)
PIPELINE_STATUS_PATH = os.path.abspath(PIPELINE_STATUS_PATH)
SUMMARY_PATH = os.path.abspath(SUMMARY_PATH)
DATA_QUALITY_PATH = os.path.abspath(DATA_QUALITY_PATH)
COMMON_WORDS_PATH = os.path.abspath(COMMON_WORDS_PATH)

@app.get("/api/dashboard-data")
async def get_dashboard_data():
    """ดึงข้อมูล Daily Reviews แบบมี Filter วันที่"""
    if os.path.exists(DATA_PATH):
        try:
            df = pd.read_parquet(DATA_PATH)
            
            if 'review_date' in df.columns:
                # Ensure it's string for filtering
                df['review_date'] = df['review_date'].astype(str)
                
            # Always return last 90 days of trends by default
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

@app.get("/api/common-words")
async def get_common_words():
    """ดึงข้อมูลคำยอดนิยมที่พบในรีวิว"""
    if os.path.exists(COMMON_WORDS_PATH):
        try:
            df = pd.read_parquet(COMMON_WORDS_PATH)
            records = df.to_dict(orient="records")
            return {"data": records, "is_mock": False}
        except Exception as e:
            print(f"Error reading common words parquet: {e}")

    return {"data": [], "is_mock": False}

@app.get("/api/games-analytics")
async def get_games_analytics(
    genre: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    year: Optional[int] = None
):
    """ดึงข้อมูลเกมสำหรับ Dashboard กราฟทั้งหมด (มี Slicers)"""
    analytics_path = os.path.abspath(os.environ.get("GAMES_ANALYTICS_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/games_analytics.parquet")))
    if os.path.exists(analytics_path):
        try:
            df = pd.read_parquet(analytics_path)
            
            if genre and genre != 'All':
                df = df[df['genre'] == genre]
            if min_price is not None:
                df = df[df['price'] >= min_price]
            if max_price is not None:
                df = df[df['price'] <= max_price]
            if year and year != 'All':
                df = df[df['release_year'] == int(year)]
                
            df = df.fillna(0)
            records = df.to_dict(orient="records")
            return {"data": records, "is_mock": False, "count": len(records)}
        except Exception as e:
            print(f"Error reading games analytics parquet: {e}")

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
async def get_pipeline_status(response: Response):
    # ป้องกัน Browser Cache เพื่อให้อ่านสถานะล่าสุดทุกครั้ง
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    response.headers["Pragma"] = "no-cache"

    if os.path.exists(PIPELINE_STATUS_PATH):
        try:
            with open(PIPELINE_STATUS_PATH, "r") as f:
                status = json.load(f)
            
            # ตรวจสอบความสดใหม่ของข้อมูล (Freshness Check)
            if "last_run" in status and status["last_run"]:
                try:
                    last_run_time = datetime.fromisoformat(status["last_run"])
                    # ถ้าผ่านไปเกิน 24 ชั่วโมง (86400 วินาที)
                    if (datetime.now() - last_run_time).total_seconds() > 86400:
                        status["status"] = "outdated"
                        status["message"] = "ข้อมูลเริ่มเก่าแล้ว (ไม่ได้อัปเดตเกิน 24 ชม.)"
                except: pass

            return status
        except Exception as e:
            return {"status": "unknown", "error": str(e)}
    return {
        "status": "waiting",
        "message": "ยังไม่มีการรัน Pipeline รอการประมวลผลจาก Spark...",
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
