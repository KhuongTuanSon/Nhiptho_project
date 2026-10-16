from datetime import datetime
import threading
import winsound

LOW_THRESHOLD = 10
HIGH_THRESHOLD = 25


def process(bpm, image_path):
    """
    Kiem tra nguong BPM va in canh bao ra terminal.
    """

    print("=" * 60)
    print(f"[Alarm] BPM nhan duoc  : {bpm:.2f}")
    print(f"[Alarm] Thoi gian      : {datetime.now():%Y-%m-%d %H:%M:%S}")
    print(f"[Alarm] Image          : {image_path}")
    print("=" * 60)

    # Co canh bao
    if bpm < LOW_THRESHOLD or bpm > HIGH_THRESHOLD:
        print(f"[Alarm] CANH BAO: Nhip tho bat thuong! BPM = {bpm:.2f}")
        
         #Phat am thanh canh bao (chay background de khong block API)
        threading.Thread(target=lambda: winsound.Beep(2500, 2000), daemon=True).start()

        if bpm < LOW_THRESHOLD:
            print(f"[Alarm]    Nhip tho qua thap (< {LOW_THRESHOLD} BPM)")
        else:
            print(f"[Alarm]    Nhip tho qua cao (> {HIGH_THRESHOLD} BPM)")

    # Binh thuong
    else:
        print(f"[Alarm] Nhip tho binh thuong: {bpm:.2f} BPM")