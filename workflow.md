# Steam Big Data Architecture & Workflow

ไดอะแกรมด้านล่างนี้แสดงขั้นตอนการทำงานของระบบทั้งหมดตั้งแต่ไฟล์ข้อมูลดิบ (Raw Data) ไปจนถึงการแสดงผลบนหน้าจอ Dashboard ครับ

```mermaid
flowchart TD
    %% Define Styles
    classDef rawData fill:#2a475e,stroke:#66c0f4,stroke-width:2px,color:#fff
    classDef sparkJob fill:#e67e22,stroke:#d35400,stroke-width:2px,color:#fff
    classDef parquetData fill:#27ae60,stroke:#2ecc71,stroke-width:2px,color:#fff
    classDef apiServer fill:#8e44ad,stroke:#9b59b6,stroke-width:2px,color:#fff
    classDef frontend fill:#2980b9,stroke:#3498db,stroke-width:2px,color:#fff
    classDef jsonLog fill:#7f8c8d,stroke:#95a5a6,stroke-width:2px,color:#fff

    subgraph Data Source ["📁 1. Data Source (Raw Data)"]
        R1[reviews.csv]:::rawData
        A1[applications.csv]:::rawData
    end

    subgraph Airflow Pipeline ["⚙️ 2. Apache Airflow & PySpark Pipeline"]
        C1["clean_data.py"]:::sparkJob
        C2["aggregate_data.py"]:::sparkJob
        
        R1 -->|1. อ่านข้อมูล 500k แถว| C1
        A1 -->|2. อ่านข้อมูลแอปทั้งหมด| C1
        
        C1 -->|3. คัดกรองข้อมูล & ทิ้ง Error| CP1[(cleaned_reviews.parquet)]:::parquetData
        C1 -->|4. คัดกรองข้อมูลแอป| CP2[(cleaned_apps.parquet)]:::parquetData
        C1 -.->|บันทึก Log คุณภาพข้อมูล| DQ[data_quality_log.json]:::jsonLog
        
        CP1 -->|5. นำข้อมูลสะอาดมาใช้งาน| C2
        CP2 -->|5. นำข้อมูลสะอาดมาใช้งาน| C2
        
        C2 -->|6. คำนวณสรุปรายวัน| P1[(daily_steam_reviews.parquet)]:::parquetData
        C2 -->|7. จัดอันดับเกมยอดนิยม| P2[(top_games.parquet)]:::parquetData
        C2 -.->|สร้างสถิติภาพรวม| S1[summary.json]:::jsonLog
        C2 -.->|อัปเดตสถานะ Pipeline| PS[.pipeline_status.json]:::jsonLog
    end

    subgraph Backend ["🚀 3. FastAPI Backend (main.py)"]
        API1[GET /api/dashboard-data]:::apiServer
        API2[GET /api/top-games]:::apiServer
        API3[GET /api/data-quality]:::apiServer
        API4[GET /api/pipeline-status]:::apiServer
        
        P1 -.->|"อ่านข้อมูลด้วย Pandas"| API1
        P2 -.->|"อ่านข้อมูลด้วย Pandas"| API2
        DQ -.->|"อ่านไฟล์ JSON"| API3
        PS -.->|"อ่านไฟล์ JSON"| API4
        S1 -.->|"อ่านไฟล์ JSON"| API1
    end

    subgraph Client ["💻 4. Frontend Dashboard (Browser)"]
        UI1["app.js, index.html, style.css"]:::frontend
        
        API1 <-->|Fetch API (กรองวันที่)| UI1
        API2 <-->|Fetch API (ค้นหาเกม)| UI1
        API3 <-->|Fetch API| UI1
        API4 <-->|Fetch API| UI1
    end
```

## คำอธิบายแต่ละขั้นตอน (Step-by-Step Flow)

### 1. 📁 Data Source (ข้อมูลต้นทาง)
ผู้ใช้นำไฟล์ `reviews.csv` และ `applications.csv` จาก Kaggle ไปวางในโฟลเดอร์ `data/raw/` 

### 2. ⚙️ Data Pipeline (การทำความสะอาดและสรุปผลด้วย PySpark)
Airflow จะสั่งรันสคริปต์ PySpark ตามลำดับดังนี้:
1. **`clean_data.py`**:
   - อ่าน `reviews.csv` (จำกัด 500,000 แถวแรก) และทิ้งแถวที่โครงสร้างพัง (DROPMALFORMED)
   - สร้างไฟล์สรุปการทำความสะอาด `data_quality_log.json` ไว้ดูว่าข้อมูลเสียไปกี่แถว
   - บันทึกไฟล์ที่สะอาดแล้วเป็น Parquet (อ่านไว ใช้พื้นที่น้อย)
2. **`aggregate_data.py`**:
   - นำไฟล์ที่สะอาดแล้วมา Group By เพื่อคำนวณจำนวนรีวิวเฉลี่ยรายวัน และหาเกมยอดฮิต
   - บันทึกผลลัพธ์ลงเป็น `daily_steam_reviews.parquet` และ `top_games.parquet` 
   - สร้างไฟล์ `summary.json` และ `.pipeline_status.json` บอกว่ารันเสร็จสมบูรณ์

### 3. 🚀 Backend (ตัวกลางส่งข้อมูล)
FastAPI ทำหน้าที่เป็นประตูส่งข้อมูลจากไฟล์ Parquet/JSON เข้าสู่หน้าเว็บ:
- **`/api/dashboard-data`**: ค้นหาข้อมูลแนวโน้มรายวัน (โดยสามารถรับค่าวันที่ Start/End จากหน้าเว็บมากรองข้อมูลด้วย Pandas ได้)
- **`/api/top-games`**: ส่งข้อมูลเกมฮิต โดยรับค่าชื่อเกม (Search) จากหน้าเว็บมากรองได้
- **`/api/data-quality`**: ส่งค่า Log คุณภาพข้อมูลให้หน้าเว็บแสดงผล

### 4. 💻 Frontend (หน้าจอผู้ใช้)
- **`app.js`** จะดึงข้อมูล (Fetch) จาก Backend ทั้ง 4 API มารวมกัน
- หากไม่ได้เลือกวันที่ ระบบจะไม่ส่งวันที่ไปให้ API ทำให้ Backend ส่งข้อมูล 90 วันล่าสุดกลับมาอัตโนมัติ
- นำข้อมูลไปอัปเดตกราฟแท่ง, กราฟเส้น, ตารางค้นหาเกม และอัปเดตหน้าจอผ่าน `index.html` และ `style.css` แบบ Real-time
