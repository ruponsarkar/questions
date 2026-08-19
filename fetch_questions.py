#!/usr/bin/env python3
"""Fetch questions from API and save into a local SQLite database.

Usage examples:
  python fetch_questions.py --syl 84 --per_page 10 --page 1
  python fetch_questions.py --syl 84 --per_page 10 --all
"""
import argparse
import json
import os
import sqlite3
import pymysql
from pymysql.cursors import DictCursor
from dotenv import load_dotenv
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict

import requests


DEFAULT_DB = "questions.db"

# load .env if present
load_dotenv()


class DBWrapper:
    def __init__(self, db_path: str, mysql_cfg: dict | None = None):
        self.is_mysql = mysql_cfg is not None
        self.mysql_cfg = mysql_cfg
        if self.is_mysql:
            self.conn = pymysql.connect(
                host=mysql_cfg.get("host"),
                user=mysql_cfg.get("user"),
                password=mysql_cfg.get("password"),
                database=mysql_cfg.get("database"),
                port=int(mysql_cfg.get("port", 3306)),
                charset="utf8mb4",
                cursorclass=DictCursor,
                autocommit=False,
            )
        else:
            self.conn = sqlite3.connect(db_path)

    def cursor(self):
        return self.conn.cursor()

    def execute(self, sql: str, params=None):
        if self.is_mysql:
            sql = sql.replace("?", "%s")
            sql = sql.replace("INSERT OR REPLACE INTO", "REPLACE INTO")
        cur = self.conn.cursor()
        if params is None:
            cur.execute(sql)
        else:
            cur.execute(sql, params)
        return cur

    def executescript(self, sql: str):
        if self.is_mysql:
            # split statements and execute individually
            for stmt in [s.strip() for s in sql.split(';') if s.strip()]:
                self.execute(stmt)
        else:
            cur = self.conn.cursor()
            cur.executescript(sql)

    def commit(self):
        self.conn.commit()

    def close(self):
        self.conn.close()


def ensure_tables(conn: sqlite3.Connection | DBWrapper) -> None:
    # Run different CREATE TABLE statements for SQLite vs MySQL
    is_mysql = isinstance(conn, DBWrapper) and conn.is_mysql
    if is_mysql:
        cur = conn.cursor()
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS `subjects` (
            `id` INT PRIMARY KEY,
            `subName` TEXT,
            `class` TEXT,
            `details` TEXT,
            `examName` TEXT,
            `image` TEXT,
            `status` INT,
            `created_at` TEXT,
            `updated_at` TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        )
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS `syllabuses` (
            `id` INT PRIMARY KEY,
            `syllabus` TEXT,
            `subject_id` INT,
            `type` TEXT,
            `self_id` INT,
            `exam_id` INT,
            `isActive` INT,
            `created_at` TEXT,
            `updated_at` TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        )
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS `users` (
            `id` INT PRIMARY KEY,
            `username` TEXT,
            `email` TEXT,
            `phoneNumber` TEXT,
            `role` TEXT,
            `isActive` INT,
            `created_at` TEXT,
            `updated_at` TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        )
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS `questions` (
            `q_id` INT PRIMARY KEY,
            `difficulties` TEXT,
            `question` TEXT,
            `class` TEXT,
            `description` TEXT,
            `desc_type` TEXT,
            `isApprove` INT,
            `type` INT,
            `subject_id` INT,
            `syllabus_id` INT,
            `addedBy_id` INT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        )
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS `answers` (
            `ans_id` INT PRIMARY KEY,
            `answer` TEXT,
            `question_type` INT,
            `q_id` INT,
            `isRight` INT,
            `created_at` TEXT,
            `updated_at` TEXT
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        )
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS `raw_items` (
            `id` INT PRIMARY KEY AUTO_INCREMENT,
            `source_id` TEXT,
            `raw_json` LONGTEXT,
            `source_page` INT,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        )
        conn.commit()
        return
    # SQLite path (existing)
    cur = conn.cursor()
    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS subjects (
        id INTEGER PRIMARY KEY,
        subName TEXT,
        class TEXT,
        details TEXT,
        examName TEXT,
        image TEXT,
        status INTEGER,
        created_at TEXT,
        updated_at TEXT
    )
    """
    )
    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS syllabuses (
        id INTEGER PRIMARY KEY,
        syllabus TEXT,
        subject_id INTEGER,
        type TEXT,
        self_id INTEGER,
        exam_id INTEGER,
        isActive INTEGER,
        created_at TEXT,
        updated_at TEXT
    )
    """
    )
    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT,
        email TEXT,
        phoneNumber TEXT,
        role TEXT,
        isActive INTEGER,
        created_at TEXT,
        updated_at TEXT
    )
    """
    )
    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS questions (
        q_id INTEGER PRIMARY KEY,
        difficulties TEXT,
        question TEXT,
        class TEXT,
        description TEXT,
        desc_type TEXT,
        isApprove INTEGER,
        type INTEGER,
        subject_id INTEGER,
        syllabus_id INTEGER,
        addedBy_id INTEGER
    )
    """
    )
    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS answers (
        ans_id INTEGER PRIMARY KEY,
        answer TEXT,
        question_type INTEGER,
        q_id INTEGER,
        isRight INTEGER,
        created_at TEXT,
        updated_at TEXT
    )
    """
    )
    cur.execute(
        """
    CREATE TABLE IF NOT EXISTS raw_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT,
        raw_json TEXT,
        source_page INTEGER,
        created_at TEXT
    )
    """
    )
    conn.commit()


def upsert_subject(conn: sqlite3.Connection | DBWrapper, s: Dict[str, Any]) -> None:
    if not s:
        return
    table = "subjects"
    pk = "id"
    cols = ["id", "subName", "class", "details", "examName", "image", "status", "created_at", "updated_at"]
    params = [
        s.get("id"),
        s.get("subName"),
        s.get("class"),
        s.get("details"),
        s.get("examName"),
        s.get("image"),
        s.get("status"),
        s.get("created_at"),
        s.get("updated_at"),
    ]
    if record_exists(conn, table, pk, s.get("id")):
        update_record(conn, table, pk, s.get("id"), cols[1:], params[1:])
    else:
        sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?']*len(cols))})"
        execute_conn(conn, sql, params)


def upsert_syllabus(conn: sqlite3.Connection | DBWrapper, sy: Dict[str, Any]) -> None:
    if not sy:
        return
    table = "syllabuses"
    pk = "id"
    cols = ["id", "syllabus", "subject_id", "type", "self_id", "exam_id", "isActive", "created_at", "updated_at"]
    params = [
        sy.get("id"),
        sy.get("syllabus"),
        sy.get("subject_id"),
        sy.get("type"),
        sy.get("self_id"),
        sy.get("exam_id"),
        sy.get("isActive"),
        sy.get("created_at"),
        sy.get("updated_at"),
    ]
    if record_exists(conn, table, pk, sy.get("id")):
        update_record(conn, table, pk, sy.get("id"), cols[1:], params[1:])
    else:
        sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?']*len(cols))})"
        execute_conn(conn, sql, params)


def upsert_user(conn: sqlite3.Connection | DBWrapper, u: Dict[str, Any]) -> None:
    if not u:
        return
    table = "users"
    pk = "id"
    cols = ["id", "username", "email", "phoneNumber", "role", "isActive", "created_at", "updated_at"]
    params = [
        u.get("id"),
        u.get("username"),
        u.get("email"),
        u.get("phoneNumber"),
        u.get("role"),
        u.get("isActive"),
        u.get("created_at"),
        u.get("updated_at"),
    ]
    if record_exists(conn, table, pk, u.get("id")):
        update_record(conn, table, pk, u.get("id"), cols[1:], params[1:])
    else:
        sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?']*len(cols))})"
        execute_conn(conn, sql, params)


def upsert_question(conn: sqlite3.Connection | DBWrapper, q: Dict[str, Any]) -> None:
    table = "questions"
    pk = "q_id"
    cols = [
        "q_id",
        "difficulties",
        "question",
        "class",
        "description",
        "desc_type",
        "isApprove",
        "type",
        "subject_id",
        "syllabus_id",
        "addedBy_id",
    ]
    params = [
        q.get("q_id"),
        q.get("difficulties"),
        q.get("question"),
        q.get("class"),
        q.get("description"),
        q.get("desc_type"),
        q.get("isApprove"),
        q.get("type"),
        q.get("subject", {}).get("id"),
        q.get("syllabus", {}).get("id"),
        q.get("addedBy", {}).get("id"),
    ]
    if record_exists(conn, table, pk, q.get("q_id")):
        update_record(conn, table, pk, q.get("q_id"), cols[1:], params[1:])
    else:
        sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?']*len(cols))})"
        execute_conn(conn, sql, params)


def upsert_answers(conn: sqlite3.Connection | DBWrapper, answers: Any) -> None:
    if not answers:
        return
    table = "answers"
    pk = "ans_id"
    cols = ["ans_id", "answer", "question_type", "q_id", "isRight", "created_at", "updated_at"]
    for a in answers:
        if a.get("ans_id") is None:
            # skip answers without ans_id to avoid duplicate/autoinc ambiguity
            continue
        params = [
            a.get("ans_id"),
            a.get("answer"),
            a.get("question_type"),
            a.get("q_id"),
            a.get("isRight"),
            a.get("created_at"),
            a.get("updated_at"),
        ]
        if record_exists(conn, table, pk, a.get("ans_id")):
            update_record(conn, table, pk, a.get("ans_id"), cols[1:], params[1:])
        else:
            sql = f"INSERT INTO {table}({','.join(cols)}) VALUES({','.join(['?']*len(cols))})"
            execute_conn(conn, sql, params)


def execute_conn(conn, sql: str, params=None):
    if isinstance(conn, DBWrapper):
        return conn.execute(sql, params)
    cur = conn.cursor()
    if params is None:
        cur.execute(sql)
    else:
        cur.execute(sql, params)
    return cur


def record_exists(conn, table: str, pk: str, pk_val) -> bool:
    if pk_val is None:
        return False
    sql = f"SELECT 1 FROM {table} WHERE {pk}=? LIMIT 1"
    cur = execute_conn(conn, sql, (pk_val,))
    row = cur.fetchone()
    return bool(row)


def update_record(conn, table: str, pk: str, pk_val, cols: list, vals: list):
    # build SET col1=?,col2=? ...
    set_clause = ",".join([f"{c}=?" for c in cols])
    sql = f"UPDATE {table} SET {set_clause} WHERE {pk}=?"
    params = vals + [pk_val]
    execute_conn(conn, sql, params)


def save_raw_item(conn, raw_value, source_id=None, source_page: int | None = None) -> None:
    raw_json = json.dumps(raw_value, ensure_ascii=False)
    sql = "INSERT INTO raw_items(source_id, raw_json, source_page, created_at) VALUES(?,?,?,?)"
    params = (str(source_id) if source_id is not None else None, raw_json, source_page, datetime.now(timezone.utc).isoformat())
    try:
        execute_conn(conn, sql, params)
    except Exception:
        # fallback for MySQL placeholder differences handled in execute_conn
        execute_conn(conn, sql, params)


def save_record(conn: sqlite3.Connection, q: Dict[str, Any], source_page: int | None = None) -> bool:
    # validate q is a mapping; some API responses may return strings or primitive ids for items
    # If a DETAIL_URL_TEMPLATE is provided, try to fetch full data for primitive ids.
    if isinstance(q, str):
        # try to parse JSON string first
        try:
            q = json.loads(q)
        except Exception:
            # if it's a numeric string, try fetching by id
            if DETAIL_URL_TEMPLATE and q.isdigit():
                fetched = fetch_detail_by_id(int(q))
                if fetched:
                    q = fetched
                else:
                    print("Raw item (string) ->", q)
                    save_raw_item(conn, q, source_page=source_page)
                    return True
            else:
                print("Raw item (string) ->", q)
                save_raw_item(conn, q, source_page=source_page)
                return True
    if isinstance(q, int):
        if DETAIL_URL_TEMPLATE:
            fetched = fetch_detail_by_id(q)
            if fetched:
                q = fetched
            else:
                print("Raw item (int) ->", q)
                save_raw_item(conn, q, source_id=q, source_page=source_page)
                return True
        else:
            print("Raw item (int) ->", q)
            save_raw_item(conn, q, source_id=q, source_page=source_page)
            return True
    if not isinstance(q, dict):
        print("Raw item (other) ->", q, "type", type(q))
        save_raw_item(conn, q, source_page=source_page)
        return True

    upsert_subject(conn, q.get("subject"))
    upsert_syllabus(conn, q.get("syllabus"))
    upsert_user(conn, q.get("addedBy"))
    upsert_question(conn, q)
    upsert_answers(conn, q.get("ans"))
    try:
        # commit for both sqlite and DBWrapper
        conn.commit()
    except Exception:
        # DBWrapper may implement commit(), sqlite3.Connection does too
        try:
            conn.conn.commit()
        except Exception:
            pass
    return True


def fetch_page(syl: int, per_page: int, page: int) -> Dict[str, Any]:
    url = f"https://learnoindia.zakticonsulting.in/backend/public/api/getQuestionBySyl/{syl}/{per_page}/{page}"
    resp = requests.get(url, timeout=20)
    resp.raise_for_status()
    return resp.json()


DETAIL_URL_TEMPLATE: str | None = None


def fetch_detail_by_id(qid) -> Dict[str, Any] | None:
    """Fetch a single question detail using the DETAIL_URL_TEMPLATE.

    The template must include a single `{id}` replacement field, e.g.
    'https://.../api/getQuestionById/{id}'
    """
    global DETAIL_URL_TEMPLATE
    if not DETAIL_URL_TEMPLATE:
        return None
    try:
        url = DETAIL_URL_TEMPLATE.format(id=qid)
    except Exception:
        print("Invalid DETAIL_URL_TEMPLATE formatting; expected '{id}'")
        return None
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        data = r.json()
        # prefer common envelopes
        if isinstance(data, dict) and "data" in data:
            if isinstance(data["data"], dict):
                return data["data"]
            if isinstance(data["data"], list) and data["data"]:
                return data["data"][0]
        if isinstance(data, dict):
            return data
        return None
    except Exception as e:
        print("Failed to fetch detail for id", qid, "error:", e)
        return None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--syl", type=int, required=True, help="Syllabus id")
    p.add_argument("--per_page", type=int, default=10)
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--all", action="store_true", help="Fetch all pages starting from --page")
    p.add_argument("--db", default=DEFAULT_DB, help="SQLite DB path")
    p.add_argument("--detail-url-template", default=os.environ.get("DETAIL_URL_TEMPLATE"),
                   help="Optional URL template to fetch a question by id, use '{id}' in template")
    p.add_argument("--delay", type=float, default=0.15, help="Delay between page requests in seconds")
    args = p.parse_args()

    # set detail URL template if provided
    global DETAIL_URL_TEMPLATE
    DETAIL_URL_TEMPLATE = args.detail_url_template

    # detect MySQL config from environment
    mysql_cfg = None
    # prefer explicit DATABASE_URL? if present user can pass via env parsing elsewhere — we'll support DB_HOST based config
    if os.environ.get("DB_HOST") or os.environ.get("DATABASE_URL") or os.environ.get("DB_ENGINE") == "mysql":
        mysql_cfg = {
            "host": os.environ.get("DB_HOST", "82.25.121.109"),
            "user": os.environ.get("DB_USER", os.environ.get("MYSQL_USER", "u476288869_questions")),
            "password": os.environ.get("DB_PASSWORD", os.environ.get("MYSQL_PASSWORD", "6n;#BUJC+x0D")),
            "database": os.environ.get("DB_NAME", os.environ.get("MYSQL_DATABASE", "u476288869_questions")),
            "port": os.environ.get("DB_PORT", os.environ.get("MYSQL_PORT", 3306)),
        }
        conn = DBWrapper(args.db, mysql_cfg=mysql_cfg)
    else:
        conn = sqlite3.connect(args.db)
    ensure_tables(conn)

    page = args.page
    total_saved = 0

    try:
        while True:
            print(f"Fetching syl={args.syl} per_page={args.per_page} page={page}")
            data = fetch_page(args.syl, args.per_page, page)
            raw_items = data.get("data")
            items = []
            if raw_items is None:
                print("No items on this page.")
            else:
                # normalize: API may return list or dict mapping keys->item
                if isinstance(raw_items, dict):
                    # try to sort by numeric keys when possible
                    try:
                        items = [raw_items[k] for k in sorted(raw_items.keys(), key=lambda x: int(x))]
                    except Exception:
                        items = list(raw_items.values())
                elif isinstance(raw_items, list):
                    items = raw_items
                else:
                    # primitive or unexpected shape: keep as single item list
                    items = [raw_items]
            saved_this_page = 0
            for it in items:
                saved = save_record(conn, it, source_page=page)
                if saved:
                    saved_this_page += 1
                    total_saved += 1
            print(f"Saved {saved_this_page} items from page {page} (total {total_saved})")

            if not args.all:
                break

            last_page = data.get("last_page")
            if not last_page:
                print("No last_page info; stopping.")
                break
            if page >= last_page:
                print("Reached last page.")
                break
            page += 1
            time.sleep(args.delay)

    except requests.HTTPError as e:
        print("HTTP error:", e)
        sys.exit(1)
    except requests.RequestException as e:
        print("Request failed:", e)
        sys.exit(1)
    finally:
        try:
            conn.close()
        except Exception:
            pass

    print(f"Done. Total records saved/updated: {total_saved}")


if __name__ == "__main__":
    main()
