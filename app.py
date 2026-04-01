from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import sys
import time
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent


def resolve_env_path(value: str | None, default: Path) -> Path:
    if not value:
        return default

    candidate = Path(value).expanduser()

    if not candidate.is_absolute():
        candidate = BASE_DIR / candidate

    return candidate.resolve()


STORAGE_DIR = resolve_env_path(os.environ.get("XSHOW_STORAGE_DIR"), BASE_DIR)
DATA_DIR = resolve_env_path(os.environ.get("XSHOW_DATA_DIR"), STORAGE_DIR / "data")
UPLOAD_DIR = resolve_env_path(os.environ.get("XSHOW_UPLOAD_DIR"), STORAGE_DIR / "uploads")
DB_PATH = resolve_env_path(os.environ.get("XSHOW_DB_PATH"), DATA_DIR / "xshow.db")

ADMIN_KEY = os.environ.get("XSHOW_ADMIN_KEY", "xshow-director")
SESSION_SECRET = os.environ.get("XSHOW_SESSION_SECRET", "xshow-local-session-secret")
SESSION_COOKIE = "xshow_admin"
SESSION_COOKIE_SECURE = os.environ.get("XSHOW_SESSION_COOKIE_SECURE", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
SESSION_TTL_SECONDS = 12 * 60 * 60
MAX_UPLOAD_SIZE = 512 * 1024 * 1024
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}
KNOWN_TONES = {"ember", "neon", "starlight", "midnight", "sunrise", "velocity"}
ROOT_STATIC_FILES = {"index.html", "styles.css", "script.js", "watch.html", "watch.js"}
CHANNEL_FORMATS = {
    "Website": "Hero takeover",
    "TikTok": "Vertical teaser",
    "YouTube Shorts": "Loop cut",
    "Film Forums": "Poster + trailer thread",
    "Communities": "Creator drop",
    "Instagram Reels": "Highlights cut",
}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or f"xshow-{secrets.token_hex(4)}"


def format_duration(seconds: int) -> str:
    total_seconds = max(int(seconds or 0), 0)
    minutes, remainder = divmod(total_seconds, 60)
    return f"{minutes}:{remainder:02d}"


def json_loads_or_default(raw: str | None, fallback: list[str]) -> list[str]:
    if not raw:
        return fallback

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return fallback


def parse_tags(raw_tags: str) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()

    for part in re.split(r",|\n", raw_tags):
        cleaned = re.sub(r"\s+", " ", part).strip()
        lowered = cleaned.casefold()

        if not cleaned or lowered in seen:
            continue

        seen.add(lowered)
        tags.append(cleaned)

    return tags


def infer_category(kind: str, style: str, title: str = "") -> str:
    text = f"{title} {style}".lower()

    if kind == "commercial":
        return "Launch"

    if any(keyword in text for keyword in ("romance", "love", "heart")):
        return "Romance"

    if any(keyword in text for keyword in ("fantasy", "kingdom", "myth", "epic")):
        return "Fantasy"

    if any(keyword in text for keyword in ("action", "battle", "velocity", "chase")):
        return "Action"

    if any(keyword in text for keyword in ("thriller", "horror", "dark", "suspense")):
        return "Thriller"

    if any(keyword in text for keyword in ("sci-fi", "scifi", "future", "neon", "dystopia", "space", "noir")):
        return "Sci-Fi"

    return "Drama"


def infer_tags(title: str, style: str, kind: str, category: str) -> list[str]:
    raw_tags = [category, style, "AI Trailer" if kind == "trailer" else "Campaign"]
    tags: list[str] = []
    seen: set[str] = set()

    for value in raw_tags:
        cleaned = re.sub(r"\s+", " ", value).strip()
        lowered = cleaned.casefold()

        if not cleaned or lowered in seen:
            continue

        seen.add(lowered)
        tags.append(cleaned)

    return tags[:4]


def infer_poster_tone(category: str, style: str) -> str:
    text = f"{category} {style}".lower()

    if any(keyword in text for keyword in ("romance", "dream", "starlight")):
        return "starlight"

    if any(keyword in text for keyword in ("fantasy", "epic", "kingdom", "sun")):
        return "sunrise"

    if any(keyword in text for keyword in ("sci-fi", "scifi", "future", "neon", "dystopia")):
        return "neon"

    if any(keyword in text for keyword in ("launch", "creator", "community", "campaign")):
        return "velocity"

    if any(keyword in text for keyword in ("action", "thriller", "dark", "battle")):
        return "ember"

    return "midnight"


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def build_session_token() -> tuple[str, int]:
    expires_at = int(time.time()) + SESSION_TTL_SECONDS
    signature = hmac.new(
        SESSION_SECRET.encode("utf-8"),
        str(expires_at).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{expires_at}.{signature}", expires_at


def build_session_cookie(token: str, max_age: int) -> str:
    parts = [
        f"{SESSION_COOKIE}={token}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={max_age}",
    ]

    if SESSION_COOKIE_SECURE:
        parts.append("Secure")

    return "; ".join(parts)


def is_valid_session_token(token: str | None) -> bool:
    if not token or "." not in token:
        return False

    expires_at_raw, signature = token.split(".", 1)

    if not expires_at_raw.isdigit():
        return False

    expected_signature = hmac.new(
        SESSION_SECRET.encode("utf-8"),
        expires_at_raw.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(signature, expected_signature):
        return False

    return int(expires_at_raw) > int(time.time())


def next_unique_slug(connection: sqlite3.Connection, title: str) -> str:
    base_slug = slugify(title)
    candidate = base_slug
    index = 1

    while connection.execute(
        "SELECT 1 FROM videos WHERE slug = ? LIMIT 1",
        (candidate,),
    ).fetchone():
        index += 1
        candidate = f"{base_slug}-{index}"

    return candidate


def serialize_video(row: sqlite3.Row | None) -> dict[str, object] | None:
    if row is None:
        return None

    file_name = row["file_name"]
    video_url = None

    if file_name and (UPLOAD_DIR / file_name).exists():
        video_url = f"/uploads/{file_name}"

    channels = json_loads_or_default(row["channels_json"], ["Website"])
    category = row["category"] or infer_category(row["kind"], row["style"], row["title"])
    tags = json_loads_or_default(
        row["tags_json"],
        infer_tags(row["title"], row["style"], row["kind"], category),
    )

    return {
        "id": row["id"],
        "title": row["title"],
        "slug": row["slug"],
        "kind": row["kind"],
        "style": row["style"],
        "category": category,
        "tags": tags,
        "description": row["description"],
        "channels": channels,
        "status": row["status"],
        "posterTone": row["poster_tone"],
        "durationSeconds": row["duration_seconds"],
        "durationLabel": format_duration(row["duration_seconds"]),
        "featured": bool(row["featured"]),
        "watchUrl": f"/watch/{row['slug']}",
        "videoUrl": video_url,
        "createdAt": row["created_at"],
    }


def serialize_broadcast(row: sqlite3.Row) -> dict[str, str]:
    return {
        "platform": row["platform"],
        "state": row["state"],
        "format": row["format"],
        "headline": row["headline"],
        "launchWindow": row["launch_window"],
        "videoTitle": row["video_title"] or "Untitled asset",
    }


def fetch_videos(connection: sqlite3.Connection, kind: str, limit: int = 9) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT *
        FROM videos
        WHERE kind = ?
        ORDER BY featured DESC, created_at DESC, id DESC
        LIMIT ?
        """,
        (kind, limit),
    ).fetchall()
    return [serialize_video(row) for row in rows if row]


def fetch_video_by_slug(connection: sqlite3.Connection, slug: str) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT *
        FROM videos
        WHERE slug = ? AND kind = 'trailer'
        LIMIT 1
        """,
        (slug,),
    ).fetchone()
    return serialize_video(row)


def fetch_related_videos(
    connection: sqlite3.Connection,
    current_video: dict[str, object],
    limit: int = 6,
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT *
        FROM videos
        WHERE kind = 'trailer' AND id != ?
        ORDER BY featured DESC, created_at DESC, id DESC
        LIMIT 24
        """,
        (current_video["id"],),
    ).fetchall()
    related = [serialize_video(row) for row in rows if row]
    current_tags = {tag.casefold() for tag in current_video["tags"]}

    def score(video: dict[str, object]) -> tuple[int, int, int, str]:
        related_tags = {tag.casefold() for tag in video["tags"]}
        return (
            1 if video["category"] == current_video["category"] else 0,
            len(current_tags & related_tags),
            1 if video["featured"] else 0,
            str(video["createdAt"]),
        )

    return sorted(related, key=score, reverse=True)[:limit]


def fetch_spotlight(connection: sqlite3.Connection, kind: str) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT *
        FROM videos
        WHERE kind = ?
        ORDER BY featured DESC, spotlight_rank DESC, created_at DESC, id DESC
        LIMIT 1
        """,
        (kind,),
    ).fetchone()
    return serialize_video(row)


def fetch_broadcasts(connection: sqlite3.Connection, limit: int = 9) -> list[dict[str, str]]:
    rows = connection.execute(
        """
        SELECT
            broadcast_posts.platform,
            broadcast_posts.state,
            broadcast_posts.format,
            broadcast_posts.headline,
            broadcast_posts.launch_window,
            videos.title AS video_title
        FROM broadcast_posts
        LEFT JOIN videos ON videos.id = broadcast_posts.video_id
        ORDER BY
            CASE broadcast_posts.state
                WHEN 'Live' THEN 0
                WHEN 'Queued' THEN 1
                ELSE 2
            END,
            broadcast_posts.id DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return [serialize_broadcast(row) for row in rows]


def build_category_list(videos: list[dict[str, object]]) -> list[str]:
    categories = ["All"]
    seen: set[str] = set()

    for video in videos:
        category = str(video["category"]).strip()

        if not category or category in seen:
            continue

        seen.add(category)
        categories.append(category)

    return categories


def build_home_payload(is_creator: bool) -> dict[str, object]:
    with get_connection() as connection:
        trailers = fetch_videos(connection, "trailer", limit=24)
        featured_trailer = fetch_spotlight(connection, "trailer") or (trailers[0] if trailers else None)

    trailer_count = len(trailers)
    category_count = max(len(build_category_list(trailers)) - 1, 0)

    return {
        "hero": {
            "summary": (
                "A trailer-first launch surface with a cinematic featured player, "
                "dedicated watch pages, and private uploads for new releases."
            )
        },
        "featuredTrailer": featured_trailer,
        "trailers": trailers,
        "categories": build_category_list(trailers),
        "counts": {
            "trailers": trailer_count,
            "categories": category_count,
        },
        "creator": {
            "isAuthenticated": is_creator,
            "maxUploadMb": MAX_UPLOAD_SIZE // (1024 * 1024),
        },
    }


def build_trailer_payload(slug: str, is_creator: bool) -> dict[str, object] | None:
    with get_connection() as connection:
        trailer = fetch_video_by_slug(connection, slug)

        if not trailer:
            return None

        related = fetch_related_videos(connection, trailer)

    return {
        "trailer": trailer,
        "related": related,
        "creator": {
            "isAuthenticated": is_creator,
        },
    }


def ensure_directories() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def ensure_video_metadata_columns(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(videos)").fetchall()
    }

    if "category" not in columns:
        connection.execute(
            "ALTER TABLE videos ADD COLUMN category TEXT NOT NULL DEFAULT 'Drama'"
        )

    if "tags_json" not in columns:
        connection.execute(
            "ALTER TABLE videos ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"
        )

    rows = connection.execute(
        """
        SELECT id, title, kind, style, category, tags_json, poster_tone
        FROM videos
        """
    ).fetchall()

    for row in rows:
        current_category = (row["category"] or "").strip()
        category = (
            current_category
            if current_category and current_category.casefold() != "drama"
            else infer_category(row["kind"], row["style"], row["title"])
        )
        current_tags = json_loads_or_default(row["tags_json"], [])
        tags = current_tags or infer_tags(row["title"], row["style"], row["kind"], category)
        poster_tone = row["poster_tone"] or infer_poster_tone(category, row["style"])

        connection.execute(
            """
            UPDATE videos
            SET category = ?, tags_json = ?, poster_tone = ?
            WHERE id = ?
            """,
            (
                category,
                json.dumps(tags),
                poster_tone,
                row["id"],
            ),
        )


def seed_database(connection: sqlite3.Connection) -> None:
    videos = [
        {
            "title": "Ashes Over Arcadia",
            "kind": "trailer",
            "style": "Neon dystopia",
            "category": "Sci-Fi",
            "tags": ["Sci-Fi", "Neon Dystopia", "AI Trailer"],
            "description": "A premium AI trailer cut built for website hero takeovers and social teaser loops.",
            "channels": ["Website", "TikTok", "YouTube Shorts"],
            "poster_tone": "neon",
            "duration_seconds": 98,
            "featured": 1,
            "spotlight_rank": 5,
            "status": "Featured live",
        },
        {
            "title": "Kingdom of the Fifth Sun",
            "kind": "trailer",
            "style": "Epic fantasy",
            "category": "Fantasy",
            "tags": ["Fantasy", "Epic", "Worldbuilding"],
            "description": "A long-form fantasy trailer with wide hero framing, big score beats, and a prestige launch feel.",
            "channels": ["Website", "Film Forums", "Communities"],
            "poster_tone": "sunrise",
            "duration_seconds": 121,
            "featured": 0,
            "spotlight_rank": 4,
            "status": "Campaign ready",
        },
        {
            "title": "Orbiting You",
            "kind": "trailer",
            "style": "Future romance",
            "category": "Romance",
            "tags": ["Romance", "Future", "Character Story"],
            "description": "An intimate, luminous cut designed for emotional rewatching and quick mobile circulation.",
            "channels": ["Website", "Instagram Reels", "TikTok"],
            "poster_tone": "starlight",
            "duration_seconds": 76,
            "featured": 0,
            "spotlight_rank": 3,
            "status": "Audience test",
        },
        {
            "title": "Arcadia Countdown Drop",
            "kind": "commercial",
            "style": "Launch countdown",
            "category": "Launch",
            "tags": ["Launch", "Countdown", "Campaign"],
            "description": "A short vertical commercial for pushing the next trailer event to social feeds and the homepage.",
            "channels": ["TikTok", "Website", "Instagram Reels"],
            "poster_tone": "ember",
            "duration_seconds": 24,
            "featured": 1,
            "spotlight_rank": 5,
            "status": "Featured live",
        },
        {
            "title": "Creator Reel Pack",
            "kind": "commercial",
            "style": "Community share kit",
            "category": "Community",
            "tags": ["Community", "Creator Pack", "Campaign"],
            "description": "A creator-facing asset set with hooks, overlays, and CTA language for community-driven promotion.",
            "channels": ["Communities", "Film Forums", "YouTube Shorts"],
            "poster_tone": "velocity",
            "duration_seconds": 31,
            "featured": 0,
            "spotlight_rank": 4,
            "status": "Queued",
        },
    ]

    for video in videos:
        slug = next_unique_slug(connection, video["title"])
        connection.execute(
            """
            INSERT INTO videos (
                title,
                slug,
                kind,
                style,
                category,
                tags_json,
                description,
                channels_json,
                file_name,
                mime_type,
                poster_tone,
                duration_seconds,
                featured,
                spotlight_rank,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)
            """,
            (
                video["title"],
                slug,
                video["kind"],
                video["style"],
                video["category"],
                json.dumps(video["tags"]),
                video["description"],
                json.dumps(video["channels"]),
                video["poster_tone"],
                video["duration_seconds"],
                video["featured"],
                video["spotlight_rank"],
                video["status"],
            ),
        )

    rows = connection.execute("SELECT id, title, kind, channels_json FROM videos").fetchall()

    for row in rows:
        channels = json_loads_or_default(row["channels_json"], ["Website"])
        for channel in channels:
            state = "Live" if channel == "Website" else "Queued"
            connection.execute(
                """
                INSERT INTO broadcast_posts (
                    video_id,
                    platform,
                    format,
                    state,
                    headline,
                    launch_window
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    row["id"],
                    channel,
                    CHANNEL_FORMATS.get(channel, "Campaign drop"),
                    state,
                    f"{row['title']} prepared for {channel}",
                    "Prime release window",
                ),
            )

    connection.commit()


def init_database() -> None:
    ensure_directories()

    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS videos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                kind TEXT NOT NULL CHECK (kind IN ('trailer', 'commercial')),
                style TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'Drama',
                tags_json TEXT NOT NULL DEFAULT '[]',
                description TEXT NOT NULL,
                channels_json TEXT NOT NULL DEFAULT '[]',
                file_name TEXT,
                mime_type TEXT,
                poster_tone TEXT NOT NULL DEFAULT 'ember',
                duration_seconds INTEGER NOT NULL DEFAULT 45,
                featured INTEGER NOT NULL DEFAULT 0,
                spotlight_rank INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'Queued',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS broadcast_posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                video_id INTEGER,
                platform TEXT NOT NULL,
                format TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'Queued',
                headline TEXT NOT NULL,
                launch_window TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (video_id) REFERENCES videos (id) ON DELETE CASCADE
            );
            """
        )

        ensure_video_metadata_columns(connection)

        has_seed_data = connection.execute("SELECT COUNT(*) FROM videos").fetchone()[0]

        if has_seed_data == 0:
            seed_database(connection)


def parse_json_body(handler: BaseHTTPRequestHandler) -> dict[str, object]:
    content_length = int(handler.headers.get("Content-Length", "0") or "0")

    if content_length <= 0:
        return {}

    raw_body = handler.rfile.read(content_length)

    if not raw_body:
        return {}

    return json.loads(raw_body.decode("utf-8"))


def parse_multipart_form(
    content_type: str, body: bytes
) -> tuple[dict[str, str], dict[str, dict[str, object]]]:
    mime_message = BytesParser(policy=default).parsebytes(
        (
            "MIME-Version: 1.0\r\n"
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode("utf-8")
        + body
    )

    fields: dict[str, str] = {}
    files: dict[str, dict[str, object]] = {}

    if not mime_message.is_multipart():
        return fields, files

    for part in mime_message.iter_parts():
        if part.get_content_disposition() != "form-data":
            continue

        name = part.get_param("name", header="content-disposition")
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""

        if not name:
            continue

        if filename:
            files[name] = {
                "filename": Path(filename).name,
                "content": payload,
                "content_type": part.get_content_type(),
            }
            continue

        charset = part.get_content_charset() or "utf-8"
        fields[name] = payload.decode(charset).strip()

    return fields, files


def parse_channels(raw_channels: str) -> list[str]:
    channels = []

    for channel in raw_channels.split(","):
        cleaned = channel.strip()
        if cleaned and cleaned not in channels:
            channels.append(cleaned)

    return channels or ["Website"]


def build_broadcast_rows(title: str, channels: list[str]) -> list[tuple[str, str, str, str]]:
    broadcast_rows = []

    for channel in channels:
        state = "Live" if channel == "Website" else "Queued"
        headline = f"{title} packaged for {channel}"
        launch_window = "Live now" if channel == "Website" else "Prime audience window"
        broadcast_rows.append(
            (
                channel,
                CHANNEL_FORMATS.get(channel, "Campaign drop"),
                state,
                headline,
                launch_window,
            )
        )

    return broadcast_rows


class XShowHandler(BaseHTTPRequestHandler):
    server_version = "XShow/1.0"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/healthz":
            self.send_json({"ok": True})
            return

        if parsed.path == "/api/home":
            self.handle_home()
            return

        if parsed.path.startswith("/api/trailers/"):
            slug = unquote(parsed.path.removeprefix("/api/trailers/")).strip("/")
            self.handle_trailer_detail(slug)
            return

        self.serve_static(parsed.path)

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/admin/session":
            self.handle_admin_login()
            return

        if parsed.path == "/api/upload":
            self.handle_upload()
            return

        self.send_json({"error": "Not found."}, status=HTTPStatus.NOT_FOUND)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/admin/session":
            self.handle_admin_logout()
            return

        self.send_json({"error": "Not found."}, status=HTTPStatus.NOT_FOUND)

    def handle_home(self) -> None:
        payload = build_home_payload(self.is_creator())
        self.send_json(payload)

    def handle_trailer_detail(self, slug: str) -> None:
        if not slug:
            self.send_json({"error": "Trailer slug is required."}, status=HTTPStatus.BAD_REQUEST)
            return

        payload = build_trailer_payload(slug, self.is_creator())

        if not payload:
            self.send_json({"error": "Trailer not found."}, status=HTTPStatus.NOT_FOUND)
            return

        self.send_json(payload)

    def handle_admin_login(self) -> None:
        try:
            payload = parse_json_body(self)
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON body."}, status=HTTPStatus.BAD_REQUEST)
            return

        access_key = str(payload.get("accessKey", "")).strip()

        if not access_key or not secrets.compare_digest(access_key, ADMIN_KEY):
            self.send_json({"error": "Invalid creator access key."}, status=HTTPStatus.UNAUTHORIZED)
            return

        token, expires_at = build_session_token()
        headers = {
            "Set-Cookie": build_session_cookie(token, SESSION_TTL_SECONDS)
        }
        self.send_json(
            {
                "ok": True,
                "expiresAt": expires_at,
            },
            headers=headers,
        )

    def handle_admin_logout(self) -> None:
        headers = {"Set-Cookie": build_session_cookie("", 0)}
        self.send_json({"ok": True}, headers=headers)

    def handle_upload(self) -> None:
        if not self.is_creator():
            self.send_json({"error": "Creator mode is required for uploads."}, status=HTTPStatus.UNAUTHORIZED)
            return

        content_type = self.headers.get("Content-Type", "")
        content_length = int(self.headers.get("Content-Length", "0") or "0")

        if "multipart/form-data" not in content_type:
            self.send_json({"error": "Uploads must use multipart form data."}, status=HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
            return

        if content_length <= 0:
            self.send_json({"error": "Upload body is empty."}, status=HTTPStatus.BAD_REQUEST)
            return

        if content_length > MAX_UPLOAD_SIZE + 64 * 1024:
            self.send_json({"error": "Upload is too large."}, status=HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            return

        raw_body = self.rfile.read(content_length)
        fields, files = parse_multipart_form(content_type, raw_body)
        upload = files.get("video")

        if not upload:
            self.send_json({"error": "Choose a video file to upload."}, status=HTTPStatus.BAD_REQUEST)
            return

        title = fields.get("title", "").strip()
        kind = fields.get("kind", "").strip().lower()
        style = fields.get("style", "").strip()
        category = fields.get("category", "").strip()
        tags = parse_tags(fields.get("tags", ""))
        description = fields.get("description", "").strip()
        channels = parse_channels(fields.get("channels", "Website"))
        poster_tone = fields.get("posterTone", "").strip().lower()
        featured = fields.get("featured", "").strip().lower() in {"1", "true", "on", "yes"}

        try:
            duration_seconds = int(fields.get("durationSeconds", "45"))
        except ValueError:
            duration_seconds = 45

        duration_seconds = max(5, min(duration_seconds, 7200))

        if kind not in {"trailer", "commercial"}:
            self.send_json({"error": "Video type must be trailer or commercial."}, status=HTTPStatus.BAD_REQUEST)
            return

        if not title or not style or not description:
            self.send_json({"error": "Title, style, and description are required."}, status=HTTPStatus.BAD_REQUEST)
            return

        category = category or infer_category(kind, style, title)
        tags = tags or infer_tags(title, style, kind, category)

        file_name = str(upload["filename"])
        file_extension = Path(file_name).suffix.lower()

        if file_extension not in ALLOWED_VIDEO_EXTENSIONS:
            self.send_json({"error": "Unsupported video format."}, status=HTTPStatus.BAD_REQUEST)
            return

        if poster_tone not in KNOWN_TONES:
            poster_tone = infer_poster_tone(category, style)

        storage_name = f"{int(time.time())}-{slugify(title)}-{secrets.token_hex(4)}{file_extension}"
        storage_path = UPLOAD_DIR / storage_name
        storage_path.write_bytes(upload["content"])

        with get_connection() as connection:
            slug = next_unique_slug(connection, title)

            if featured:
                connection.execute("UPDATE videos SET featured = 0 WHERE kind = ?", (kind,))

            cursor = connection.execute(
                """
                INSERT INTO videos (
                    title,
                    slug,
                    kind,
                    style,
                    category,
                    tags_json,
                    description,
                    channels_json,
                    file_name,
                    mime_type,
                    poster_tone,
                    duration_seconds,
                    featured,
                    spotlight_rank,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    title,
                    slug,
                    kind,
                    style,
                    category,
                    json.dumps(tags),
                    description,
                    json.dumps(channels),
                    storage_name,
                    str(upload["content_type"]),
                    poster_tone,
                    duration_seconds,
                    int(featured),
                    10 if featured else 1,
                    "Featured live" if featured else "Fresh upload",
                ),
            )
            video_id = cursor.lastrowid

            for channel, video_format, state, headline, launch_window in build_broadcast_rows(title, channels):
                connection.execute(
                    """
                    INSERT INTO broadcast_posts (
                        video_id,
                        platform,
                        format,
                        state,
                        headline,
                        launch_window
                    )
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        video_id,
                        channel,
                        video_format,
                        state,
                        headline,
                        launch_window,
                    ),
                )

            connection.commit()
            row = connection.execute("SELECT * FROM videos WHERE id = ?", (video_id,)).fetchone()

        self.send_json({"ok": True, "video": serialize_video(row)})

    def is_creator(self) -> bool:
        cookie_header = self.headers.get("Cookie")

        if not cookie_header:
            return False

        cookies = SimpleCookie()
        cookies.load(cookie_header)
        morsel = cookies.get(SESSION_COOKIE)

        if not morsel:
            return False

        return is_valid_session_token(morsel.value)

    def serve_static(self, request_path: str) -> None:
        if request_path in {"", "/"}:
            request_path = "/index.html"

        if request_path.startswith("/watch/"):
            request_path = "/watch.html"

        if request_path.startswith("/uploads/"):
            file_name = Path(request_path.removeprefix("/uploads/")).name
            target = (UPLOAD_DIR / file_name).resolve()

            if not target.exists() or not str(target).startswith(str(UPLOAD_DIR.resolve())):
                self.send_json({"error": "Upload not found."}, status=HTTPStatus.NOT_FOUND)
                return

            self.serve_file(target)
            return

        requested = request_path.removeprefix("/")

        if requested not in ROOT_STATIC_FILES:
            self.send_json({"error": "Not found."}, status=HTTPStatus.NOT_FOUND)
            return

        target = BASE_DIR / requested
        self.serve_file(target)

    def serve_file(self, target: Path) -> None:
        mime_type, _ = mimetypes.guess_type(target.name)
        payload = target.read_bytes()

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", mime_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def send_json(
        self,
        payload: dict[str, object],
        status: HTTPStatus = HTTPStatus.OK,
        headers: dict[str, str] | None = None,
    ) -> None:
        encoded = json.dumps(payload).encode("utf-8")

        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))

        if headers:
            for key, value in headers.items():
                self.send_header(key, value)

        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(encoded)


def run() -> None:
    init_database()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), XShowHandler)
    print(f"XShow running on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
