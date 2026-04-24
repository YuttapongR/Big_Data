from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator
from airflow.utils.dates import days_ago
from datetime import datetime, timedelta
import json
import os

default_args = {
    'owner': 'data_engineer',
    'depends_on_past': False,
    'email_on_failure': False,
    'email_on_retry': False,
    'retries': 1,
    'retry_delay': timedelta(minutes=5),
}


def write_pipeline_status(**context):
    """เขียนสถานะ Pipeline ลงไฟล์ JSON เพื่อให้ Dashboard อ่านได้"""
    status_path = "/opt/airflow/data/processed/.pipeline_status.json"
    os.makedirs(os.path.dirname(status_path), exist_ok=True)
    
    status = {
        "status": "completed",
        "message": "Steam Reviews Pipeline ran successfully",
        "last_run": datetime.now().isoformat(),
        "dag_id": context.get("dag", {}).dag_id if context.get("dag") else "steam_reviews_bigdata_pipeline",
        "execution_date": str(context.get("execution_date", "")),
    }
    
    with open(status_path, "w") as f:
        json.dump(status, f, indent=2)
    
    print(f"✅ Pipeline status written to {status_path}")


# กำหนดให้รันทุกวันตอนตี 2 (02:00)
with DAG(
    'steam_reviews_bigdata_pipeline',
    default_args=default_args,
    description='PySpark pipeline to clean and aggregate Steam Reviews Data, then notify Dashboard',
    schedule_interval='0 2 * * *',
    start_date=days_ago(1),
    catchup=False,
    tags=['bigdata', 'pyspark', 'steam'],
) as dag:

    # Task 1: Clean Data
    # รันสคริปต์ PySpark เพื่อทำความสะอาดข้อมูล Steam Reviews
    clean_task = BashOperator(
        task_id='clean_data',
        bash_command='python /opt/airflow/spark_jobs/clean_data.py ',
    )

    # Task 2: Aggregate Data
    # รันสคริปต์ PySpark เพื่อประมวลผลยอดรวม (Daily + Top Games)
    aggregate_task = BashOperator(
        task_id='aggregate_data',
        bash_command='python /opt/airflow/spark_jobs/aggregate_data.py ',
    )

    # Task 3: Write Pipeline Status
    # เขียนสถานะ Pipeline ลงไฟล์ JSON เพื่อให้ Dashboard ดึงไปแสดง
    notify_dashboard_task = PythonOperator(
        task_id='notify_dashboard',
        python_callable=write_pipeline_status,
    )

    # กำหนดลำดับการทำงาน (Dependencies)
    # Clean -> Aggregate -> Notify Dashboard
    clean_task >> aggregate_task >> notify_dashboard_task
