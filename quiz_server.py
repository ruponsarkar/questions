#!/usr/bin/env python3
import asyncio
import json
import os
import random
import sqlite3
import tempfile
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote, urlparse

import pymysql
import edge_tts
from dotenv import load_dotenv
from pymysql.cursors import DictCursor


ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / "web"
MUSIC_DIR = WEB_DIR / "music"
DEFAULT_DB = ROOT_DIR / "questions.db"


@dataclass
class DatabaseConfig:
    use_mysql: bool
    sqlite_path: Path | None = None
    mysql: dict[str, Any] | None = None


def load_database_config() -> DatabaseConfig:
    load_dotenv(ROOT_DIR / ".env")
    if os.environ.get("DB_HOST") or os.environ.get("DB_ENGINE") == "mysql":
        return DatabaseConfig(
            use_mysql=True,
            mysql={
                "host": os.environ.get("DB_HOST", "localhost"),
                "user": os.environ.get("DB_USER"),
                "password": os.environ.get("DB_PASSWORD"),
                "database": os.environ.get("DB_NAME"),
                "port": int(os.environ.get("DB_PORT", 3306)),
                "charset": "utf8mb4",
                "cursorclass": DictCursor,
                "autocommit": True,
            },
        )
    return DatabaseConfig(use_mysql=False, sqlite_path=DEFAULT_DB)


class Database:
    def __init__(self, config: DatabaseConfig):
        self.config = config

    def connect(self):
        if self.config.use_mysql:
            return pymysql.connect(**self.config.mysql)
        conn = sqlite3.connect(self.config.sqlite_path)
        conn.row_factory = sqlite3.Row
        return conn

    def fetch_all(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        with self.connect() as conn:
            cur = conn.cursor()
            cur.execute(self._prepare_sql(sql), params)
            rows = cur.fetchall()
        return [dict(row) for row in rows]

    def fetch_one(self, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
        rows = self.fetch_all(sql, params)
        return rows[0] if rows else None

    def _prepare_sql(self, sql: str) -> str:
        if self.config.use_mysql:
            return sql.replace("?", "%s")
        return sql


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    return " ".join(text.replace("<p>", " ").replace("</p>", " ").split())


class QuizRepository:
    def __init__(self, db: Database):
        self.db = db

    def list_subjects(self) -> list[dict[str, Any]]:
        return self.db.fetch_all(
            """
            SELECT
                s.id,
                s.subName,
                s.class,
                s.examName,
                COUNT(DISTINCT q.q_id) AS questionCount
            FROM subjects s
            JOIN questions q ON q.subject_id = s.id
            WHERE q.isApprove = 1
            GROUP BY s.id, s.subName, s.class, s.examName
            HAVING COUNT(DISTINCT q.q_id) > 0
            ORDER BY s.subName ASC
            """
        )

    def list_syllabuses(self, subject_id: int) -> list[dict[str, Any]]:
        return self.db.fetch_all(
            """
            SELECT
                sy.id,
                sy.syllabus,
                sy.subject_id,
                sy.isActive,
                COUNT(DISTINCT q.q_id) AS questionCount
            FROM syllabuses sy
            JOIN questions q ON q.syllabus_id = sy.id
            WHERE sy.subject_id = ? AND q.isApprove = 1
            GROUP BY sy.id, sy.syllabus, sy.subject_id, sy.isActive
            HAVING COUNT(DISTINCT q.q_id) > 0
            ORDER BY sy.syllabus ASC
            """,
            (subject_id,),
        )

    def build_quiz(self, subject_id: int, syllabus_id: int, question_count: int) -> dict[str, Any]:
        available = self.db.fetch_one(
            """
            SELECT COUNT(DISTINCT q.q_id) AS total
            FROM questions q
            WHERE q.subject_id = ? AND q.syllabus_id = ? AND q.isApprove = 1
            """,
            (subject_id, syllabus_id),
        )
        total_available = int((available or {}).get("total", 0))
        limit = min(max(question_count, 1), total_available)

        if limit == 0:
            return {"availableCount": 0, "questions": []}

        selected_questions = self.db.fetch_all(
            self._random_question_sql(limit),
            (subject_id, syllabus_id),
        )

        questions = []
        for question in selected_questions:
            options = self._build_options(
                q_id=int(question["q_id"]),
                syllabus_id=syllabus_id,
                subject_id=subject_id,
            )
            if len(options) < 4:
                continue
            questions.append(
                {
                    "id": int(question["q_id"]),
                    "questionHtml": question["question"] or "",
                    "questionText": strip_html(question["question"]),
                    "descriptionHtml": question.get("description") or "",
                    "options": options,
                }
            )

        return {"availableCount": total_available, "questions": questions}

    def _random_question_sql(self, limit: int) -> str:
        random_fn = "RAND()" if self.db.config.use_mysql else "RANDOM()"
        return f"""
            SELECT q.q_id, q.question, q.description
            FROM questions q
            WHERE q.subject_id = ? AND q.syllabus_id = ? AND q.isApprove = 1
            ORDER BY {random_fn}
            LIMIT {limit}
        """

    def _build_options(self, q_id: int, syllabus_id: int, subject_id: int) -> list[dict[str, Any]]:
        answers = self.db.fetch_all(
            """
            SELECT ans_id, answer, isRight
            FROM answers
            WHERE q_id = ?
            """,
            (q_id,),
        )

        right_answers = [row for row in answers if int(row.get("isRight") or 0) == 1]
        wrong_answers = [row for row in answers if int(row.get("isRight") or 0) != 1]

        if not right_answers:
            return []

        right_choice = random.choice(right_answers)
        picked_wrong = wrong_answers[:]
        random.shuffle(picked_wrong)
        picked_wrong = picked_wrong[:3]

        if len(picked_wrong) < 3:
            extra_needed = 3 - len(picked_wrong)
            extras = self.db.fetch_all(
                self._extra_wrong_options_sql(extra_needed),
                (q_id, syllabus_id, subject_id),
            )
            picked_wrong.extend(extras)

        combined = [right_choice, *picked_wrong]
        deduped = []
        seen = set()
        for row in combined:
            answer = strip_html(row.get("answer"))
            if not answer or answer in seen:
                continue
            seen.add(answer)
            deduped.append(
                {
                    "id": int(row["ans_id"]),
                    "answerHtml": row.get("answer") or "",
                    "answerText": answer,
                    "isRight": int(row.get("isRight") or 0) == 1,
                }
            )

        random.shuffle(deduped)
        return deduped[:4]

    def _extra_wrong_options_sql(self, limit: int) -> str:
        random_fn = "RAND()" if self.db.config.use_mysql else "RANDOM()"
        return f"""
            SELECT a.ans_id, a.answer, 0 AS isRight
            FROM answers a
            JOIN questions q ON q.q_id = a.q_id
            WHERE a.q_id != ?
              AND a.isRight != 1
              AND q.syllabus_id = ?
              AND q.subject_id = ?
              AND q.isApprove = 1
            ORDER BY {random_fn}
            LIMIT {limit}
        """


class QuizRequestHandler(SimpleHTTPRequestHandler):
    repository = QuizRepository(Database(load_database_config()))

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/narration/voices":
            self._send_json({"voices": self._list_narration_voices()})
            return
        if parsed.path == "/api/subjects":
            self._send_json({"subjects": self.repository.list_subjects()})
            return
        if parsed.path == "/api/music":
            supported_extensions = {".aac", ".m4a", ".mp3", ".ogg", ".wav", ".webm"}
            tracks = []
            if MUSIC_DIR.is_dir():
                for music_file in sorted(MUSIC_DIR.iterdir()):
                    if music_file.is_file() and music_file.suffix.lower() in supported_extensions:
                        tracks.append({"url": f"/music/{quote(music_file.name)}"})
            self._send_json({"tracks": tracks})
            return
        if parsed.path == "/api/syllabuses":
            params = parse_qs(parsed.query)
            subject_id = int(params.get("subject_id", ["0"])[0] or 0)
            self._send_json({"syllabuses": self.repository.list_syllabuses(subject_id)})
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/quiz", "/api/narration"}:
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown API endpoint")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length or 0)
        body = json.loads(raw_body or "{}")

        if parsed.path == "/api/narration":
            self._send_narration_audio(body)
            return

        subject_id = int(body.get("subjectId") or 0)
        syllabus_id = int(body.get("syllabusId") or 0)
        question_count = int(body.get("questionCount") or 0)

        if not subject_id or not syllabus_id or question_count < 1:
            self._send_json(
                {"error": "subjectId, syllabusId, and questionCount are required."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        quiz = self.repository.build_quiz(subject_id, syllabus_id, question_count)
        self._send_json(quiz)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _list_narration_voices(self) -> list[dict[str, str]]:
        try:
            voices = asyncio.run(edge_tts.list_voices())
        except Exception:
            return []

        return [
            {
                "name": voice["ShortName"],
                "lang": voice["Locale"],
            }
            for voice in voices
            if voice.get("ShortName") and voice.get("Locale")
        ]

    def _send_narration_audio(self, body: dict[str, Any]):
        text = " ".join(str(body.get("text") or "").split())
        if not text or len(text) > 4_000:
            self._send_json(
                {"error": "Narration text must contain 1 to 4,000 characters."},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        available_voices = self._list_narration_voices()
        requested_voice = str(body.get("voiceName") or "")
        voice_names = {voice["name"] for voice in available_voices}
        voice_name = requested_voice if requested_voice in voice_names else "en-US-AvaMultilingualNeural"
        if voice_name not in voice_names and available_voices:
            voice_name = available_voices[0]["name"]

        audio_file = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
        audio_path = Path(audio_file.name)
        audio_file.close()

        try:
            communicate = edge_tts.Communicate(text, voice_name)
            asyncio.run(communicate.save(str(audio_path)))
            data = audio_path.read_bytes()
        except Exception:
            self._send_json(
                {"error": "Unable to create narration audio."},
                status=HTTPStatus.INTERNAL_SERVER_ERROR,
            )
            return
        finally:
            audio_path.unlink(missing_ok=True)

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/mpeg")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    port = int(os.environ.get("QUIZ_PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), QuizRequestHandler)
    print(f"Quiz app running on http://localhost:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
