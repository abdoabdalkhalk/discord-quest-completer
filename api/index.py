import json
import base64
import re
import uuid
from datetime import datetime, timezone
from flask import Flask, request, jsonify
import requests as http_requests

app = Flask(__name__, static_folder=None)

API_BASE = "https://discord.com/api/v9"
CDN_BASE = "https://cdn.discordapp.com"

SUPPORTED_TASKS = [
    "WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP_V2",
    "PLAY_ON_XBOX", "PLAY_ON_PLAYSTATION", "ACHIEVEMENT_IN_GAME",
    "ACHIEVEMENT_IN_ACTIVITY",
]

# Task types that the tool cannot automate. They are still displayed in the UI
# (so the user sees the full list), but are marked as not-runnable / disabled.
NON_RUNNABLE_TASKS = {"ACHIEVEMENT_IN_ACTIVITY"}

TASK_LABELS = {
    "WATCH_VIDEO": "Watch Video",
    "WATCH_VIDEO_ON_MOBILE": "Watch Video",
    "PLAY_ON_DESKTOP": "Play Game",
    "PLAY_ON_DESKTOP_V2": "Play Game",
    "PLAY_ON_XBOX": "Xbox",
    "PLAY_ON_PLAYSTATION": "PlayStation",
    "STREAM_ON_DESKTOP": "Stream",
    "PLAY_ACTIVITY": "Activity",
    "ACHIEVEMENT_IN_GAME": "Achievement",
    "ACHIEVEMENT_IN_ACTIVITY": "Achievement",
}

TASK_COLORS = {
    "WATCH_VIDEO": "#ec4899",
    "WATCH_VIDEO_ON_MOBILE": "#ec4899",
    "PLAY_ON_DESKTOP": "#10b981",
    "PLAY_ON_DESKTOP_V2": "#10b981",
    "PLAY_ON_XBOX": "#107c10",
    "PLAY_ON_PLAYSTATION": "#0070d1",
    "STREAM_ON_DESKTOP": "#8b5cf6",
    "PLAY_ACTIVITY": "#f59e0b",
    "ACHIEVEMENT_IN_GAME": "#eab308",
    "ACHIEVEMENT_IN_ACTIVITY": "#eab308",
}

ORBS_HASH = "864e5841fd9af8da3c50ad6d6220bee54e8c2da2d36d3c85d0a5ae95cdbf095e"
ORBS_FALLBACK = f"{CDN_BASE}/assets/content/{ORBS_HASH}.webm?format=webp"

DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/157.0.0.0 Safari/537.36"
)

EXT_RE = re.compile(r'\.(png|jpg|jpeg|webp|gif|mp4|webm)$', re.IGNORECASE)


def strip_ext(value):
    if not isinstance(value, str):
        return ""
    return EXT_RE.sub('', value.strip())


def strip_html(text):
    if not text:
        return ""
    try:
        text = re.sub(r'<a[^>]*>(.*?)</a>', r'\1', text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
        text = re.sub(r'<[^>]+>', '', text)
    except Exception:
        pass
    return text.strip()


def parse_super_properties(sp_b64):
    if not sp_b64:
        return None
    try:
        padded = sp_b64 + "=" * (-len(sp_b64) % 4)
        decoded = base64.b64decode(padded).decode()
        return json.loads(decoded)
    except Exception:
        try:
            padded = sp_b64 + "=" * (-len(sp_b64) % 4)
            decoded = base64.urlsafe_b64decode(padded).decode()
            return json.loads(decoded)
        except Exception:
            return None


def ensure_super_properties_fields(sp):
    if not isinstance(sp, dict):
        return sp
    sp.setdefault("client_launch_id", str(uuid.uuid4()))
    sp.setdefault("launch_signature", str(uuid.uuid4()))
    sp.setdefault("client_heartbeat_session_id", str(uuid.uuid4()))
    sp.setdefault("x-installation-id", str(uuid.uuid4()))
    sp.setdefault("has_client_mods", False)
    return sp


SP_BROWSER_ERROR = (
    "Super Properties were captured from a web browser. This tool requires "
    "Super Properties from the Discord desktop app (browser must be 'Discord Client'). "
    "Open the Discord desktop app, press Ctrl+Shift+I, run the SP snippet in its Console, "
    "and paste the resulting value."
)


def make_headers(token, sp_b64):
    sp = parse_super_properties(sp_b64)
    if not sp:
        return None, "Invalid Super Properties (must be base64-encoded JSON)."
    if sp.get("browser") != "Discord Client":
        return None, SP_BROWSER_ERROR
    sp = ensure_super_properties_fields(sp)
    ua = sp.get("browser_user_agent") or DEFAULT_UA
    try:
        new_sp_b64 = base64.b64encode(json.dumps(sp, separators=(',', ':')).encode()).decode()
    except Exception:
        new_sp_b64 = sp_b64
    return {
        "Authorization": token,
        "Content-Type": "application/json",
        "User-Agent": ua,
        "X-Super-Properties": new_sp_b64,
        "X-Discord-Locale": "en-US",
        "X-Discord-Timezone": "UTC",
        "X-Installation-Id": sp.get("x-installation-id", str(uuid.uuid4())),
        "Origin": "https://discord.com",
        "Referer": "https://discord.com/quest-home",
    }, None


def _kget(d, *keys):
    if not d:
        return None
    for k in keys:
        if k in d:
            return d[k]
    return None


def get_task_config(q):
    cfg = q.get("config", {})
    tc = _kget(cfg, "taskConfig", "task_config", "task_config_v2", "taskConfigV2")
    if tc:
        return tc
    return _kget(q, "task_config_v2", "taskConfigV2")


def get_task_type(q):
    tc = get_task_config(q)
    if not tc:
        return None
    tasks = tc.get("tasks") if isinstance(tc, dict) else None
    if isinstance(tasks, dict):
        for t in SUPPORTED_TASKS:
            if tasks.get(t) is not None:
                return t
    for t in SUPPORTED_TASKS:
        if tc.get(t) is not None:
            return t
    return None


def is_runnable_task_type(tt):
    return tt is not None and tt not in NON_RUNNABLE_TASKS


def get_quest_name(q):
    cfg = q.get("config", {})
    msgs = cfg.get("messages", {})
    for k in ("quest_name", "questName", "game_title", "gameTitle"):
        v = msgs.get(k)
        if v:
            return strip_html(v)
    a = cfg.get("application", {}).get("name")
    return a or f"Quest#{q.get('id', '?')}"


def get_partner_name(q):
    cfg = q.get("config", {})
    msgs = cfg.get("messages", {}) or {}
    app = cfg.get("application", {}) or {}
    for k in ("game_publisher", "gamePublisher", "publisher"):
        v = msgs.get(k)
        if isinstance(v, str) and v.strip():
            return strip_html(v)
    for k in ("name", "publisher", "company"):
        v = app.get(k)
        if isinstance(v, str) and v.strip():
            return strip_html(v)
    return ""


def pick_asset(assets, keys):
    if not isinstance(assets, dict):
        return ""
    for k in keys:
        v = assets.get(k)
        if isinstance(v, str) and v.strip() and v.strip() != "PLACEHOLDER":
            return v.strip()
    return ""


def build_quests_image(raw, qid, ext="jpg", size=""):
    if not raw:
        return ""
    if raw.startswith("http"):
        return raw
    base = strip_ext(raw)
    if base.startswith("quests/"):
        url = f"{CDN_BASE}/{base}.{ext}"
    elif base.startswith("assets/"):
        url = f"{CDN_BASE}/{base}.{ext}"
    elif base.startswith(f"{qid}/"):
        url = f"{CDN_BASE}/quests/{base}.{ext}"
    else:
        url = f"{CDN_BASE}/quests/{qid}/{base}.{ext}"
    if size:
        url += f"?format=webp&{size}"
    return url


def build_quests_video(raw, qid):
    if not raw:
        return ""
    if raw.startswith("http"):
        return raw
    base = strip_ext(raw)
    if base.startswith("quests/"):
        return f"{CDN_BASE}/{base}.mp4"
    if base.startswith("assets/"):
        return f"{CDN_BASE}/{base}.mp4"
    if base.startswith(f"{qid}/"):
        return f"{CDN_BASE}/quests/{base}.mp4"
    return f"{CDN_BASE}/quests/{qid}/{base}.mp4"


def get_quest_assets(q):
    cfg = q.get("config", {}) or {}
    assets = cfg.get("assets", {}) or q.get("assets", {}) or {}
    qid = q.get("id")
    app_assets = (cfg.get("application", {}) or {}).get("assets", {}) or {}

    hero_raw = pick_asset(assets, ["hero", "hero_image", "heroImage", "hero_asset", "heroAsset"])
    hero_video_raw = pick_asset(assets, ["hero_video", "heroVideo", "hero_video_dark", "heroVideoDark"])
    tile_raw = pick_asset(assets, ["game_tile", "gameTile", "game_tile_light", "gameTileLight", "game_tile_dark", "gameTileDark", "tile"])

    logo_raw = pick_asset(assets, [
        "logotype_dark", "logotypeDark",
        "logotype", "logo", "partner_logo", "partnerLogo", "partner_logotype", "partnerLogotype",
        "logotype_light", "logotypeLight",
        "game_logo", "gameLogo", "publisher_logo", "publisherLogo",
    ])

    if not logo_raw:
        logo_raw = pick_asset(app_assets, ["logotype_dark", "logotypeDark", "logotype", "logo", "icon", "cover_image", "coverImage"])

    hero_url = build_quests_image(hero_raw, qid, "jpg", "width=1320&height=370")
    hero_video_url = build_quests_video(hero_video_raw, qid)
    tile_url = build_quests_image(tile_raw, qid, "jpg", "width=512&height=512")
    logo_url = build_quests_image(logo_raw, qid, "png")

    return {
        "hero": hero_url,
        "hero_video": hero_video_url,
        "game_tile": tile_url,
        "logotype": logo_url,
        "hero_raw": hero_raw,
        "hero_video_raw": hero_video_raw,
        "game_tile_raw": tile_raw,
        "logotype_raw": logo_raw,
        "assets_keys": list(assets.keys()) if isinstance(assets, dict) else [],
        "app_assets_keys": list(app_assets.keys()) if isinstance(app_assets, dict) else [],
        "assets_dump": assets if isinstance(assets, dict) else {},
        "quest_id": qid,
    }


def find_reward_asset_hash(r):
    if not isinstance(r, dict):
        return "", ""

    candidates_direct = [
        "asset", "asset_hash", "assetHash", "image", "icon", "media",
        "image_hash", "icon_hash", "reward_asset", "rewardAsset",
        "asset_url", "assetUrl", "preview_asset", "previewAsset",
        "preview_url", "previewUrl", "thumbnail", "thumbnail_url",
        "thumbnailUrl", "url", "image_url", "imageUrl", "icon_url",
        "iconUrl", "static_asset", "staticAsset", "animated_asset",
        "animatedAsset", "asset_id", "assetId",
    ]

    for k in candidates_direct:
        v = r.get(k)
        if isinstance(v, str) and v.strip() and v.strip() != "PLACEHOLDER":
            return v.strip(), f"r.{k}"

    msgs = r.get("messages") or {}
    if isinstance(msgs, dict):
        for k in ("asset", "image", "icon", "thumbnail", "preview", "asset_hash", "assetHash"):
            v = msgs.get(k)
            if isinstance(v, str) and v.strip() and v.strip() != "PLACEHOLDER":
                return v.strip(), f"r.messages.{k}"

    for container_key in ("assets", "media", "preview", "thumbnail", "images"):
        container = r.get(container_key)
        if isinstance(container, dict):
            for k in ("asset", "url", "image", "hero", "tile", "icon", "video",
                      "asset_hash", "assetHash", "src", "href", "path"):
                v = container.get(k)
                if isinstance(v, str) and v.strip() and v.strip() != "PLACEHOLDER":
                    return v.strip(), f"r.{container_key}.{k}"

    for container_key in ("assets", "media"):
        container = r.get(container_key)
        if isinstance(container, list):
            for idx, item in enumerate(container):
                if isinstance(item, dict):
                    for k in ("asset", "url", "image", "src", "href"):
                        v = item.get(k)
                        if isinstance(v, str) and v.strip() and v.strip() != "PLACEHOLDER":
                            return v.strip(), f"r.{container_key}[{idx}].{k}"

    return "", ""


def collect_rewards_list(cfg):
    rewards_config = cfg.get("rewards_config") or cfg.get("rewardsConfig") or {}

    if isinstance(rewards_config, dict):
        raw = rewards_config.get("rewards") or rewards_config.get("items") or []
        if isinstance(raw, list) and raw:
            return [r for r in raw if isinstance(r, dict)], rewards_config

    legacy = cfg.get("rewards") or {}
    if isinstance(legacy, dict):
        single = legacy.get("reward")
        if isinstance(single, dict):
            return [single], legacy
        raw = legacy.get("rewards")
        if isinstance(raw, list) and raw:
            return [r for r in raw if isinstance(r, dict)], legacy

    single = cfg.get("reward")
    if isinstance(single, dict):
        return [single], single

    return [], rewards_config


def get_quest_reward(q):
    cfg = q.get("config", {}) or {}
    rewards_list, raw_container = collect_rewards_list(cfg)

    processed = []
    for r in rewards_list:
        msgs = r.get("messages") or {}

        name = ""
        for k in ("name_with_article", "name", "reward_name", "display_name", "title"):
            v = msgs.get(k) if isinstance(msgs, dict) else None
            if isinstance(v, str) and v.strip():
                name = strip_html(v)
                break

        reward_type = r.get("type") or r.get("reward_type") or r.get("rewardType") or ""
        reward_type_str = str(reward_type).lower()

        orb_qty = (
            r.get("orb_quantity") or r.get("orbs") or r.get("quantity") or
            r.get("amount") or r.get("reward_value") or r.get("value") or
            r.get("orbQuantity")
        )

        is_orb_reward = (
            "orb" in reward_type_str or
            bool(orb_qty) or
            "orb" in name.lower()
        )

        if not name and orb_qty:
            name = f"{orb_qty} Orbs"

        asset_static = ""
        asset_hover = ""

        if is_orb_reward:
            if orb_qty == 700 or orb_qty == 840:
                asset_static = "https://cdn.discordapp.com/assets/content/864e5841fd9af8da3c50ad6d6220bee54e8c2da2d36d3c85d0a5ae95cdbf095e.gif?format=png"
                asset_hover = "https://cdn.discordapp.com/assets/content/864e5841fd9af8da3c50ad6d6220bee54e8c2da2d36d3c85d0a5ae95cdbf095e.gif"
            else:
                asset_static = "https://cdn.discordapp.com/assets/content/d4fc1c99b3e3044530f08ede0156d1d43a13bf78f0f539e240b63f2d4dad3554.gif?format=png"
                asset_hover = "https://cdn.discordapp.com/assets/content/d4fc1c99b3e3044530f08ede0156d1d43a13bf78f0f539e240b63f2d4dad3554.gif"
        else:
            asset_raw, _ = find_reward_asset_hash(r)
            if asset_raw:
                if asset_raw.startswith("http"):
                    asset_hover = asset_raw
                else:
                    asset_hover = f"{CDN_BASE}/{asset_raw}"

                if asset_hover.endswith(".mp4") or asset_hover.endswith(".webm"):
                    asset_static = f"{asset_hover}?format=png"
                else:
                    asset_static = asset_hover

        processed.append({
            "name": name,
            "type": str(reward_type),
            "asset_static": asset_static,
            "asset_hover": asset_hover,
            "orb_quantity": orb_qty,
            "is_orbs": is_orb_reward,
            "raw_keys": list(r.keys()),
            "raw_messages_keys": list(msgs.keys()) if isinstance(msgs, dict) else [],
        })

    if not processed:
        return {
            "asset_static": "",
            "asset_hover": "",
            "name": "",
            "type": "",
            "is_orbs": False,
            "all": [],
            "rewards_dump": raw_container,
        }

    primary = processed[0]

    return {
        "asset_static": primary["asset_static"],
        "asset_hover": primary["asset_hover"],
        "name": primary["name"],
        "type": primary["type"],
        "is_orbs": primary["is_orbs"],
        "all": processed,
        "rewards_dump": raw_container,
    }


def get_quest_messages(q):
    cfg = q.get("config", {})
    msgs = cfg.get("messages", {}) or {}
    tc = get_task_config(q)
    task_msgs = {}
    if tc and isinstance(tc, dict):
        tasks = tc.get("tasks") if isinstance(tc.get("tasks"), dict) else tc
        tt = None
        for t in SUPPORTED_TASKS:
            if isinstance(tasks, dict) and tasks.get(t) is not None:
                tt = t
                break
        if tt and isinstance(tasks, dict):
            task_msgs = tasks[tt].get("messages", {}) or {}
    return {
        "game_title": strip_html(msgs.get("game_title") or msgs.get("gameTitle") or ""),
        "task_title": strip_html(task_msgs.get("task_title") or task_msgs.get("taskTitle") or ""),
        "task_description": strip_html(task_msgs.get("task_description") or task_msgs.get("taskDescription") or ""),
        "video_title": strip_html(task_msgs.get("video_title") or task_msgs.get("videoTitle") or ""),
    }


def get_expires_at(q):
    return _kget(q.get("config", {}), "expires_at", "expiresAt")


def get_starts_at(q):
    return _kget(q.get("config", {}), "starts_at", "startsAt")


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
    if not tc:
        return False
    tasks = tc.get("tasks") if isinstance(tc.get("tasks"), dict) else tc
    return any(tasks.get(t) is not None for t in SUPPORTED_TASKS)


def is_enrolled(q):
    return bool(_kget(get_user_status(q), "enrolledAt", "enrolled_at"))


def is_completed(q):
    us = get_user_status(q)
    return bool(_kget(us, "completedAt", "completed_at"))


def is_claimed(q):
    us = get_user_status(q)
    return bool(_kget(us, "claimedAt", "claimed_at"))


def get_seconds_needed(q):
    tc = get_task_config(q)
    tt = get_task_type(q)
    if not tc or not tt:
        return 0
    tasks = tc.get("tasks") if isinstance(tc.get("tasks"), dict) else tc
    if not isinstance(tasks, dict):
        return 0
    target = tasks[tt].get("target") if isinstance(tasks[tt], dict) else None
    return target or 0


def get_seconds_done(q):
    tt = get_task_type(q)
    if not tt:
        return 0
    return (get_user_status(q).get("progress") or {}).get(tt, {}).get("value", 0)


def get_enrolled_at(q):
    return _kget(get_user_status(q), "enrolledAt", "enrolled_at")


def get_application_name(q):
    cfg = q.get("config", {}) or {}
    app_cfg = cfg.get("application", {}) or {}
    name = app_cfg.get("name")
    return name.strip() if isinstance(name, str) and name.strip() else None


def get_application_id(q):
    cfg = q.get("config", {}) or {}
    app = cfg.get("application", {}) or {}
    for key in ("id", "application_id", "applicationId"):
        v = app.get(key)
        if v:
            return str(v)
    return None


@app.route('/api/connect', methods=['POST'])
def api_connect():
    data = request.get_json() or {}
    token = (data.get('token') or '').strip()
    sp = (data.get('super_properties') or '').strip()
    if not token:
        return jsonify({"ok": False, "error": "Token is required"}), 400
    if not sp:
        return jsonify({"ok": False, "error": "Super Properties are required"}), 400
    headers, sp_err = make_headers(token, sp)
    if sp_err:
        return jsonify({"ok": False, "error": sp_err}), 400
    try:
        r = http_requests.get(f"{API_BASE}/users/@me", headers=headers, timeout=15)
        if r.status_code != 200:
            return jsonify({"ok": False, "error": "Invalid Discord token"}), 401
        user = r.json()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    sp_obj = parse_super_properties(sp) or {}
    return jsonify({
        "ok": True,
        "build_number": sp_obj.get("client_build_number", 676376),
        "user": {
            "username": user.get("username", "Unknown"),
            "id": user.get("id", ""),
            "avatar": user.get("avatar"),
            "discriminator": user.get("discriminator", "0")
        },
    })


@app.route('/api/quests', methods=['POST'])
def api_quests():
    data = request.get_json() or {}
    token = (data.get('token') or '').strip()
    sp = (data.get('super_properties') or '').strip()
    headers, sp_err = make_headers(token, sp)
    if sp_err:
        return jsonify({"ok": False, "error": sp_err}), 400
    try:
        r = http_requests.get(f"{API_BASE}/quests/@me", headers=headers, timeout=15)
        if r.status_code != 200:
            return jsonify({"ok": False, "error": "Failed to fetch quests from Discord"}), 400
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
            "partner": get_partner_name(q),
            "task_type": tt,
            "task_label": TASK_LABELS.get(tt, "Unknown"),
            "task_color": TASK_COLORS.get(tt, "#5865f2"),
            "is_runnable": is_runnable_task_type(tt),
            "seconds_needed": get_seconds_needed(q),
            "seconds_done": get_seconds_done(q),
            "starts_at": get_starts_at(q),
            "expires_at": get_expires_at(q),
            "enrolled_at": get_enrolled_at(q),
            "is_enrolled": is_enrolled(q),
            "is_completed": is_completed(q),
            "is_claimed": is_claimed(q),
            "is_completable": is_completable(q),
            "application_id": get_application_id(q),
            "application_name": get_application_name(q),
            "assets": get_quest_assets(q),
            "reward": get_quest_reward(q),
            "messages": get_quest_messages(q),
            "traffic_metadata_raw": q.get("traffic_metadata_raw"),
            "traffic_metadata_sealed": q.get("traffic_metadata_sealed"),
        })

    total = len(quests)
    completed = sum(1 for r_ in result if r_["is_completed"] or r_["is_claimed"])
    available = sum(
        1 for r_ in result
        if not r_["is_completed"] and not r_["is_claimed"]
        and r_["is_completable"] and r_["is_runnable"]
    )

    return jsonify({
        "ok": True,
        "quests": result,
        "total": total,
        "completed": completed,
        "available": available,
    })


@app.route('/api/enroll', methods=['POST'])
def api_enroll():
    data = request.get_json() or {}
    token = (data.get('token') or '').strip()
    sp = (data.get('super_properties') or '').strip()
    qid = data.get('quest_id')
    headers, sp_err = make_headers(token, sp)
    if sp_err:
        return jsonify({"ok": False, "error": sp_err}), 400
    payload = {
        "location": 11,
        "is_targeted": False,
        "metadata_raw": None,
        "metadata_sealed": None,
        "traffic_metadata_raw": data.get("traffic_metadata_raw"),
        "traffic_metadata_sealed": data.get("traffic_metadata_sealed"),
    }
    try:
        r = http_requests.post(f"{API_BASE}/quests/{qid}/enroll", headers=headers, json=payload, timeout=15)
        if r.status_code == 429:
            return jsonify({"ok": False, "retry_after": r.json().get("retry_after", 5)}), 429
        return jsonify({"ok": r.status_code in (200, 201, 204)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/heartbeat', methods=['POST'])
def api_heartbeat():
    data = request.get_json() or {}
    token = (data.get('token') or '').strip()
    sp = (data.get('super_properties') or '').strip()
    qid = data.get('quest_id')
    terminal = data.get('terminal', False)
    stream_key = data.get('stream_key', 'call:0:1')
    application_id = data.get('application_id')
    headers, sp_err = make_headers(token, sp)
    if sp_err:
        return jsonify({"ok": False, "error": sp_err}), 400

    payload = {"stream_key": stream_key, "terminal": terminal}
    if application_id:
        payload["application_id"] = str(application_id)

    try:
        r = http_requests.post(f"{API_BASE}/quests/{qid}/heartbeat", headers=headers, json=payload, timeout=15)
        if r.status_code == 429:
            try:
                retry = r.json().get("retry_after", 10)
            except Exception:
                retry = 10
            return jsonify({"ok": False, "retry_after": retry}), 429
        if r.status_code == 200:
            return jsonify({"ok": True, "data": r.json()})
        if r.status_code in (401, 403):
            return jsonify({"ok": False, "status": r.status_code, "error": r.text}), r.status_code
        return jsonify({"ok": False, "status": r.status_code, "error": r.text}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/video-progress', methods=['POST'])
def api_video_progress():
    data = request.get_json() or {}
    token = (data.get('token') or '').strip()
    sp = (data.get('super_properties') or '').strip()
    qid = data.get('quest_id')
    timestamp = data.get('timestamp', 0)
    headers, sp_err = make_headers(token, sp)
    if sp_err:
        return jsonify({"ok": False, "error": sp_err}), 400
    try:
        r = http_requests.post(f"{API_BASE}/quests/{qid}/video-progress", headers=headers, json={"timestamp": timestamp}, timeout=15)
        if r.status_code == 429:
            try:
                retry = r.json().get("retry_after", 5)
            except Exception:
                retry = 5
            return jsonify({"ok": False, "retry_after": retry}), 429
        if r.status_code == 200:
            return jsonify({"ok": True, "data": r.json()})
        if r.status_code in (401, 403):
            return jsonify({"ok": False, "status": r.status_code, "error": r.text}), r.status_code
        return jsonify({"ok": False, "status": r.status_code, "error": r.text}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500