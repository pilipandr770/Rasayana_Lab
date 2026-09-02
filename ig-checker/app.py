"""
Внутренний сервис проверки подписки в Instagram для аирдропа Rasayana.
Логинится один раз под ЗАПАСНЫМ аккаунтом (не основной бизнес-аккаунт проекта)
через instagrapi (неофициальная библиотека, мимикрирует мобильное приложение),
дальше проверяет relationship.followed_by для запрошенных username — то есть
честно смотрит, подписан ли конкретный аккаунт на IG_TARGET_USERNAME.

Не публикуется наружу — доступен только из api-контейнера по внутренней
docker-сети, плюс общий секрет в заголовке для дополнительной защиты.
"""
import os
import logging
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException, Query
from instagrapi import Client
from instagrapi.exceptions import ClientError, UserNotFound

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("ig-checker")

IG_USERNAME = os.environ.get("IG_USERNAME", "")
IG_PASSWORD = os.environ.get("IG_PASSWORD", "")
IG_TARGET_USERNAME = os.environ.get("IG_TARGET_USERNAME", "")
INTERNAL_SECRET = os.environ.get("INTERNAL_SECRET", "")
SESSION_PATH = Path(os.environ.get("SESSION_PATH", "/data/session.json"))

app = FastAPI()
client = Client()
target_user_id_cache = None


def ensure_login():
    SESSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SESSION_PATH.exists():
        try:
            client.load_settings(SESSION_PATH)
            client.login(IG_USERNAME, IG_PASSWORD)
            client.get_timeline_feed()  # лёгкий запрос, чтобы убедиться, что сессия жива
            log.info("Instagram: session restored for %s", IG_USERNAME)
            return
        except Exception as e:
            log.warning("Instagram: stored session invalid (%s), logging in fresh", e)
    client.login(IG_USERNAME, IG_PASSWORD)
    client.dump_settings(SESSION_PATH)
    log.info("Instagram: fresh login for %s, session saved", IG_USERNAME)


@app.on_event("startup")
def on_startup():
    global target_user_id_cache
    if not IG_USERNAME or not IG_PASSWORD or not IG_TARGET_USERNAME:
        log.warning("IG_USERNAME/IG_PASSWORD/IG_TARGET_USERNAME not set — service will reject checks")
        return
    try:
        ensure_login()
        target_user_id_cache = client.user_id_from_username(IG_TARGET_USERNAME)
    except Exception as e:
        log.error("Instagram startup login failed: %s", e)


def check_secret(x_internal_secret: str | None):
    if not INTERNAL_SECRET or x_internal_secret != INTERNAL_SECRET:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
def health():
    return {"ok": True, "logged_in": target_user_id_cache is not None}


@app.get("/check-follow")
def check_follow(username: str = Query(...), x_internal_secret: str | None = Header(default=None)):
    check_secret(x_internal_secret)

    if target_user_id_cache is None:
        raise HTTPException(status_code=503, detail="ig-checker not logged in yet")

    username = username.strip().lstrip("@")
    if not username:
        return {"verified": False, "reason": "empty username"}

    try:
        user_id = client.user_id_from_username(username)
        rel = client.friendship_show(user_id)
        return {"verified": bool(rel.followed_by), "reason": None}
    except UserNotFound:
        return {"verified": False, "reason": "user not found"}
    except ClientError as e:
        log.warning("Instagram check failed for %s: %s", username, e)
        return {"verified": False, "reason": "check failed, try again later"}
