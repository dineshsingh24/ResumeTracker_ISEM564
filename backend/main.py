from __future__ import annotations

from collections.abc import Sequence
import hashlib
import json
import os
import re
import secrets
import shutil
from urllib.parse import urljoin
from urllib.request import Request, urlopen
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import Base, engine, get_db
from backend.models import (
    AIConnection,
    Job,
    JobStatus,
    JobWeightPrompt,
    PasswordResetToken,
    Resume,
    RSSSource,
    RankingRule,
    TelemetryEvent,
    User,
)
from backend.schemas import (
    AIConnectionCreate,
    AIConnectionRead,
    AIConnectionUpdate,
    AuthLogin,
    AuthRegister,
    AuthToken,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    JobCreate,
    JobRead,
    JobUpdate,
    JobWeightPromptCreate,
    JobWeightPromptRead,
    JobWeightPromptUpdate,
    ProfileRead,
    ProfileUpdate,
    ResetPasswordRequest,
    ResumeRead,
    RSSSourceCreate,
    RSSSourceRead,
    RSSSourceUpdate,
    RankingRuleCreate,
    RankingRuleRead,
    RankingRuleUpdate,
    UserCreate,
    UserRead,
    UserSettingsUpdate,
    UserUpdate,
)
from backend.services.rss_service import fetch_and_rank_jobs

class RSSFetchRequest(BaseModel):
    user_id: int
    rss_source_id: Optional[int] = None
    url: Optional[str] = None
    limit: int = Field(default=25, ge=1, le=200)


class RSSPreviewItem(BaseModel):
    title: str
    link: Optional[str] = None
    source: Optional[str] = None
    published: Optional[str] = None
    location: Optional[str] = None
    salary: Optional[str] = None
    role_details: Optional[str] = None
    recruiter: Optional[str] = None
    hiring_manager: Optional[str] = None


class SearchUrlFetchRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=50)


def _fetch_html(url: str) -> str:
    req = Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urlopen(req, timeout=20) as resp:
        charset = resp.headers.get_content_charset() or "utf-8"
        return resp.read().decode(charset, errors="replace")


def _clean_preview_text(value: Optional[str], max_len: int = 240) -> Optional[str]:
    if not value:
        return None
    cleaned = re.sub(r"\s+", " ", str(value)).strip()
    if not cleaned:
        return None
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 3].rstrip() + "..."


def _extract_linkedin_detail_fields(link: Optional[str]) -> dict[str, Optional[str]]:
    result = {
        "role_details": None,
        "salary": None,
        "recruiter": None,
        "hiring_manager": None,
    }
    if not link:
        return result

    try:
        html = _fetch_html(link)
    except Exception:
        return result

    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")

    description_el = (
        soup.select_one(".show-more-less-html__markup")
        or soup.select_one(".description__text")
        or soup.select_one(".jobs-description__content")
    )
    if description_el:
        result["role_details"] = _clean_preview_text(description_el.get_text(" ", strip=True), 280)

    salary_el = (
        soup.select_one(".salary")
        or soup.select_one(".compensation__salary")
        or soup.select_one("[class*='salary']")
    )
    if salary_el:
        result["salary"] = _clean_preview_text(salary_el.get_text(" ", strip=True), 120)

    page_text = soup.get_text(" ", strip=True)
    salary_match = re.search(r"(\$[\d,]+(?:\s*-\s*\$[\d,]+)?(?:\s*(?:a year|per year|a month|per month|an hour|per hour))?)", page_text, re.I)
    if not result["salary"] and salary_match:
        result["salary"] = _clean_preview_text(salary_match.group(1), 120)

    recruiter_match = re.search(r"Recruiter[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})", page_text)
    if recruiter_match:
        result["recruiter"] = _clean_preview_text(recruiter_match.group(1), 120)

    hiring_manager_match = re.search(r"Hiring Manager[:\s]+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})", page_text)
    if hiring_manager_match:
        result["hiring_manager"] = _clean_preview_text(hiring_manager_match.group(1), 120)

    return result


def _parse_linkedin_preview(url: str, html: str, limit: int) -> list[RSSPreviewItem]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    out: list[RSSPreviewItem] = []
    seen: set[tuple[str, str | None]] = set()

    card_selectors = [
        "li.base-card",
        "div.base-card",
        "li .base-search-card__info",
        "div.job-search-card",
    ]

    cards = []
    for selector in card_selectors:
        cards = soup.select(selector)
        if cards:
            break

    def add_item(
        title: str,
        link: Optional[str],
        source: Optional[str],
        published: Optional[str],
        location: Optional[str] = None,
        salary: Optional[str] = None,
        role_details: Optional[str] = None,
        recruiter: Optional[str] = None,
        hiring_manager: Optional[str] = None,
    ) -> None:
        clean_title = str(title or "").strip()
        clean_link = str(link).strip() if link else None
        clean_source = str(source).strip() if source else None
        clean_published = str(published).strip() if published else None
        clean_location = _clean_preview_text(location, 120)
        clean_salary = _clean_preview_text(salary, 120)
        clean_role_details = _clean_preview_text(role_details, 280)
        clean_recruiter = _clean_preview_text(recruiter, 120)
        clean_hiring_manager = _clean_preview_text(hiring_manager, 120)
        key = (clean_title, clean_link)
        if not clean_title or key in seen:
            return
        seen.add(key)
        out.append(
            RSSPreviewItem(
                title=clean_title,
                link=clean_link,
                source=clean_source,
                published=clean_published,
                location=clean_location,
                salary=clean_salary,
                role_details=clean_role_details,
                recruiter=clean_recruiter,
                hiring_manager=clean_hiring_manager,
            )
        )

    for card in cards:
        title_el = (
            card.select_one(".base-search-card__title")
            or card.select_one(".job-search-card__title")
            or card.select_one("h3")
        )
        company_el = (
            card.select_one(".base-search-card__subtitle")
            or card.select_one(".job-search-card__subtitle")
            or card.select_one("h4")
        )
        published_el = (
            card.select_one("time")
            or card.select_one(".job-search-card__listdate")
            or card.select_one(".job-search-card__listdate--new")
        )
        location_el = (
            card.select_one(".job-search-card__location")
            or card.select_one(".base-search-card__metadata")
            or card.select_one(".job-search-card__listdate + span")
        )
        link_el = (
            card.select_one("a.base-card__full-link")
            or card.select_one("a.base-card__link")
            or card.select_one("a")
        )

        title = title_el.get_text(" ", strip=True) if title_el else ""
        company = company_el.get_text(" ", strip=True) if company_el else None
        published = published_el.get_text(" ", strip=True) if published_el else None
        location = location_el.get_text(" ", strip=True) if location_el else None
        link = None
        if link_el and link_el.get("href"):
            link = urljoin(url, link_el.get("href"))

        details = _extract_linkedin_detail_fields(link)
        add_item(
            title,
            link,
            company,
            published,
            location=location,
            salary=details.get("salary"),
            role_details=details.get("role_details"),
            recruiter=details.get("recruiter"),
            hiring_manager=details.get("hiring_manager"),
        )
        if len(out) >= limit:
            return out

    script_nodes = soup.find_all("script", attrs={"type": "application/ld+json"})
    for node in script_nodes:
        raw = node.string or node.get_text(strip=True)
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except Exception:
            continue

        items = payload if isinstance(payload, list) else [payload]
        for item in items:
            if not isinstance(item, dict):
                continue
            graph = item.get("@graph")
            if isinstance(graph, list):
                items.extend(graph)
            if item.get("@type") != "JobPosting":
                continue
            org = item.get("hiringOrganization") or {}
            source = org.get("name") if isinstance(org, dict) else None
            published = item.get("datePosted")
            link = item.get("url")
            location = None
            job_location = item.get("jobLocation")
            if isinstance(job_location, dict):
                address = job_location.get("address") or {}
                if isinstance(address, dict):
                    locality = address.get("addressLocality")
                    region = address.get("addressRegion")
                    country = address.get("addressCountry")
                    location = ", ".join([x for x in [locality, region, country] if x])
            details = _extract_linkedin_detail_fields(link)
            add_item(
                item.get("title", ""),
                link,
                source,
                published,
                location=location,
                salary=details.get("salary"),
                role_details=details.get("role_details"),
                recruiter=details.get("recruiter"),
                hiring_manager=details.get("hiring_manager"),
            )
            if len(out) >= limit:
                return out

    return out


def _parse_html_preview(url: str, html: str, limit: int) -> list[RSSPreviewItem]:
    if "linkedin.com/jobs/search" in url or "linkedin.com/jobs/view" in url:
        return _parse_linkedin_preview(url, html, limit)
    return []


def _compute_rank_score(db: Session, user_id: int, title: str, description: str) -> float:
    score = 0.0
    title_lower = (title or "").lower()
    desc_lower = (description or "").lower()
    rules: list[RankingRule] = (
        db.query(RankingRule)
        .filter(RankingRule.user_id == user_id)
        .filter(RankingRule.is_active == True)
        .all()
    )
    for rule in rules:
        try:
            w = float(rule.weight or 0.0)
        except Exception:
            w = 0.0
        if not rule.attribute or not rule.condition or not rule.match_value:
            continue
        needle = str(rule.match_value).lower()
        hay = title_lower if rule.attribute == "title" else desc_lower if rule.attribute == "description" else ""
        if not hay:
            continue
        matched = False
        if rule.condition == "contains":
            matched = needle in hay
        elif rule.condition == "equals":
            matched = needle == hay.strip()
        if matched:
            score += w
    if "senior tpm" in title_lower:
        score += 30.0
    return float(score)


def create_app() -> FastAPI:
    app = FastAPI(title="ResumeTracker API")

    oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
    pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

    jwt_secret = os.environ.get("APP_JWT_SECRET", "devsecretvalue")
    jwt_alg = "HS256"
    jwt_ttl_minutes = 60 * 24
    uploads_root = os.path.join(os.path.dirname(__file__), "uploads")
    resumes_root = os.path.join(uploads_root, "resumes")
    os.makedirs(resumes_root, exist_ok=True)
    fernet_key_path = os.path.join(uploads_root, "fernet.key")
    os.makedirs(uploads_root, exist_ok=True)

    def _ensure_fernet_key() -> None:
        if os.environ.get("APP_FERNET_KEY"):
            return
        try:
            from cryptography.fernet import Fernet

            if os.path.exists(fernet_key_path):
                with open(fernet_key_path, "r", encoding="utf-8") as f:
                    raw = f.read().strip()
                if raw:
                    os.environ["APP_FERNET_KEY"] = raw
                    return
            raw = Fernet.generate_key().decode("utf-8")
            with open(fernet_key_path, "w", encoding="utf-8") as f:
                f.write(raw)
            os.environ["APP_FERNET_KEY"] = raw
        except Exception:
            return

    def _hash_password(password: str) -> str:
        return pwd_context.hash(password)

    def _verify_password(password: str, password_hash: str) -> bool:
        try:
            return pwd_context.verify(password, password_hash)
        except Exception:
            return False

    def _create_access_token(*, user_id: int) -> str:
        now = datetime.utcnow()
        exp = now + timedelta(minutes=jwt_ttl_minutes)
        payload = {"sub": str(user_id), "exp": exp}
        return jwt.encode(payload, jwt_secret, algorithm=jwt_alg)

    def _get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
        try:
            payload = jwt.decode(token, jwt_secret, algorithms=[jwt_alg])
            sub = payload.get("sub")
            user_id = int(sub)
        except (JWTError, ValueError, TypeError):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        return user

    _default_origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]
    _extra_origins = [
        origin.strip()
        for origin in os.environ.get("APP_CORS_ORIGINS", "").split(",")
        if origin.strip()
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[*_default_origins, *_extra_origins],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def on_startup() -> None:
        _ensure_fernet_key()
        _ensure_sqlite_schema()
        Base.metadata.create_all(bind=engine)

    def _ensure_sqlite_schema() -> None:
        import sqlite3

        try:
            raw_path = engine.url.database or ""
        except Exception:
            raw_path = ""
        if not raw_path:
            return
        db_path = raw_path
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(__file__), db_path)
        db_path = os.path.abspath(db_path)
        if not os.path.exists(db_path):
            return

        try:
            conn = sqlite3.connect(db_path)
            try:
                def cols(table: str) -> set[str]:
                    cur = conn.execute(f"PRAGMA table_info({table})")
                    return {row[1] for row in cur.fetchall()}

                existing_tables = {
                    row[0]
                    for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
                }

                if "jobs" in existing_tables:
                    job_cols = cols("jobs")
                    if "is_tracked" not in job_cols:
                        conn.execute("ALTER TABLE jobs ADD COLUMN is_tracked BOOLEAN NOT NULL DEFAULT 0")
                    if "resume_id" not in job_cols:
                        conn.execute("ALTER TABLE jobs ADD COLUMN resume_id INTEGER")
                        conn.execute("CREATE INDEX IF NOT EXISTS ix_jobs_resume_id ON jobs (resume_id)")

                if "rss_sources" in existing_tables:
                    src_cols = cols("rss_sources")
                    if "last_fetched_at" not in src_cols:
                        conn.execute("ALTER TABLE rss_sources ADD COLUMN last_fetched_at DATETIME")

                if "users" in existing_tables:
                    user_cols = cols("users")
                    if "profile_summary" not in user_cols:
                        conn.execute("ALTER TABLE users ADD COLUMN profile_summary TEXT")
                    if "profile_updated_at" not in user_cols:
                        conn.execute("ALTER TABLE users ADD COLUMN profile_updated_at DATETIME")
                    if "analytics_ai_enabled" not in user_cols:
                        conn.execute("ALTER TABLE users ADD COLUMN analytics_ai_enabled BOOLEAN NOT NULL DEFAULT 0")
                        conn.execute("CREATE INDEX IF NOT EXISTS ix_users_analytics_ai_enabled ON users (analytics_ai_enabled)")

                if "resumes" not in existing_tables:
                    conn.execute(
                        """
                        CREATE TABLE resumes (
                          id INTEGER PRIMARY KEY,
                          user_id INTEGER NOT NULL,
                          file_name VARCHAR(255) NOT NULL,
                          content_type VARCHAR(128),
                          size_bytes INTEGER NOT NULL DEFAULT 0,
                          file_hash VARCHAR(64) NOT NULL,
                          storage_path TEXT NOT NULL,
                          is_selected BOOLEAN NOT NULL DEFAULT 0,
                          created_at DATETIME,
                          FOREIGN KEY(user_id) REFERENCES users(id)
                        )
                        """
                    )
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_resumes_user_id ON resumes (user_id)")
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_resumes_file_hash ON resumes (file_hash)")
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_resumes_is_selected ON resumes (is_selected)")

                if "job_weight_prompts" not in existing_tables:
                    conn.execute(
                        """
                        CREATE TABLE job_weight_prompts (
                          id INTEGER PRIMARY KEY,
                          user_id INTEGER NOT NULL,
                          prompt TEXT NOT NULL,
                          is_enabled BOOLEAN NOT NULL DEFAULT 1,
                          created_at DATETIME,
                          FOREIGN KEY(user_id) REFERENCES users(id)
                        )
                        """
                    )
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_job_weight_prompts_user_id ON job_weight_prompts (user_id)")
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_job_weight_prompts_is_enabled ON job_weight_prompts (is_enabled)")

                if "telemetry_events" not in existing_tables:
                    conn.execute(
                        """
                        CREATE TABLE telemetry_events (
                          id INTEGER PRIMARY KEY,
                          user_id INTEGER NOT NULL,
                          event_type VARCHAR(64) NOT NULL,
                          meta JSON,
                          created_at DATETIME,
                          FOREIGN KEY(user_id) REFERENCES users(id)
                        )
                        """
                    )
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_telemetry_events_user_id ON telemetry_events (user_id)")
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_telemetry_events_event_type ON telemetry_events (event_type)")
                    conn.execute("CREATE INDEX IF NOT EXISTS ix_telemetry_events_created_at ON telemetry_events (created_at)")

                conn.commit()
            finally:
                conn.close()
        except Exception:
            return

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
    def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> User:
        existing = db.query(User).filter(User.email == payload.email).first()
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        data = payload.model_dump()
        password = data.pop("password", None)
        obj = User(**data)
        if password:
            obj.password_hash = _hash_password(password)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.post("/auth/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
    def auth_register(payload: AuthRegister, db: Session = Depends(get_db)) -> User:
        existing = db.query(User).filter(User.email == payload.email).first()
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        obj = User(email=str(payload.email), full_name=payload.full_name, password_hash=_hash_password(payload.password))
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.post("/auth/login", response_model=AuthToken)
    def auth_login(payload: AuthLogin, db: Session = Depends(get_db)) -> AuthToken:
        user = db.query(User).filter(User.email == payload.email).first()
        if user is None or not user.password_hash:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        if not _verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
        return AuthToken(access_token=_create_access_token(user_id=user.id))

    @app.get("/auth/me", response_model=UserRead)
    def auth_me(current_user: User = Depends(_get_current_user)) -> User:
        return current_user

    @app.put("/me/settings", response_model=UserRead)
    def update_my_settings(
        payload: UserSettingsUpdate,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> User:
        update = payload.model_dump(exclude_unset=True)
        if "analytics_ai_enabled" in update and update["analytics_ai_enabled"] is not None:
            current_user.analytics_ai_enabled = bool(update["analytics_ai_enabled"])
        db.add(current_user)
        db.commit()
        db.refresh(current_user)
        return current_user

    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    @app.post("/auth/forgot_password", response_model=ForgotPasswordResponse)
    def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> ForgotPasswordResponse:
        user = db.query(User).filter(User.email == payload.email).first()
        if user is None:
            return ForgotPasswordResponse(message="If the account exists, a reset token was issued")

        token = secrets.token_urlsafe(32)
        token_hash = _hash_token(token)
        expires_at = datetime.utcnow() + timedelta(minutes=30)
        obj = PasswordResetToken(user_id=user.id, token_hash=token_hash, expires_at=expires_at)
        db.add(obj)
        db.commit()
        return ForgotPasswordResponse(message="Reset token issued for testing", reset_token=token)

    @app.post("/auth/reset_password", response_model=dict)
    def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> dict[str, str]:
        token_hash = _hash_token(payload.reset_token)
        now = datetime.utcnow()
        obj = (
            db.query(PasswordResetToken)
            .filter(PasswordResetToken.token_hash == token_hash)
            .order_by(PasswordResetToken.id.desc())
            .first()
        )
        if obj is None or obj.used_at is not None or obj.expires_at < now:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")
        user = db.get(User, obj.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset token")
        user.password_hash = _hash_password(payload.new_password)
        obj.used_at = now
        db.add(user)
        db.add(obj)
        db.commit()
        return {"message": "Password updated"}

    @app.post("/auth/change_password", response_model=dict)
    def change_password(
        payload: ChangePasswordRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> dict[str, str]:
        if not current_user.password_hash:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password not set")
        if not _verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid current password")
        current_user.password_hash = _hash_password(payload.new_password)
        db.add(current_user)
        db.commit()
        return {"message": "Password updated"}

    @app.get("/ai_connections", response_model=list[AIConnectionRead])
    def list_ai_connections(db: Session = Depends(get_db), current_user: User = Depends(_get_current_user)) -> Sequence[AIConnection]:
        return (
            db.query(AIConnection)
            .filter(AIConnection.user_id == current_user.id)
            .order_by(AIConnection.id.asc())
            .all()
        )

    def _encrypt_api_key(api_key: Optional[str]) -> Optional[str]:
        if not api_key:
            return None
        from cryptography.fernet import Fernet

        raw = os.environ.get("APP_FERNET_KEY")
        if not raw:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Server key missing")
        f = Fernet(raw.encode("utf-8"))
        return f.encrypt(api_key.encode("utf-8")).decode("utf-8")

    def _decrypt_api_key(ciphertext: Optional[str]) -> Optional[str]:
        if not ciphertext:
            return None
        from cryptography.fernet import Fernet

        raw = os.environ.get("APP_FERNET_KEY")
        if not raw:
            return None
        try:
            f = Fernet(raw.encode("utf-8"))
            return f.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
        except Exception:
            return None

    def _log_event(db: Session, user_id: int, event_type: str, meta: Optional[dict] = None) -> None:
        try:
            obj = TelemetryEvent(user_id=user_id, event_type=str(event_type), meta=meta or {})
            db.add(obj)
        except Exception:
            return

    def _call_default_llm_text(
        *,
        provider: str,
        model: str,
        base_url: str,
        api_key: str,
        prompt: str,
    ) -> str:
        provider = str(provider or "").strip().lower()
        model = str(model or "").strip()
        base_url = str(base_url or "").strip()
        if not api_key:
            raise RuntimeError("missing api key")

        if provider == "gemini":
            if not model:
                model = "gemini-2.0-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            payload = json.dumps(
                {
                    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.2, "maxOutputTokens": 900},
                }
            ).encode("utf-8")
            req = Request(url, data=payload, headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=45) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            return (
                data.get("candidates", [{}])[0]
                .get("content", {})
                .get("parts", [{}])[0]
                .get("text", "")
            ) or ""

        if provider == "openai":
            if not model:
                model = "gpt-4.1-mini"
            url = "https://api.openai.com/v1/chat/completions"
            payload = json.dumps(
                {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 900,
                }
            ).encode("utf-8")
            req = Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            )
            with urlopen(req, timeout=45) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            return data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""

        if provider == "anthropic":
            if not model:
                model = "claude-3-5-sonnet-latest"
            url = "https://api.anthropic.com/v1/messages"
            payload = json.dumps(
                {
                    "model": model,
                    "max_tokens": 900,
                    "temperature": 0.2,
                    "messages": [{"role": "user", "content": prompt}],
                }
            ).encode("utf-8")
            req = Request(
                url,
                data=payload,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                },
            )
            with urlopen(req, timeout=45) as resp:
                raw = resp.read().decode("utf-8")
            data = json.loads(raw)
            parts = data.get("content", []) or []
            return parts[0].get("text", "") if isinstance(parts, list) and parts and isinstance(parts[0], dict) else ""

        if provider == "custom" and base_url:
            if not model:
                model = "local-model"
            candidates: list[str] = []
            if base_url.endswith("/"):
                candidates.append(f"{base_url}v1/chat/completions")
                candidates.append(f"{base_url}chat/completions")
            else:
                candidates.append(f"{base_url}/v1/chat/completions")
                candidates.append(f"{base_url}/chat/completions")
            payload = json.dumps(
                {
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": 900,
                }
            ).encode("utf-8")
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
            last_err: Optional[Exception] = None
            for url in candidates:
                try:
                    req = Request(url, data=payload, headers=headers)
                    with urlopen(req, timeout=45) as resp:
                        raw = resp.read().decode("utf-8")
                    data = json.loads(raw)
                    return data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
                except Exception as e:
                    last_err = e
                    continue
            raise RuntimeError(str(last_err or "custom llm failed"))

        raise RuntimeError("unsupported provider")

    @app.post("/ai_connections", response_model=AIConnectionRead, status_code=status.HTTP_201_CREATED)
    def create_ai_connection(
        payload: AIConnectionCreate,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> AIConnection:
        if payload.is_default:
            db.query(AIConnection).filter(AIConnection.user_id == current_user.id).update({"is_default": False})

        obj = AIConnection(
            user_id=current_user.id,
            name=payload.name,
            provider=payload.provider,
            base_url=payload.base_url,
            model=payload.model,
            api_key_ciphertext=_encrypt_api_key(payload.api_key),
            is_default=payload.is_default,
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.put("/ai_connections/{conn_id}", response_model=AIConnectionRead)
    def update_ai_connection(
        conn_id: int,
        payload: AIConnectionUpdate,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> AIConnection:
        obj = db.get(AIConnection, conn_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

        update = payload.model_dump(exclude_unset=True)
        if "is_default" in update and update["is_default"] is True:
            db.query(AIConnection).filter(AIConnection.user_id == current_user.id).update({"is_default": False})
            obj.is_default = True
        elif "is_default" in update and update["is_default"] is False:
            obj.is_default = False

        if "name" in update and update["name"] is not None:
            obj.name = str(update["name"])
        if "provider" in update and update["provider"] is not None:
            obj.provider = str(update["provider"])
        if "base_url" in update:
            obj.base_url = update.get("base_url")
        if "model" in update and update["model"] is not None:
            obj.model = str(update["model"])
        if "api_key" in update:
            obj.api_key_ciphertext = _encrypt_api_key(update.get("api_key"))

        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.delete("/ai_connections/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_ai_connection(
        conn_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Response:
        obj = db.get(AIConnection, conn_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        db.delete(obj)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    def _extract_profile_fields(text: str) -> dict[str, Optional[str]]:
        raw = (text or "").strip()
        if not raw:
            return {"full_name": None, "email": None, "phone": None}

        email_match = re.search(r"([A-Za-z0-9._%+]+@[A-Za-z0-9.]+\.[A-Za-z]{2,})", raw)
        phone_match = re.search(r"(\+?1\s*)?(\(?\d{3}\)?[\s.]?)\d{3}[\s.]?\d{4}", raw)

        first_line = raw.splitlines()[0].strip() if raw.splitlines() else ""
        name_guess = first_line if 2 <= len(first_line.split()) <= 5 and len(first_line) <= 64 else None

        phone = None
        try:
            phone = phone_match.group(0).strip() if phone_match else None
        except Exception:
            phone = None

        return {
            "full_name": name_guess,
            "email": email_match.group(1).strip() if email_match else None,
            "phone": phone,
        }

    def _read_resume_text(file: UploadFile) -> str:
        import io

        filename = (file.filename or "").lower()
        data = file.file.read()
        if not data:
            return ""

        if filename.endswith(".txt"):
            try:
                return data.decode("utf-8", errors="ignore")
            except Exception:
                return ""

        if filename.endswith(".pdf"):
            try:
                from pypdf import PdfReader

                reader = PdfReader(io.BytesIO(data))
                parts: list[str] = []
                for page in reader.pages:
                    t = page.extract_text() or ""
                    if t:
                        parts.append(t)
                return "\n".join(parts)
            except Exception:
                return ""

        if filename.endswith(".docx"):
            try:
                import docx

                doc = docx.Document(io.BytesIO(data))
                parts = [p.text for p in doc.paragraphs if p.text]
                return "\n".join(parts)
            except Exception:
                return ""

        return ""

    def _save_resume_file(*, user_id: int, file: UploadFile) -> tuple[str, str, int, str]:
        raw_name = (file.filename or "").strip() or "resume"
        safe_name = re.sub(r"[^A-Za-z0-9._() ]+", "", raw_name).strip()[:180] or "resume"
        content_type = file.content_type

        data = file.file.read()
        if not data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")

        file_hash = hashlib.sha256(data).hexdigest()
        user_dir = os.path.join(resumes_root, str(user_id))
        os.makedirs(user_dir, exist_ok=True)

        ext = ""
        lowered = safe_name.lower()
        if lowered.endswith(".pdf"):
            ext = ".pdf"
        elif lowered.endswith(".docx"):
            ext = ".docx"
        elif lowered.endswith(".txt"):
            ext = ".txt"

        stored_name = f"{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{file_hash[:12]}{ext or ''}"
        stored_path = os.path.join(user_dir, stored_name)
        with open(stored_path, "wb") as f:
            f.write(data)

        size_bytes = int(len(data))
        return safe_name, content_type or None, size_bytes, file_hash, stored_path

    @app.get("/users", response_model=list[UserRead])
    def list_users(db: Session = Depends(get_db)) -> Sequence[User]:
        return db.query(User).order_by(User.id.asc()).all()

    @app.get("/users/{user_id}", response_model=UserRead)
    def get_user(user_id: int, db: Session = Depends(get_db)) -> User:
        obj = db.get(User, user_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return obj

    @app.put("/users/{user_id}", response_model=UserRead)
    def update_user(user_id: int, payload: UserUpdate, db: Session = Depends(get_db)) -> User:
        obj = db.get(User, user_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        update = payload.model_dump(exclude_unset=True)
        if "email" in update:
            existing = db.query(User).filter(User.email == update["email"]).first()
            if existing is not None and existing.id != user_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")
        for k, v in update.items():
            setattr(obj, k, v)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    def _build_profile_summary(*, user: User, resume_text: Optional[str]) -> str:
        lines: list[str] = []

        def add(label: str, value: Optional[str]) -> None:
            v = (value or "").strip()
            if v:
                lines.append(f"{label}: {v}")

        add("Name", user.full_name)
        add("Email", user.email)
        add("Phone", user.phone)
        add("Location", user.location)
        add("Headline", user.headline)
        add("LinkedIn", user.linkedin_url)
        add("Portfolio", user.portfolio_url)
        add("GitHub", user.github_url)
        add("Resume", user.resume_url)

        text = (resume_text or "").strip()
        if text:
            lines.append("")
            lines.append("Resume text")
            snippet = text[:1500].strip()
            lines.append(snippet)

        return "\n".join(lines).strip() or "No profile data saved"

    @app.post("/users/{user_id}/profile", response_model=ProfileRead)
    def update_profile(user_id: int, payload: ProfileUpdate, db: Session = Depends(get_db)) -> ProfileRead:
        from datetime import datetime

        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        update = payload.model_dump(exclude_unset=True)
        resume_text = update.pop("resume_text", None)

        if "email" in update and update["email"] is not None:
            existing = db.query(User).filter(User.email == update["email"]).first()
            if existing is not None and existing.id != user_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already exists")

        for k, v in update.items():
            setattr(user, k, v)

        user.profile_summary = _build_profile_summary(user=user, resume_text=resume_text)
        user.profile_updated_at = datetime.utcnow()

        db.add(user)
        db.commit()
        db.refresh(user)

        if not user.profile_updated_at:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Profile update failed")

        return ProfileRead(
            user_id=user.id,
            profile_summary=str(user.profile_summary or ""),
            profile_updated_at=user.profile_updated_at,
        )

    @app.post("/profile_from_resume", response_model=ProfileRead)
    def profile_from_resume(file: UploadFile = File(...), db: Session = Depends(get_db)) -> ProfileRead:
        from datetime import datetime

        resume_text = _read_resume_text(file)
        fields = _extract_profile_fields(resume_text)

        generated_email = fields.get("email") or f"user{uuid.uuid4().hex}@example.com"
        existing = db.query(User).filter(User.email == generated_email).first()
        if existing is None:
            user = User(email=generated_email)
            db.add(user)
            db.commit()
            db.refresh(user)
        else:
            user = existing

        if fields.get("full_name"):
            user.full_name = fields["full_name"]
        if fields.get("phone"):
            user.phone = fields["phone"]

        user.resume_url = file.filename
        user.profile_summary = _build_profile_summary(user=user, resume_text=resume_text)
        user.profile_updated_at = datetime.utcnow()

        db.add(user)
        db.commit()
        db.refresh(user)

        if not user.profile_updated_at:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Profile update failed")

        return ProfileRead(
            user_id=user.id,
            profile_summary=str(user.profile_summary or ""),
            profile_updated_at=user.profile_updated_at,
        )

    @app.post("/me/profile_from_resume", response_model=ProfileRead)
    def me_profile_from_resume(
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> ProfileRead:
        file.file.seek(0)
        resume_text = _read_resume_text(file)
        file.file.seek(0)
        fields = _extract_profile_fields(resume_text)

        if fields.get("full_name"):
            current_user.full_name = fields["full_name"]
        if fields.get("phone"):
            current_user.phone = fields["phone"]

        current_user.resume_url = file.filename
        current_user.profile_summary = _build_profile_summary(user=current_user, resume_text=resume_text)
        current_user.profile_updated_at = datetime.utcnow()

        db.add(current_user)
        db.commit()
        db.refresh(current_user)

        if not current_user.profile_updated_at:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Profile update failed")

        return ProfileRead(
            user_id=current_user.id,
            profile_summary=str(current_user.profile_summary or ""),
            profile_updated_at=current_user.profile_updated_at,
        )

    @app.get("/me/resumes", response_model=list[ResumeRead])
    def list_my_resumes(db: Session = Depends(get_db), current_user: User = Depends(_get_current_user)) -> list[Resume]:
        return (
            db.query(Resume)
            .filter(Resume.user_id == current_user.id)
            .order_by(Resume.created_at.desc(), Resume.id.desc())
            .all()
        )

    @app.get("/me/job_weight_prompts", response_model=list[JobWeightPromptRead])
    def list_my_job_weight_prompts(
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> list[JobWeightPrompt]:
        return (
            db.query(JobWeightPrompt)
            .filter(JobWeightPrompt.user_id == current_user.id)
            .order_by(JobWeightPrompt.created_at.desc(), JobWeightPrompt.id.desc())
            .all()
        )

    @app.post("/me/job_weight_prompts", response_model=JobWeightPromptRead, status_code=status.HTTP_201_CREATED)
    def create_my_job_weight_prompt(
        payload: JobWeightPromptCreate,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> JobWeightPrompt:
        text = (payload.prompt or "").strip()
        if not text:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Prompt is required")

        existing = (
            db.query(JobWeightPrompt)
            .filter(JobWeightPrompt.user_id == current_user.id)
            .filter(JobWeightPrompt.prompt == text)
            .first()
        )
        if existing is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Prompt already exists")

        obj = JobWeightPrompt(user_id=current_user.id, prompt=text, is_enabled=bool(payload.is_enabled))
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.put("/me/job_weight_prompts/{prompt_id}", response_model=JobWeightPromptRead)
    def update_my_job_weight_prompt(
        prompt_id: int,
        payload: JobWeightPromptUpdate,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> JobWeightPrompt:
        obj = db.get(JobWeightPrompt, prompt_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        update = payload.model_dump(exclude_unset=True)
        if "is_enabled" in update and update["is_enabled"] is not None:
            obj.is_enabled = bool(update["is_enabled"])
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.delete("/me/job_weight_prompts/{prompt_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_my_job_weight_prompt(
        prompt_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Response:
        obj = db.get(JobWeightPrompt, prompt_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        db.delete(obj)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/me/analytics/summary")
    def analytics_summary(
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> dict:
        from sqlalchemy import func

        total_jobs = db.query(func.count(Job.id)).filter(Job.user_id == current_user.id).scalar() or 0
        tracked_jobs = (
            db.query(func.count(Job.id))
            .filter(Job.user_id == current_user.id)
            .filter(Job.is_tracked == True)
            .scalar()
            or 0
        )

        by_company = (
            db.query(Job.company, func.count(Job.id))
            .filter(Job.user_id == current_user.id)
            .group_by(Job.company)
            .order_by(func.count(Job.id).desc())
            .limit(12)
            .all()
        )
        companies = [{"company": c or "Unknown", "count": int(n)} for c, n in by_company]

        by_source = (
            db.query(RSSSource.id, RSSSource.name, RSSSource.url, func.count(Job.id))
            .join(Job, Job.rss_source_id == RSSSource.id)
            .filter(RSSSource.user_id == current_user.id)
            .group_by(RSSSource.id)
            .order_by(func.count(Job.id).desc())
            .all()
        )
        sources = [{"rss_source_id": int(i), "name": n or "Untitled", "url": u, "count": int(c)} for i, n, u, c in by_source]

        by_resume = (
            db.query(Resume.id, Resume.file_name, func.count(Job.id))
            .join(Job, Job.resume_id == Resume.id)
            .filter(Resume.user_id == current_user.id)
            .group_by(Resume.id)
            .order_by(func.count(Job.id).desc())
            .all()
        )
        resumes = [{"resume_id": int(i), "file_name": fn, "count": int(c)} for i, fn, c in by_resume]

        ai_calls = (
            db.query(TelemetryEvent.meta)
            .filter(TelemetryEvent.user_id == current_user.id)
            .filter(TelemetryEvent.event_type == "ai_call")
            .order_by(TelemetryEvent.id.desc())
            .limit(2000)
            .all()
        )
        counts: dict[str, int] = {}
        for (meta,) in ai_calls:
            provider = str((meta or {}).get("provider") or "unknown")
            counts[provider] = counts.get(provider, 0) + 1
        ai_usage = [{"provider": k, "count": int(v)} for k, v in sorted(counts.items(), key=lambda x: x[1], reverse=True)]

        url_fetches = (
            db.query(func.count(TelemetryEvent.id))
            .filter(TelemetryEvent.user_id == current_user.id)
            .filter(TelemetryEvent.event_type == "url_fetch")
            .scalar()
            or 0
        )

        return {
            "total_jobs": int(total_jobs),
            "tracked_jobs": int(tracked_jobs),
            "companies": companies,
            "sources": sources,
            "resumes": resumes,
            "ai_usage": ai_usage,
            "url_fetch_events": int(url_fetches),
            "analytics_ai_enabled": bool(getattr(current_user, "analytics_ai_enabled", False)),
        }

    @app.get("/me/analytics/drilldown")
    def analytics_drilldown(
        kind: str,
        value: Optional[str] = None,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> dict:
        kind = str(kind or "").strip().lower()
        rows: list[dict] = []

        if kind == "company":
            q = db.query(Job).filter(Job.user_id == current_user.id)
            if value:
                q = q.filter(Job.company == value)
            items = q.order_by(Job.updated_at.desc()).limit(500).all()
            rows = [{"id": j.id, "title": j.title, "company": j.company, "location": j.location, "rank_score": j.rank_score, "date_added": j.date_added} for j in items]

        elif kind == "source":
            q = db.query(Job).filter(Job.user_id == current_user.id)
            if value:
                try:
                    q = q.filter(Job.rss_source_id == int(value))
                except Exception:
                    pass
            items = q.order_by(Job.updated_at.desc()).limit(500).all()
            rows = [{"id": j.id, "title": j.title, "company": j.company, "location": j.location, "rank_score": j.rank_score, "date_added": j.date_added} for j in items]

        elif kind == "resume":
            q = db.query(Job).filter(Job.user_id == current_user.id)
            if value:
                try:
                    q = q.filter(Job.resume_id == int(value))
                except Exception:
                    pass
            items = q.order_by(Job.updated_at.desc()).limit(500).all()
            rows = [{"id": j.id, "title": j.title, "company": j.company, "location": j.location, "rank_score": j.rank_score, "date_added": j.date_added} for j in items]

        elif kind == "ai_calls":
            q = (
                db.query(TelemetryEvent)
                .filter(TelemetryEvent.user_id == current_user.id)
                .filter(TelemetryEvent.event_type == "ai_call")
                .order_by(TelemetryEvent.id.desc())
                .limit(1000)
            )
            items = q.all()
            rows = [{"created_at": e.created_at, "meta": e.meta} for e in items]

        elif kind == "url_fetch":
            q = (
                db.query(TelemetryEvent)
                .filter(TelemetryEvent.user_id == current_user.id)
                .filter(TelemetryEvent.event_type == "url_fetch")
                .order_by(TelemetryEvent.id.desc())
                .limit(1000)
            )
            items = q.all()
            rows = [{"created_at": e.created_at, "meta": e.meta} for e in items]

        return {"kind": kind, "value": value, "rows": rows}

    @app.get("/me/analytics/timeseries")
    def analytics_timeseries(
        days: int = 14,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> dict:
        import sqlite3

        d = max(1, min(90, int(days)))
        end = datetime.utcnow().date()
        start = end - timedelta(days=d - 1)

        raw_path = engine.url.database or "jobs.db"
        db_path = raw_path if os.path.isabs(raw_path) else os.path.abspath(os.path.join(os.path.dirname(__file__), raw_path))
        con = sqlite3.connect(db_path)
        con.row_factory = sqlite3.Row
        try:
            rows = con.execute(
                """
                SELECT
                  date(created_at) as day,
                  SUM(CASE WHEN event_type='url_fetch' THEN 1 ELSE 0 END) as url_fetch_events,
                  SUM(CASE WHEN event_type='ai_call' THEN 1 ELSE 0 END) as ai_calls,
                  SUM(CASE WHEN event_type='url_fetch' THEN COALESCE(json_extract(meta,'$.extracted'),0) ELSE 0 END) as extracted,
                  SUM(CASE WHEN event_type='url_fetch' THEN COALESCE(json_extract(meta,'$.duplicates'),0) ELSE 0 END) as duplicates
                FROM telemetry_events
                WHERE user_id = ?
                  AND date(created_at) >= date(?)
                  AND date(created_at) <= date(?)
                GROUP BY date(created_at)
                ORDER BY date(created_at) ASC
                """,
                (current_user.id, str(start), str(end)),
            ).fetchall()

            by_day = {r["day"]: dict(r) for r in rows}
            out = []
            cur = start
            while cur <= end:
                key = cur.isoformat()
                r = by_day.get(key) or {}
                out.append(
                    {
                        "day": key,
                        "url_fetch_events": int(r.get("url_fetch_events") or 0),
                        "ai_calls": int(r.get("ai_calls") or 0),
                        "extracted": int(r.get("extracted") or 0),
                        "duplicates": int(r.get("duplicates") or 0),
                    }
                )
                cur = cur + timedelta(days=1)
            return {"days": d, "series": out}
        finally:
            con.close()

    @app.get("/me/analytics/report")
    def analytics_report(
        use_ai: bool = False,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> dict:
        summary = analytics_summary(db=db, current_user=current_user)
        drill_ai = analytics_drilldown(kind="ai_calls", db=db, current_user=current_user)
        drill_fetch = analytics_drilldown(kind="url_fetch", db=db, current_user=current_user)

        out: dict = {
            "generated_at": datetime.utcnow().isoformat(),
            "summary": summary,
            "ai_calls": drill_ai.get("rows", []),
            "url_fetch": drill_fetch.get("rows", []),
        }

        if use_ai and bool(getattr(current_user, "analytics_ai_enabled", False)):
            default_conn = (
                db.query(AIConnection)
                .filter(AIConnection.user_id == current_user.id)
                .filter(AIConnection.is_default == True)
                .order_by(AIConnection.id.desc())
                .first()
            )
            api_key = _decrypt_api_key(default_conn.api_key_ciphertext) if default_conn is not None else None
            if default_conn is not None and api_key:
                prompt = (
                    "Create a concise analytics report for this job tracker telemetry.\n"
                    "Return markdown with sections Summary, Sources, Companies, Resume usage, AI usage, Notes.\n\n"
                    f"DATA JSON:\n{json.dumps(summary, indent=2)}\n"
                )
                try:
                    text = _call_default_llm_text(
                        provider=default_conn.provider,
                        model=default_conn.model,
                        base_url=default_conn.base_url or "",
                        api_key=api_key,
                        prompt=prompt,
                    )
                    out["ai_report_markdown"] = text
                    _log_event(db, current_user.id, "analytics_ai_report", {"provider": default_conn.provider, "model": default_conn.model})
                except Exception:
                    out["ai_report_markdown"] = ""

        db.commit()
        return out

    @app.post("/me/resumes", response_model=ResumeRead, status_code=status.HTTP_201_CREATED)
    def upload_my_resume(
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Resume:
        file.file.seek(0)
        safe_name, content_type, size_bytes, file_hash, stored_path = _save_resume_file(user_id=current_user.id, file=file)

        existing = (
            db.query(Resume)
            .filter(Resume.user_id == current_user.id)
            .filter(Resume.file_hash == file_hash)
            .first()
        )
        if existing is not None:
            try:
                os.remove(stored_path)
            except Exception:
                pass
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This resume was already uploaded")

        obj = Resume(
            user_id=current_user.id,
            file_name=safe_name,
            content_type=content_type,
            size_bytes=size_bytes,
            file_hash=file_hash,
            storage_path=stored_path,
            is_selected=False,
        )
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.post("/me/resumes/{resume_id}/select", response_model=ResumeRead)
    def select_my_resume(
        resume_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Resume:
        obj = db.get(Resume, resume_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        db.query(Resume).filter(Resume.user_id == current_user.id).update({Resume.is_selected: False})
        obj.is_selected = True
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.get("/me/resumes/{resume_id}/file")
    def get_my_resume_file(
        resume_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Response:
        obj = db.get(Resume, resume_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        if not obj.storage_path or not os.path.exists(obj.storage_path):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
        with open(obj.storage_path, "rb") as f:
            data = f.read()
        media_type = obj.content_type or "application/octet-stream"
        return Response(content=data, media_type=media_type)

    @app.delete("/me/resumes/{resume_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_my_resume(
        resume_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Response:
        obj = db.get(Resume, resume_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        try:
            if obj.storage_path and os.path.exists(obj.storage_path):
                os.remove(obj.storage_path)
        except Exception:
            pass
        db.delete(obj)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/me/profile", response_model=ProfileRead)
    def me_profile(db: Session = Depends(get_db), current_user: User = Depends(_get_current_user)) -> ProfileRead:
        if not current_user.profile_summary or not current_user.profile_updated_at:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not set")
        return ProfileRead(
            user_id=current_user.id,
            profile_summary=str(current_user.profile_summary),
            profile_updated_at=current_user.profile_updated_at,
        )

    @app.get("/users/{user_id}/profile", response_model=ProfileRead)
    def view_profile(user_id: int, db: Session = Depends(get_db)) -> ProfileRead:
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if not user.profile_summary or not user.profile_updated_at:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not set")

        return ProfileRead(
            user_id=user.id,
            profile_summary=str(user.profile_summary),
            profile_updated_at=user.profile_updated_at,
        )

    @app.get("/job_attributes")
    def job_attributes() -> list[dict[str, str]]:
        return [
            {"value": "title", "label": "Title"},
            {"value": "company", "label": "Company"},
            {"value": "description", "label": "Role requirement"},
        ]

    class ReplaceRulesRequest(BaseModel):
        user_id: int
        rules: list[RankingRuleCreate]

    @app.post("/ranking_rules/replace", response_model=list[RankingRuleRead])
    def replace_ranking_rules(payload: ReplaceRulesRequest, db: Session = Depends(get_db)) -> Sequence[RankingRule]:
        user = db.get(User, payload.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User does not exist")

        db.query(RankingRule).filter(RankingRule.user_id == payload.user_id).delete()
        created: list[RankingRule] = []
        for rule in payload.rules:
            obj = RankingRule(**rule.model_dump())
            db.add(obj)
            created.append(obj)

        db.commit()
        for obj in created:
            db.refresh(obj)
        return created

    @app.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_user(user_id: int, db: Session = Depends(get_db)) -> Response:
        obj = db.get(User, user_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        db.delete(obj)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/ranking_rules", response_model=RankingRuleRead, status_code=status.HTTP_201_CREATED)
    def create_ranking_rule(payload: RankingRuleCreate, db: Session = Depends(get_db)) -> RankingRule:
        user = db.get(User, payload.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User does not exist")
        obj = RankingRule(**payload.model_dump())
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.get("/ranking_rules", response_model=list[RankingRuleRead])
    def list_ranking_rules(db: Session = Depends(get_db)) -> Sequence[RankingRule]:
        return db.query(RankingRule).order_by(RankingRule.id.asc()).all()

    @app.get("/ranking_rules/{rule_id}", response_model=RankingRuleRead)
    def get_ranking_rule(rule_id: int, db: Session = Depends(get_db)) -> RankingRule:
        obj = db.get(RankingRule, rule_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ranking rule not found")
        return obj

    @app.put("/ranking_rules/{rule_id}", response_model=RankingRuleRead)
    def update_ranking_rule(
        rule_id: int,
        payload: RankingRuleUpdate,
        db: Session = Depends(get_db),
    ) -> RankingRule:
        obj = db.get(RankingRule, rule_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ranking rule not found")
        update = payload.model_dump(exclude_unset=True)
        for k, v in update.items():
            setattr(obj, k, v)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.delete("/ranking_rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_ranking_rule(rule_id: int, db: Session = Depends(get_db)) -> Response:
        obj = db.get(RankingRule, rule_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ranking rule not found")
        db.delete(obj)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/rss_sources", response_model=RSSSourceRead, status_code=status.HTTP_201_CREATED)
    def create_rss_source(payload: RSSSourceCreate, db: Session = Depends(get_db)) -> RSSSource:
        user = db.get(User, payload.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User does not exist")
        obj = RSSSource(**payload.model_dump())
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.get("/rss_sources", response_model=list[RSSSourceRead])
    def list_rss_sources(db: Session = Depends(get_db)) -> Sequence[RSSSource]:
        return db.query(RSSSource).order_by(RSSSource.id.asc()).all()

    @app.get("/rss_sources/{source_id}", response_model=RSSSourceRead)
    def get_rss_source(source_id: int, db: Session = Depends(get_db)) -> RSSSource:
        obj = db.get(RSSSource, source_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RSS source not found")
        return obj

    @app.put("/rss_sources/{source_id}", response_model=RSSSourceRead)
    def update_rss_source(
        source_id: int,
        payload: RSSSourceUpdate,
        db: Session = Depends(get_db),
    ) -> RSSSource:
        obj = db.get(RSSSource, source_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RSS source not found")
        update = payload.model_dump(exclude_unset=True)
        for k, v in update.items():
            setattr(obj, k, v)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.delete("/rss_sources/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_rss_source(source_id: int, db: Session = Depends(get_db)) -> Response:
        obj = db.get(RSSSource, source_id)
        if obj is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RSS source not found")
        db.delete(obj)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/rss/fetch", response_model=list[JobRead], status_code=status.HTTP_201_CREATED)
    def fetch_rss(payload: RSSFetchRequest, db: Session = Depends(get_db)) -> Sequence[Job]:
        rss_url = payload.url
        rss_source_id = payload.rss_source_id

        if rss_url is None and rss_source_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="URL or RSS source id is required")

        if rss_url is None and rss_source_id is not None:
            src = db.get(RSSSource, rss_source_id)
            if src is None:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="RSS source not found")
            if src.user_id != payload.user_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RSS source does not match user")
            rss_url = src.url

        created = fetch_and_rank_jobs(
            db,
            user_id=payload.user_id,
            rss_url=str(rss_url),
            rss_source_id=rss_source_id,
            limit=payload.limit,
        )
        return created

    @app.get("/rss/preview", response_model=list[RSSPreviewItem])
    def preview_rss(url: str, limit: int = 15) -> list[RSSPreviewItem]:
        import feedparser

        safe_limit = max(1, min(50, int(limit)))
        parsed = feedparser.parse(url)
        entries = list(getattr(parsed, "entries", []) or [])[:safe_limit]
        out: list[RSSPreviewItem] = []
        for entry in entries:
            out.append(
                RSSPreviewItem(
                    title=str(getattr(entry, "title", "") or "").strip(),
                    link=getattr(entry, "link", None),
                    source=getattr(entry, "author", None) or getattr(entry, "publisher", None),
                    published=getattr(entry, "published", None),
                    location=getattr(entry, "location", None),
                    salary=getattr(entry, "salary", None),
                    role_details=getattr(entry, "summary", None) or getattr(entry, "description", None),
                    recruiter=None,
                    hiring_manager=None,
                )
            )
        if out:
            return out

        try:
            html = _fetch_html(url)
        except Exception:
            return []

        return _parse_html_preview(url, html, safe_limit)

    @app.post("/search_urls/fetch", response_model=list[JobRead], status_code=status.HTTP_201_CREATED)
    def fetch_search_urls(
        payload: SearchUrlFetchRequest,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> list[Job]:
        now = datetime.utcnow()
        limit = max(1, min(50, int(payload.limit)))

        selected_resume = (
            db.query(Resume)
            .filter(Resume.user_id == current_user.id)
            .filter(Resume.is_selected == True)
            .order_by(Resume.created_at.desc())
            .first()
        )
        selected_resume_id = selected_resume.id if selected_resume is not None else None

        enabled_prompts: list[JobWeightPrompt] = (
            db.query(JobWeightPrompt)
            .filter(JobWeightPrompt.user_id == current_user.id)
            .filter(JobWeightPrompt.is_enabled == True)
            .order_by(JobWeightPrompt.created_at.asc())
            .all()
        )
        prompt_text = "\n\n".join([p.prompt for p in enabled_prompts if p.prompt]) if enabled_prompts else ""

        default_conn = (
            db.query(AIConnection)
            .filter(AIConnection.user_id == current_user.id)
            .filter(AIConnection.is_default == True)
            .order_by(AIConnection.id.desc())
            .first()
        )
        api_key = _decrypt_api_key(default_conn.api_key_ciphertext) if default_conn is not None else None
        provider_name = str(default_conn.provider) if default_conn is not None else ""
        model_name = str(default_conn.model) if default_conn is not None else ""

        def _heuristic_score(resume_text: str, job_title: str, job_desc: str) -> float:
            rt = (resume_text or "").lower()
            jt = (job_title or "").lower()
            jd = (job_desc or "").lower()
            tokens = [t for t in re.sub(r"[^a-z0-9\\s]", " ", rt).split() if len(t) >= 4]
            uniq = list(dict.fromkeys(tokens))[:80]
            if not uniq:
                return 55.0
            hay = f"{jt} {jd}"
            hits = sum(1 for t in uniq if t in hay)
            pct = round((hits / max(len(uniq), 12)) * 100)
            return float(max(0, min(100, 40 + pct)))

        def _parse_llm_score(text: str) -> Optional[float]:
            s = str(text or "")
            m = re.search(r"\\{[\\s\\S]*\\}", s)
            if m:
                try:
                    parsed = json.loads(m.group(0))
                    score = float(parsed.get("score"))
                    return float(max(0, min(100, round(score))))
                except Exception:
                    pass
            m2 = re.search(r"(\\b100\\b|\\b\\d{1,2}\\b)", s)
            if m2:
                try:
                    score2 = float(m2.group(1))
                    return float(max(0, min(100, round(score2))))
                except Exception:
                    return None
            return None

        def _llm_score(resume_text: str, job_title: str, job_desc: str) -> Optional[float]:
            if default_conn is None:
                return None

            provider = str(default_conn.provider or "").strip().lower()
            model = str(default_conn.model or "").strip()
            base_url = str(default_conn.base_url or "").strip()

            extra = f"\n\nCUSTOM WEIGHTING INSTRUCTIONS:\n{prompt_text}\n" if prompt_text else ""
            user_prompt = (
                "You are scoring how well a job matches a resume.\n\n"
                "Return ONLY a JSON object with keys score and reason.\n"
                "score must be an integer from 0 to 100.\n"
                "reason must be a short sentence.\n\n"
                f"RESUME SUMMARY:\n{resume_text or ''}\n\n"
                f"JOB TITLE:\n{job_title or ''}\n\n"
                f"JOB DESCRIPTION:\n{job_desc or ''}{extra}\n"
            )

            try:
                call_started = datetime.utcnow()
                if provider == "gemini":
                    if not api_key:
                        return None
                    if not model:
                        model = "gemini-2.0-flash"
                    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
                    payload = json.dumps(
                        {
                            "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
                            "generationConfig": {"temperature": 0.2, "maxOutputTokens": 200},
                        }
                    ).encode("utf-8")
                    req = Request(url, data=payload, headers={"Content-Type": "application/json"})
                    with urlopen(req, timeout=30) as resp:
                        raw = resp.read().decode("utf-8")
                    data = json.loads(raw)
                    text = (
                        data.get("candidates", [{}])[0]
                        .get("content", {})
                        .get("parts", [{}])[0]
                        .get("text", "")
                    )
                    scored = _parse_llm_score(str(text or ""))
                    _log_event(
                        db,
                        current_user.id,
                        "ai_call",
                        {
                            "provider": provider,
                            "model": model,
                            "ok": bool(scored is not None),
                            "ms": int((datetime.utcnow() - call_started).total_seconds() * 1000),
                        },
                    )
                    return scored

                if provider == "openai":
                    if not api_key:
                        return None
                    if not model:
                        model = "gpt-4.1-mini"
                    url = "https://api.openai.com/v1/chat/completions"
                    payload = json.dumps(
                        {
                            "model": model,
                            "messages": [{"role": "user", "content": user_prompt}],
                            "temperature": 0.2,
                            "max_tokens": 200,
                        }
                    ).encode("utf-8")
                    req = Request(
                        url,
                        data=payload,
                        headers={
                            "Content-Type": "application/json",
                            "Authorization": f"Bearer {api_key}",
                        },
                    )
                    with urlopen(req, timeout=30) as resp:
                        raw = resp.read().decode("utf-8")
                    data = json.loads(raw)
                    text = (
                        data.get("choices", [{}])[0]
                        .get("message", {})
                        .get("content", "")
                    )
                    scored = _parse_llm_score(str(text or ""))
                    _log_event(
                        db,
                        current_user.id,
                        "ai_call",
                        {
                            "provider": provider,
                            "model": model,
                            "ok": bool(scored is not None),
                            "ms": int((datetime.utcnow() - call_started).total_seconds() * 1000),
                        },
                    )
                    return scored

                if provider == "anthropic":
                    if not api_key:
                        return None
                    if not model:
                        model = "claude-3-5-sonnet-latest"
                    url = "https://api.anthropic.com/v1/messages"
                    payload = json.dumps(
                        {
                            "model": model,
                            "max_tokens": 200,
                            "temperature": 0.2,
                            "messages": [{"role": "user", "content": user_prompt}],
                        }
                    ).encode("utf-8")
                    req = Request(
                        url,
                        data=payload,
                        headers={
                            "Content-Type": "application/json",
                            "x-api-key": api_key,
                            "anthropic-version": "2023-06-01",
                        },
                    )
                    with urlopen(req, timeout=30) as resp:
                        raw = resp.read().decode("utf-8")
                    data = json.loads(raw)
                    parts = data.get("content", []) or []
                    text = parts[0].get("text", "") if isinstance(parts, list) and parts and isinstance(parts[0], dict) else ""
                    scored = _parse_llm_score(str(text or ""))
                    _log_event(
                        db,
                        current_user.id,
                        "ai_call",
                        {
                            "provider": provider,
                            "model": model,
                            "ok": bool(scored is not None),
                            "ms": int((datetime.utcnow() - call_started).total_seconds() * 1000),
                        },
                    )
                    return scored

                if provider == "custom" and base_url:
                    if not model:
                        model = "local-model"
                    candidates = []
                    if base_url.endswith("/"):
                        candidates.append(f"{base_url}v1/chat/completions")
                        candidates.append(f"{base_url}chat/completions")
                    else:
                        candidates.append(f"{base_url}/v1/chat/completions")
                        candidates.append(f"{base_url}/chat/completions")
                    payload = json.dumps(
                        {
                            "model": model,
                            "messages": [{"role": "user", "content": user_prompt}],
                            "temperature": 0.2,
                            "max_tokens": 200,
                        }
                    ).encode("utf-8")
                    headers = {"Content-Type": "application/json"}
                    if api_key:
                        headers["Authorization"] = f"Bearer {api_key}"
                    for url in candidates:
                        try:
                            req = Request(url, data=payload, headers=headers)
                            with urlopen(req, timeout=30) as resp:
                                raw = resp.read().decode("utf-8")
                            data = json.loads(raw)
                            text = (
                                data.get("choices", [{}])[0]
                                .get("message", {})
                                .get("content", "")
                            )
                            scored = _parse_llm_score(str(text or ""))
                            if scored is not None:
                                _log_event(
                                    db,
                                    current_user.id,
                                    "ai_call",
                                    {
                                        "provider": provider,
                                        "model": model,
                                        "ok": True,
                                        "ms": int((datetime.utcnow() - call_started).total_seconds() * 1000),
                                    },
                                )
                                return scored
                        except Exception:
                            continue
            except Exception:
                _log_event(
                    db,
                    current_user.id,
                    "ai_call",
                    {
                        "provider": provider_name,
                        "model": model_name,
                        "ok": False,
                    },
                )
                return None

            return None

        sources: list[RSSSource] = (
            db.query(RSSSource)
            .filter(RSSSource.user_id == current_user.id)
            .filter(RSSSource.is_active == True)
            .order_by(RSSSource.id.asc())
            .all()
        )

        created: list[Job] = []
        for src in sources:
            extracted_count = 0
            duplicate_count = 0
            try:
                html = _fetch_html(src.url)
            except Exception:
                continue
            items = _parse_html_preview(src.url, html, limit)
            for item in items:
                link = (item.link or "").strip() or None
                title = (item.title or "").strip()
                if not title:
                    continue
                if link:
                    existing = (
                        db.query(Job)
                        .filter(Job.user_id == current_user.id)
                        .filter(Job.url == link)
                        .first()
                    )
                    if existing is not None:
                        duplicate_count += 1
                        changed = False
                        if selected_resume_id is not None and getattr(existing, "resume_id", None) is None:
                            existing.resume_id = selected_resume_id
                            changed = True
                        new_desc = (item.role_details or "").strip() or None
                        if new_desc and (existing.description or "") != new_desc:
                            existing.description = new_desc
                            changed = True
                        if item.source and (existing.company or "") != str(item.source):
                            existing.company = str(item.source)
                            changed = True
                        if item.location and (existing.location or "") != str(item.location):
                            existing.location = str(item.location)
                            changed = True

                        resume_text = str(current_user.profile_summary or "")
                        score_val = _llm_score(resume_text, title, new_desc or (existing.description or "") or "")
                        score = float(score_val) if score_val is not None else _heuristic_score(
                            resume_text, title, new_desc or (existing.description or "") or ""
                        )
                        if float(existing.rank_score or 0.0) != float(score):
                            existing.rank_score = float(score)
                            changed = True
                        existing.updated_at = now
                        changed = True
                        if changed:
                            db.add(existing)
                        continue

                description = (item.role_details or "").strip() or None
                resume_text = str(current_user.profile_summary or "")
                score_val = _llm_score(resume_text, title, description or "")
                score = float(score_val) if score_val is not None else _heuristic_score(resume_text, title, description or "")
                extracted_count += 1

                job = Job(
                    user_id=current_user.id,
                    rss_source_id=src.id,
                    resume_id=selected_resume_id,
                    title=title,
                    company=(item.source or None),
                    location=(item.location or None),
                    url=link,
                    description=description,
                    status=JobStatus.saved,
                    is_tracked=False,
                    rank_score=score,
                    date_added=now,
                )
                db.add(job)
                created.append(job)

            src.last_fetched_at = now
            db.add(src)
            _log_event(
                db,
                current_user.id,
                "url_fetch",
                {
                    "rss_source_id": src.id,
                    "url": src.url,
                    "extracted": extracted_count,
                    "duplicates": duplicate_count,
                    "provider": provider_name,
                    "model": model_name,
                },
            )

        if created:
            db.commit()
            for j in created:
                db.refresh(j)
        else:
            db.commit()

        return created

    @app.post("/jobs", response_model=JobRead, status_code=status.HTTP_201_CREATED)
    def create_job(payload: JobCreate, db: Session = Depends(get_db)) -> Job:
        user = db.get(User, payload.user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User does not exist")
        if payload.rss_source_id is not None:
            rss_source = db.get(RSSSource, payload.rss_source_id)
            if rss_source is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RSS source does not exist")
        if payload.ranking_rule_id is not None:
            ranking_rule = db.get(RankingRule, payload.ranking_rule_id)
            if ranking_rule is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ranking rule does not exist")
        obj = Job(**payload.model_dump())
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.get("/jobs", response_model=list[JobRead])
    def list_jobs(
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Sequence[Job]:
        return (
            db.query(Job)
            .filter(Job.user_id == current_user.id)
            .order_by(Job.id.asc())
            .all()
        )

    @app.get("/jobs/{job_id}", response_model=JobRead)
    def get_job(
        job_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Job:
        obj = db.get(Job, job_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        return obj

    @app.put("/jobs/{job_id}", response_model=JobRead)
    def update_job(
        job_id: int,
        payload: JobUpdate,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Job:
        obj = db.get(Job, job_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        update = payload.model_dump(exclude_unset=True)
        if "rss_source_id" in update and update["rss_source_id"] is not None:
            rss_source = db.get(RSSSource, update["rss_source_id"])
            if rss_source is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RSS source does not exist")
        if "ranking_rule_id" in update and update["ranking_rule_id"] is not None:
            ranking_rule = db.get(RankingRule, update["ranking_rule_id"])
            if ranking_rule is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ranking rule does not exist")
        for k, v in update.items():
            setattr(obj, k, v)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.post("/jobs/{job_id}/track", response_model=JobRead)
    def track_job(
        job_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Job:
        obj = db.get(Job, job_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        obj.is_tracked = True
        if not obj.status:
            obj.status = JobStatus.saved
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.post("/jobs/{job_id}/untrack", response_model=JobRead)
    def untrack_job(
        job_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Job:
        obj = db.get(Job, job_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        obj.is_tracked = False
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @app.delete("/jobs/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_job(
        job_id: int,
        db: Session = Depends(get_db),
        current_user: User = Depends(_get_current_user),
    ) -> Response:
        obj = db.get(Job, job_id)
        if obj is None or obj.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
        db.delete(obj)
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    """Serve built React app from frontend/dist when present (Cloud Run / production)."""
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
    index_html = os.path.join(frontend_dist, "index.html")

    if not os.path.isdir(frontend_dist) or not os.path.isfile(index_html):
        print(f"[startup] frontend bundle missing at {frontend_dist}", flush=True)

        @app.get("/", include_in_schema=False)
        def serve_api_root() -> dict[str, str]:
            return {"status": "ok", "message": "ResumeTracker API is running", "docs": "/docs"}

        return

    print(f"[startup] serving frontend from {frontend_dist}", flush=True)
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

    @app.get("/", include_in_schema=False)
    def serve_root() -> FileResponse:
        return FileResponse(index_html)

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str) -> FileResponse:
        if full_path.startswith("assets/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
        candidate = os.path.join(frontend_dist, full_path)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(index_html)


app = create_app()

