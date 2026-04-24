from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import pandas as pd
import os
import json
import random
from datetime import datetime, timedelta

app = FastAPI(title="Steam Reviews Big Data Dashboard API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ใช้ Environment Variable แทน relative path เพื่อให้ทำงานได้ทั้งใน Docker และ Local
DATA_PATH = os.environ.get("DATA_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/daily_steam_reviews.parquet"))
TOP_GAMES_PATH = os.environ.get("TOP_GAMES_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/top_games.parquet"))
PIPELINE_STATUS_PATH = os.environ.get("PIPELINE_STATUS_PATH", os.path.join(os.path.dirname(__file__), "../../data/processed/.pipeline_status.json"))
SUMMARY_PATH = os.path.join(os.path.dirname(DATA_PATH), "summary.json")

# Resolve paths ให้เป็น absolute
DATA_PATH = os.path.abspath(DATA_PATH)
TOP_GAMES_PATH = os.path.abspath(TOP_GAMES_PATH)
PIPELINE_STATUS_PATH = os.path.abspath(PIPELINE_STATUS_PATH)


def get_mock_data():
    """สร้าง Mock Data ในกรณีที่ไฟล์ Parquet ยังไม่ถูกสร้างโดย Airflow"""
    today = datetime.now()
    data = []
    for i in range(30):
        date = (today - timedelta(days=29-i)).strftime("%Y-%m-%d")
        total = random.randint(3000, 12000)
        positive = random.randint(int(total * 0.6), int(total * 0.9))
        data.append({
            "review_date": date,
            "total_reviews": total,
            "positive_reviews": positive,
            "negative_reviews": total - positive,
            "avg_playtime_hours": round(random.uniform(5.0, 120.0), 1),
            "unique_games": random.randint(50, 200),
            "unique_reviewers": random.randint(2000, 10000),
        })
    return data


def get_mock_top_games():
    """สร้าง Mock Top Games Data"""
    games = [
        ("Counter-Strike", 10),
        ("Team Fortress 2", 440),
        ("Garry's Mod", 4000),
        ("Half-Life 2", 220),
        ("Dota 2", 570),
        ("Portal 2", 620),
        ("Left 4 Dead 2", 550),
        ("The Elder Scrolls V: Skyrim", 72850),
        ("Terraria", 105600),
        ("Stardew Valley", 413150),
    ]
    data = []
    for name, app_id in games:
        total = random.randint(50000, 500000)
        positive = random.randint(int(total * 0.6), int(total * 0.95))
        data.append({
            "app_id": app_id,
            "app_name": name,
            "total_reviews": total,
            "positive_reviews": positive,
            "negative_reviews": total - positive,
            "avg_playtime_hours": round(random.uniform(20.0, 500.0), 1),
        })
    data.sort(key=lambda x: x["total_reviews"], reverse=True)
    return data


@app.get("/api/dashboard-data")
async def get_dashboard_data():
    """ดึงข้อมูล Daily Reviews ที่ถูก Aggregate แล้วส่งไปแสดงบนเว็บ"""
    if os.path.exists(DATA_PATH):
        try:
            df = pd.read_parquet(DATA_PATH)
            # แปลงวันที่เป็นสตริงเพื่อให้ส่งเป็น JSON ได้
            if 'review_date' in df.columns:
                df['review_date'] = pd.to_datetime(df['review_date']).dt.strftime("%Y-%m-%d")
            df = df.sort_values('review_date').tail(30)
            df = df.fillna(0) # ป้องกัน NaN/Inf ที่ทำให้ JSON พัง
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

    mock = get_mock_data()
    summary = None
    if os.path.exists(SUMMARY_PATH):
        try:
            with open(SUMMARY_PATH, "r") as f:
                summary = json.load(f)
        except: pass
        
    return {"data": mock, "is_mock": True, "count": len(mock), "summary": summary}


@app.get("/api/top-games")
async def get_top_games():
    """ดึงข้อมูล Top Games ที่มีรีวิวมากที่สุด (เรียงด้วย recommendations_total จาก Steam)"""
    if os.path.exists(TOP_GAMES_PATH):
        try:
            df = pd.read_parquet(TOP_GAMES_PATH)
            sort_col = 'recommendations_total' if 'recommendations_total' in df.columns else 'total_reviews'
            df = df.sort_values(sort_col, ascending=False).head(10)
            df = df.fillna(0) # ป้องกัน NaN/Inf ที่ทำให้ JSON พัง
            records = df.to_dict(orient="records")
            return {"data": records, "is_mock": False, "count": len(records)}
        except Exception as e:
            print(f"Error reading top games parquet: {e}")

    mock = get_mock_top_games()
    return {"data": mock, "is_mock": True, "count": len(mock)}


@app.get("/api/pipeline-status")
async def get_pipeline_status():
    """ดึงสถานะของ Pipeline ล่าสุดที่ถูกเขียนโดย Airflow DAG"""
    if os.path.exists(PIPELINE_STATUS_PATH):
        try:
            with open(PIPELINE_STATUS_PATH, "r") as f:
                status = json.load(f)
            return status
        except Exception as e:
            return {"status": "unknown", "error": str(e)}
    return {
        "status": "waiting",
        "message": "No pipeline has been run yet.",
        "last_run": None
    }


@app.get("/api/health")
async def health_check():
    """Health check endpoint สำหรับ Docker / Monitoring"""
    data_exists = os.path.exists(DATA_PATH)
    return {
        "status": "healthy",
        "data_available": data_exists,
        "data_path": DATA_PATH,
        "timestamp": datetime.now().isoformat()
    }


# ===== Serve Frontend =====
# สำคัญ: ต้องประกาศ API routes ก่อน mount static files
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
frontend_path = os.path.abspath(frontend_path)


@app.get("/")
async def serve_frontend():
    """เสิร์ฟหน้าเว็บ Frontend"""
    return FileResponse(os.path.join(frontend_path, "index.html"))


# Mount static files หลังจากประกาศ routes ทั้งหมดแล้ว
app.mount("/static", StaticFiles(directory=frontend_path), name="static")


if __name__ == "__main__":
    import uvicorn
    print(f"🎮 Steam Reviews Dashboard starting...")
    print(f"   Data Path: {DATA_PATH}")
    print(f"   Top Games Path: {TOP_GAMES_PATH}")
    print(f"   Pipeline Status Path: {PIPELINE_STATUS_PATH}")
    print(f"   Frontend Path: {frontend_path}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
