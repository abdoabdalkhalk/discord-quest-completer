import os
import json
import time
import random
import re
import base64
from datetime import datetime, timezone
from flask import Flask, request, jsonify, render_template

import requests as http_requests

app = Flask(
    __name__,
    template_folder=os.path.join(os.path.dirname(__file__), '..', 'templates'),
    static_folder=os.path.join(os.path.dirname(__file__), '..', 'static'),
    static_url_path='/static'
)

API_BASE = "https://discord.com/api/v9"

SUPPORTED_TASKS = [
    "WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE",
]

TASK_LABELS = {
    "WATCH_VIDEO":           "Watch Video",
    "WATCH_VIDEO_ON_MOBILE": "Watch Video",
    "PLAY_ON_DESKTOP":       "Play Game",
    "STREAM_ON_DESKTOP":     "Stream",
    "PLAY_ACTIVITY":         "Activity",
}

TASK_COLORS = {
    "WATCH_VIDEO":           "#e44d7b",
    "WATCH_VIDEO_ON_MOBILE": "#e44d7b",
    "PLAY_ON_DESKTOP":       "#3ba55d",
    "STREAM_ON_DESKTOP":     "#9b59b6",
    "PLAY_ACTIVITY":         "#f0b232",
}


def fetch_latest_build_number():
    FALLBACK = 504649
    try:
        ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        r = http_requests.get("https://discord.com/app", headers={"User-Agent": ua}, timeout=15)
        if r.status_code != 200:
            return FALLBACK
        for asset_hash in re.findall(r'/assets/([a-f0-9]+)\.js', r.text)[-5:]:
            try:
                ar = http_requests.get(
                    f"https://discord.com/assets/{asset_hash}.js",
                    headers={"User-Agent": ua}, timeout=15
                )
                m = re.search(r'buildNumber["\s:]+["\s]*(\d{5,7})', ar.text)
                if m:
                    return int(m.group(1))
            except Exception:
                continue
        return FALLBACK
    except Exception:
        return FALLBACK


def make_super_properties(build_number):
    obj = {
        "os": "Windows",
        "browser": "Discord Client",
        "release_channel": "stable",
        "client_version": "1.0.9175",
        "os_version": "10.0.26100",
        "os_arch": "x64",
        "app_arch": "x64",
        "system_locale": "en-US",
        "browser_user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 "
            "Electron/32.2.7 Safari/537.36"
        ),
        "browser_version": "32.2.7",
        "client_build_number": build_number,
        "native_build_number": 59498,
        "client_event_source": None,
    }
    return base64.b64encode(json.dumps(obj).encode()).decode()


def make_headers(token, build_number):
    ua = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) discord/1.0.9175 Chrome/128.0.6613.186 "
        "Electron/32.2.7 Safari/537.36"
    )
    return {
        "Authorization": token,
        "Content-Type": "application/json",
        "User-Agent": ua,
        "X-Super-Properties": make_super_properties(build_number),
        "X-Discord-Locale": "en-US",
        "X-Discord-Timezone": "Asia/Ho_Chi_Minh",
        "Origin": "https://discord.com",
        "Referer": "https://discord.com/channels/@me",
    }


def _kget(d, *keys):
    if not d:
        return None
    for k in keys:
        if k in d:
            return d[k]
    return None


def get_task_config(q):
    return _kget(q.get("config", {}), "taskConfig", "task_config", "taskConfigV2", "task_config_v2")


def get_quest_name(q):
    cfg = q.get("config", {})
    msgs = cfg.get("messages", {})
    for k in ("questName", "quest_name", "gameTitle", "game_title"):
        v = msgs.get(k)
        if v:
            return v.strip()
    a = cfg.get("application", {}).get("name")
    return a or f"Quest#{q.get('id', '?')}"


def get_expires_at(q):
    return _kget(q.get("config", {}), "expiresAt", "expires_at")


def get_user_status(q):
    us = _kget(q, "userStatus", "user_status")
    return us if isinstance(us, dict) else {}


def is_completable(q):
    exp = get_expires_at(q)
    if exp:
        try:
            if datetime.fromisoformat(exp.replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                return False
        except Exception:
            pass
    tc = get_task_config(q)
    if not tc or "tasks" not in tc:
        return False
    return any(tc["tasks"].get(t) is not None for t in SUPPORTED_TASKS)


def is_enrolled(q):
    return bool(_kget(get_user_status(q), "enrolledAt", "enrolled_at"))


def is_completed(q):
    return bool(_kget(get_user_status(q), "completedAt", "completed_at"))


def get_task_type(q):
    tc = get_task_config(q)
    if not tc or "tasks" not in tc:
        return None
    for t in SUPPORTED_TASKS:
        if tc["tasks"].get(t) is not None:
            return t
    return None


def get_seconds_needed(q):
    tc = get_task_config(q)
    tt = get_task_type(q)
    if not tc or not tt:
        return 0
    return tc["tasks"][tt].get("target", 0)


def get_seconds_done(q):
    tt = get_task_type(q)
    if not tt:
        return 0
    return (get_user_status(q).get("progress") or {}).get(tt, {}).get("value", 0)


def get_enrolled_at(q):
    return _kget(get_user_status(q), "enrolledAt", "enrolled_at")


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/connect', methods=['POST'])
def api_connect():
    data = request.get_json()
    token = data.get('token', '').strip()
    if not token:
        return jsonify({"ok": False, "error": "Token is empty"}), 400

    bn = fetch_latest_build_number()
    headers = make_headers(token, bn)

    try:
        r = http_requests.get(f"{API_BASE}/users/@me", headers=headers, timeout=15)
        if r.status_code != 200:
            return jsonify({"ok": False, "error": "Invalid token"}), 401
        user = r.json()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    return jsonify({
        "ok": True,
        "build_number": bn,
        "user": {
            "username": user.get("username", "?"),
            "id": user.get("id", ""),
        },
    })


@app.route('/api/quests', methods=['POST'])
def api_quests():
    data = request.get_json()
    token = data.get('token', '').strip()
    bn = data.get('build_number', 504649)
    headers = make_headers(token, bn)

    try:
        r = http_requests.get(f"{API_BASE}/quests/@me", headers=headers, timeout=15)
        if r.status_code != 200:
            return jsonify({"ok": False, "error": "Failed to fetch"}), 400
        raw = r.json()
        quests = raw.get("quests", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

    result = []
    for q in quests:
        tt = get_task_type(q)
        result.append({
            "id": q.get("id"),
            "name": get_quest_name(q),
            "task_type": tt,
            "task_label": TASK_LABELS.get(tt, "Unknown"),
            "task_color": TASK_COLORS.get(tt, "#5865f2"),
            "seconds_needed": get_seconds_needed(q),
            "seconds_done": get_seconds_done(q),
            "expires_at": get_expires_at(q),
            "enrolled_at": get_enrolled_at(q),
            "is_enrolled": is_enrolled(q),
            "is_completed": is_completed(q),
            "is_completable": is_completable(q),
            "traffic_metadata_raw": q.get("traffic_metadata_raw"),
            "traffic_metadata_sealed": q.get("traffic_metadata_sealed"),
        })

    total = len(quests)
    completed = sum(1 for r_ in result if r_["is_completed"])
    available = sum(1 for r_ in result if not r_["is_completed"] and r_["is_completable"])

    return jsonify({
        "ok": True,
        "quests": result,
        "total": total,
        "completed": completed,
        "available": available,
    })


@app.route('/api/enroll', methods=['POST'])
def api_enroll():
    data = request.get_json()
    token = data.get('token', '').strip()
    bn = data.get('build_number', 504649)
    qid = data.get('quest_id')
    headers = make_headers(token, bn)

    payload = {
        "location": 11,
        "is_targeted": False,
        "metadata_raw": None,
        "metadata_sealed": None,
        "traffic_metadata_raw": data.get("traffic_metadata_raw"),
        "traffic_metadata_sealed": data.get("traffic_metadata_sealed"),
    }

    try:
        r = http_requests.post(
            f"{API_BASE}/quests/{qid}/enroll",
            headers=headers, json=payload, timeout=15
        )
        if r.status_code == 429:
            return jsonify({"ok": False, "retry_after": r.json().get("retry_after", 5)}), 429
        return jsonify({"ok": r.status_code in (200, 201, 204)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/heartbeat', methods=['POST'])
def api_heartbeat():
    data = request.get_json()
    token = data.get('token', '').strip()
    bn = data.get('build_number', 504649)
    qid = data.get('quest_id')
    terminal = data.get('terminal', False)
    stream_key = data.get('stream_key', 'call:0:1')
    headers = make_headers(token, bn)

    payload = {"stream_key": stream_key, "terminal": terminal}

    try:
        r = http_requests.post(
            f"{API_BASE}/quests/{qid}/heartbeat",
            headers=headers, json=payload, timeout=15
        )
        if r.status_code == 429:
            return jsonify({"ok": False, "retry_after": r.json().get("retry_after", 10)}), 429
        if r.status_code == 200:
            return jsonify({"ok": True, "data": r.json()})
        return jsonify({"ok": False, "status": r.status_code}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/video-progress', methods=['POST'])
def api_video_progress():
    data = request.get_json()
    token = data.get('token', '').strip()
    bn = data.get('build_number', 504649)
    qid = data.get('quest_id')
    timestamp = data.get('timestamp', 0)
    headers = make_headers(token, bn)

    try:
        r = http_requests.post(
            f"{API_BASE}/quests/{qid}/video-progress",
            headers=headers,
            json={"timestamp": timestamp},
            timeout=15
        )
        if r.status_code == 429:
            return jsonify({"ok": False, "retry_after": r.json().get("retry_after", 5)}), 429
        if r.status_code == 200:
            return jsonify({"ok": True, "data": r.json()})
        return jsonify({"ok": False, "status": r.status_code}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


if os.environ.get('VERCEL'):
    application = app
