import os
import json
import queue
import threading
from datetime import datetime

from flask import Flask, render_template, jsonify, request, Response
from firebase_admin import firestore

from firebase_db import db
from alarm_manager import process

# backend/app.py -> lùi 1 cấp để ra thư mục gốc
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE_DIR = os.path.join(BASE_DIR, "dashboard", "templates")
STATIC_DIR = os.path.join(BASE_DIR, "dashboard", "static")

app = Flask(
    __name__,
    template_folder=TEMPLATE_DIR,
    static_folder=STATIC_DIR,
)

COLLECTION_NAME = "breathing_records"

@app.route("/")
def dashboard():
    return render_template("index.html")


@app.route("/api/latest", methods=["GET"])
def get_latest():
    if db is None:
        return jsonify({"error": "Firebase không hoạt động"}), 500

    try:
        # Lấy 1 bản ghi mới nhất. Push ID của Firebase đã chứa timestamp nên có thể order_by_key()
        ref = db.child(COLLECTION_NAME)
        results = ref.order_by_key().limit_to_last(1).get()

        if not results:
            return jsonify({"message": "Chưa có dữ liệu"}), 404
            
        key = list(results.keys())[0]
        record = results[key]
        record["id"] = key
        
        if "created_at" in record:
            record["recorded_at"] = record.pop("created_at")

        return jsonify(record), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/history", methods=["GET"])
def get_history():
    if db is None:
        return jsonify({"error": "Firebase không hoạt động"}), 500

    limit = request.args.get("limit", default=100, type=int)

    try:
        ref = db.child(COLLECTION_NAME)
        results = ref.order_by_key().limit_to_last(limit).get()

        if not results:
            return jsonify([]), 200

        records = []
        for key, record in results.items():
            record["id"] = key
            if "created_at" in record:
                record["recorded_at"] = record.pop("created_at")
            records.append(record)
            
        # Realtime DB trả về theo thứ tự tăng dần, ta đảo ngược để hiển thị mới nhất trước
        records.sort(key=lambda x: x.get("recorded_at", ""), reverse=True)

        return jsonify(records), 200

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/breathing", methods=["POST"])
def ingest_breathing():
    if db is None:
        return jsonify({"error": "Firebase không hoạt động"}), 500

    data = request.get_json(silent=True)

    if not data or "bpm" not in data:
        return jsonify({"error": "Thiếu field bpm"}), 400

    try:
        bpm_value = float(data["bpm"])
    except (TypeError, ValueError):
        return jsonify({"error": "bpm phải là số"}), 400

    try:
        current_time = datetime.now().isoformat()
        new_record = {
            "bpm": bpm_value,
            "source": data.get("source", "camera_ai"),
            "note": data.get("note", ""),
            "created_at": current_time
        }

        # Lưu vào Realtime Database
        ref = db.child(COLLECTION_NAME)
        new_ref = ref.push(new_record)
        
        # Trả về thông tin
        response_data = new_record.copy()
        response_data["id"] = new_ref.key
        response_data["recorded_at"] = current_time
        response_data.pop("created_at", None)

        # ===========================
        # Kiểm tra cảnh báo
        # ===========================
        print("=" * 60)
        print(f"[Backend] Nhan du lieu  : {datetime.now():%Y-%m-%d %H:%M:%S}")
        print(f"[Backend] BPM          : {bpm_value:.2f}")
        print(f"[Backend] Image        : {data.get('image')}")
        print("=" * 60)
        
        process(
            bpm=bpm_value,
            image_path=data.get("image")
        )

        return jsonify(response_data), 201

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ===========================
# SSE — Server-Sent Events
# ===========================

# Danh sách queue của từng browser client đang kết nối
_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()
_firebase_listener_started = False


def _on_firebase_change(event):
    """Callback của firebase_admin listener — được gọi mỗi khi DB thay đổi."""
    if event.data is None:
        return
    # Firebase trả về toàn bộ collection ở lần đầu (event.path == '/'),
    # hoặc từng bản ghi mới (event.path == '/<push_key>').
    payload = json.dumps({"path": event.path, "data": event.data})
    with _sse_lock:
        for q in _sse_clients:
            q.put(payload)


def _ensure_listener():
    """Khởi động Firebase listener 1 lần duy nhất, chạy trong thread riêng."""
    global _firebase_listener_started
    with _sse_lock:
        if _firebase_listener_started or db is None:
            return
        _firebase_listener_started = True
    db.child(COLLECTION_NAME).listen(_on_firebase_change)


@app.route("/api/stream")
def stream():
    """SSE endpoint — browser kết nối 1 lần, nhận push mỗi khi có dữ liệu mới."""
    if db is None:
        return jsonify({"error": "Firebase không hoạt động"}), 500

    # Đảm bảo Firebase listener đang chạy
    t = threading.Thread(target=_ensure_listener, daemon=True)
    t.start()

    client_q: queue.Queue = queue.Queue(maxsize=50)
    with _sse_lock:
        _sse_clients.append(client_q)

    def generate():
        try:
            # Gửi heartbeat ngay để browser biết kết nối thành công
            yield "event: connected\ndata: {}\n\n"
            while True:
                try:
                    payload = client_q.get(timeout=30)
                    yield f"event: update\ndata: {payload}\n\n"
                except queue.Empty:
                    # Heartbeat mỗi 30s để giữ kết nối không bị timeout
                    yield "event: heartbeat\ndata: {}\n\n"
        finally:
            with _sse_lock:
                _sse_clients.remove(client_q)

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=5000,
        debug=True,
        threaded=True,
        use_reloader=False,
    )