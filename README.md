# 🎮 Steam Big Data Pipeline

โปรเจกต์นี้เป็นระบบ Big Data Pipeline ครบวงจร ใช้ข้อมูล [Steam Dataset 2025: Multi-Modal Gaming Analytics](https://www.kaggle.com/datasets/crainbramp/steam-dataset-2025-multi-modal-gaming-analytics) จาก Kaggle (~239K เกม, ~1M+ รีวิว, ~870MB)  
ประมวลผลด้วย **PySpark**, ควบคุมขั้นตอนด้วย **Apache Airflow**, และแสดงผลบน **Web Dashboard** ที่อัปเดตแบบ Real-time

---

## 🛠️ Tech Stack
| Layer | Technology |
|-------|-----------|
| Data Processing | PySpark 3.5 |
| Orchestration | Apache Airflow 2.9 (Docker) |
| Backend API | FastAPI + Uvicorn |
| Frontend | HTML / CSS / JS + Chart.js |
| Database | PostgreSQL 13 |
| Container | Docker Compose |

---

## 📁 โครงสร้างโฟลเดอร์

```
Big_Data/
├── docker-compose.yml      # ✅ ไฟล์หลักสำหรับรัน Airflow + Dashboard + DB
├── .env                    # ✅ ค่า config ของระบบ (Airflow UID, passwords)
├── requirements.txt        # Python dependencies สำหรับรัน local
├── README.md
│
├── dags/                   # Airflow DAGs (ควบคุมลำดับ Pipeline)
│   └── pipeline_dag.py
│
├── spark_jobs/             # PySpark scripts (ประมวลผลข้อมูล)
│   ├── clean_data.py       #   - ทำความสะอาดข้อมูล Steam Reviews
│   └── aggregate_data.py   #   - หาค่ายอดรวมรายวัน + Top Games
│
├── dashboard/              # ระบบ Dashboard (Web Application)
│   ├── Dockerfile          #   - Docker image สำหรับ Dashboard
│   ├── backend/            #   - FastAPI server + API endpoints
│   │   ├── main.py
│   │   └── requirements.txt
│   └── frontend/           #   - หน้าเว็บ HTML/CSS/JS
│       ├── index.html
│       ├── style.css
│       └── app.js
│
└── data/                   # ข้อมูล (mount เข้า Docker)
    ├── raw/                #   - วางไฟล์ CSV ทั้งหมดจาก Kaggle ที่นี่
    │   ├── reviews.csv     #     (~670MB, ~1M+ reviews)
    │   ├── applications.csv #    (~180MB, ~239K games)
    │   └── ...             #     (genres, developers, publishers, etc.)
    └── processed/          #   - ผลลัพธ์จาก PySpark จะอยู่ที่นี่ (Parquet)
```

---

## 🚀 วิธีรันโปรเจกต์

### ขั้นตอนที่ 1: เตรียมระบบ
- ติดตั้ง **Docker Desktop** และเปิดใช้งาน
- ดาวน์โหลดข้อมูลจาก Kaggle: [Steam Dataset 2025](https://www.kaggle.com/datasets/crainbramp/steam-dataset-2025-multi-modal-gaming-analytics) แตก zip แล้ววางไฟล์ `.csv` ทั้งหมดใน `data/raw/`

### ขั้นตอนที่ 2: รันระบบทั้งหมดด้วย Docker
```powershell
cd c:\Users\sub\Desktop\Big_Data

# เตรียมระบบ Airflow (ครั้งแรกเท่านั้น)
docker compose up airflow-init

# รันทุกอย่าง (Airflow + Dashboard + Database)
docker compose up -d
```

### ขั้นตอนที่ 3: เข้าใช้งาน
| Service | URL | Username | Password |
|---------|-----|----------|----------|
| **Dashboard** | http://localhost:8000 | - | - |
| **Airflow** | http://localhost:8080 | airflow | airflow |

### ขั้นตอนที่ 4: สั่ง Pipeline
1. เข้า Airflow UI → เปิด (Unpause) DAG `steam_reviews_bigdata_pipeline`
2. กด "Trigger DAG" เพื่อรัน Pipeline ทันที
3. Pipeline จะรัน: **Clean Data → Aggregate Data → Notify Dashboard**
4. เมื่อเสร็จ Dashboard จะอัปเดตข้อมูลอัตโนมัติ

---

## 🖥️ รัน Dashboard แบบ Local (ไม่ใช้ Docker)
```powershell
cd c:\Users\sub\Desktop\Big_Data
pip install -r requirements.txt
cd dashboard\backend
python main.py
```
เปิด browser ไปที่ http://localhost:8000 (จะแสดง Mock Data ถ้ายังไม่มีข้อมูลจริง)

---

## 🔗 การเชื่อมต่อ Airflow ↔ Dashboard
- Airflow รัน PySpark แล้วบันทึกผลลัพธ์ลง `data/processed/` (Parquet files)
- Airflow เขียนสถานะ Pipeline ลง `data/processed/.pipeline_status.json`
- Dashboard อ่านไฟล์ Parquet จาก `data/processed/` ผ่าน API
- Dashboard ดึงสถานะ Pipeline จาก `.pipeline_status.json`
- ทั้ง Airflow และ Dashboard **share volume `./data`** ผ่าน Docker ทำให้เชื่อมต่อกันได้

---

## 📊 Dashboard KPIs
| KPI | คำอธิบาย |
|-----|---------|
| 📝 Total Reviews | จำนวนรีวิวทั้งหมดในวันล่าสุด |
| 👍 Positive Rate | % ของรีวิวที่แนะนำ (voted_up) |
| ⏱️ Avg. Playtime | เวลาเล่นเฉลี่ยของผู้รีวิว (ชั่วโมง) |
| 🕹️ Unique Games | จำนวนเกมที่ถูกรีวิวในวันนั้น |

## 📈 Charts
- **Line Chart**: แนวโน้ม Positive vs Negative reviews รายวัน
- **Bar Chart**: Top 10 เกมที่มีรีวิวมากที่สุด (สีตาม positive rate)
"# Big_Data" 
