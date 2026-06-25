import os
import sys
import time
import random
from curl_cffi import requests
from dotenv import load_dotenv

# Load .env from the parent directory
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
load_dotenv(dotenv_path)

def run_dispatcher():
    sleep_duration = random.randint(60, 300)
    print(f"[INFO] Sleeping for {sleep_duration} seconds before sending...")
    time.sleep(sleep_duration)

    auth_token = os.environ.get("DISCORD_TOKEN", "").strip()
    channel_id = os.environ.get("ANNOUNCEMENT_CHANNEL_ID", "").strip()
    
    proxy_url = os.environ.get("HTTP_PROXY", "").strip()
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else None

    if not auth_token or not channel_id:
        print("[CRITICAL] Missing DISCORD_TOKEN or ANNOUNCEMENT_CHANNEL_ID.", file=sys.stderr)
        sys.exit(1)

    try:
        with open("message.txt", "r", encoding="utf-8") as f:
            broadcast_content = f.read().strip()
        if not broadcast_content:
            print("[CRITICAL] message.txt is empty.", file=sys.stderr)
            sys.exit(1)
    except FileNotFoundError:
        print("[CRITICAL] message.txt not found.", file=sys.stderr)
        sys.exit(1)

    api_endpoint = f"https://discord.com/api/v10/channels/{channel_id}/messages"

    request_headers = {
        "Authorization": auth_token if auth_token.startswith("Bot ") else f"Bot {auth_token}",
        "Content-Type": "application/json",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://discord.com",
        "Referer": f"https://discord.com/channels/@me/{channel_id}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    request_payload = {
        "content": broadcast_content,
        "tts": False
    }

    try:
        response = requests.post(
            api_endpoint,
            json=request_payload,
            headers=request_headers,
            impersonate="chrome120",
            proxies=proxies,
            timeout=30
        )

        if response.status_code in [200, 201]:
            print("[INFO] Message delivered successfully.")
            sys.exit(0)
        elif response.status_code == 401:
            print("[CRITICAL] 401 Unauthorized — token is invalid or expired.", file=sys.stderr)
            print(f"[DEBUG] Response: {response.text}", file=sys.stderr)
            sys.exit(1)
        elif response.status_code == 403:
            print("[CRITICAL] 403 Forbidden — no permission to send in this channel.", file=sys.stderr)
            print(f"[DEBUG] Response: {response.text}", file=sys.stderr)
            sys.exit(1)
        elif response.status_code == 429:
            retry_after = response.json().get("retry_after", 5)
            print(f"[WARN] Rate limited. Retry after {retry_after}s.", file=sys.stderr)
            sys.exit(1)
        else:
            print(f"[ERROR] Unexpected status: {response.status_code}", file=sys.stderr)
            print(f"[DEBUG] Response: {response.text}", file=sys.stderr)
            sys.exit(1)

    except Exception as e:
        print(f"[CRITICAL] Network exception: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    run_dispatcher()