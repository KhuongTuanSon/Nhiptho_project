import os
import firebase_admin
from firebase_admin import credentials, db as rtdb

# Đường dẫn tới file serviceAccountKey.json
SERVICE_ACCOUNT_FILE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "serviceAccountKey.json"
)

DATABASE_URL = "https://nhiptho001-default-rtdb.asia-southeast1.firebasedatabase.app"

def init_firebase():
    """Khởi tạo Firebase Admin SDK và trả về Realtime Database reference."""
    if not firebase_admin._apps:
        if not os.path.exists(SERVICE_ACCOUNT_FILE):
            print(f"[LỖI] Không tìm thấy file {SERVICE_ACCOUNT_FILE}!")
            try:
                firebase_admin.initialize_app(options={'databaseURL': DATABASE_URL})
            except Exception as e:
                pass
        else:
            cred = credentials.Certificate(SERVICE_ACCOUNT_FILE)
            firebase_admin.initialize_app(cred, {
                'databaseURL': DATABASE_URL
            })
            
    try:
        return rtdb.reference()
    except Exception:
        return None

# db ở đây sẽ là reference tới gốc của Realtime Database
db = init_firebase()
