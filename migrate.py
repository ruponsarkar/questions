#!/usr/bin/env python3
"""Simple migration runner for SQLite.

Usage:
  python migrate.py --db questions.db

It applies SQL files placed in the `migrations/` folder in sorted order
and records applied migrations in the `applied_migrations` table.
"""
import argparse
import os
import sqlite3
import pymysql
from typing import List
from dotenv import load_dotenv

load_dotenv()


MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "migrations")


def ensure_applied_table(conn, is_mysql: bool) -> None:
    cur = conn.cursor()
    if is_mysql:
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS applied_migrations (
            name VARCHAR(255) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
        )
    else:
        cur.execute(
            """
        CREATE TABLE IF NOT EXISTS applied_migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT DEFAULT (datetime('now'))
        )
        """
        )
    conn.commit()


def list_migration_files() -> List[str]:
    files = [f for f in os.listdir(MIGRATIONS_DIR) if f.endswith('.sql')]
    files.sort()
    return files


def applied_names(conn, is_mysql: bool) -> List[str]:
    cur = conn.cursor()
    cur.execute("SELECT name FROM applied_migrations")
    # PyMySQL returns tuples/dicts depending on cursor; fetchall returns tuples by default
    rows = cur.fetchall()
    if is_mysql:
        return [r[0] for r in rows]
    return [r[0] for r in rows]


def apply_migration(conn, path: str, name: str, is_mysql: bool) -> None:
    print(f"Applying {name}")
    with open(path, 'r', encoding='utf-8') as fh:
        sql = fh.read()
    if is_mysql:
        # split and execute statements
        for stmt in [s.strip() for s in sql.split(';') if s.strip()]:
            conn.cursor().execute(stmt)
        conn.cursor().execute("INSERT INTO applied_migrations(name) VALUES(%s)", (name,))
        conn.commit()
    else:
        cur = conn.cursor()
        cur.executescript(sql)
        cur.execute("INSERT INTO applied_migrations(name) VALUES(?)", (name,))
        conn.commit()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="questions.db")
    args = p.parse_args()

    if not os.path.isdir(MIGRATIONS_DIR):
        print("No migrations directory found at:", MIGRATIONS_DIR)
        return

    is_mysql = False
    # detect mysql env
    if os.environ.get("DB_HOST") or os.environ.get("DB_ENGINE") == "mysql":
        is_mysql = True
        conn = pymysql.connect(
            host=os.environ.get("DB_HOST", "localhost"),
            user=os.environ.get("DB_USER", os.environ.get("MYSQL_USER")),
            password=os.environ.get("DB_PASSWORD", os.environ.get("MYSQL_PASSWORD")),
            database=os.environ.get("DB_NAME", os.environ.get("MYSQL_DATABASE")),
            port=int(os.environ.get("DB_PORT", os.environ.get("MYSQL_PORT", 3306))),
            charset="utf8mb4",
        )
    else:
        conn = sqlite3.connect(args.db)

    ensure_applied_table(conn, is_mysql)
    files = list_migration_files()
    applied = set(applied_names(conn, is_mysql))

    to_apply = [f for f in files if f not in applied]
    if not to_apply:
        print("No new migrations to apply.")
        return

    for name in to_apply:
        path = os.path.join(MIGRATIONS_DIR, name)
        apply_migration(conn, path, name)

    print("Migrations applied.")


if __name__ == '__main__':
    main()
