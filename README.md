# Question Fetcher

Small Python CLI to fetch questions from the provided API and save them into a local SQLite database.

Usage

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip

Install requirements:

```bash
python3 -m pip install -r requirements.txt
```

Fetch a single page:

```bash
python fetch_questions.py --syl 84 --per_page 10 --page 1
```

Fetch all pages (iterates using `last_page`):

```bash
python fetch_questions.py --syl 84 --per_page 10 --all
```

Database

By default the script creates `questions.db` in the current folder. Tables: `subjects`, `syllabuses`, `users`, `questions`, `answers`.

Migrations

This repo includes a simple migration system. Add SQL files into the `migrations/` directory (they are applied in sorted order).

Run migrations:

```bash
python migrate.py --db questions.db
```

The runner records applied migrations in the `applied_migrations` table so they are not re-run.

MySQL / Server DB

To run against a MySQL server, set these environment variables (or add them to a `.env` file):

- `DB_HOST` - host
- `DB_PORT` - port (default 3306)
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`

Then run the same migrate command (it will detect the env and apply migrations to MySQL):

```bash
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... python migrate.py
```

`fetch_questions.py` also detects these vars and will write into MySQL when present.

Fetching missing question details

Sometimes the API returns primitive ids instead of full question objects. To automatically fetch full details for those ids, provide a URL template using the `{id}` placeholder. You can pass it via env or CLI:

```bash
export DETAIL_URL_TEMPLATE='https://learnoindia.zakticonsulting.in/backend/public/api/getQuestionById/{id}'
python fetch_questions.py --syl 84 --per_page 10 --all
```

Or pass as CLI arg:

```bash
python fetch_questions.py --syl 84 --per_page 10 --all --detail-url-template 'https://.../getQuestionById/{id}'
```

If `DETAIL_URL_TEMPLATE` is not provided, primitive items (ints/strings) will be skipped.

Bulk runner script

If you prefer a wrapper that calls `fetch_questions.py` per syllabus id (without changing the original script), use `bulk_fetch.py`:

```bash
python bulk_fetch.py --syl-range 1-100 --per_page 10 --all
```

Options:
- `--retry N` retry N times on failure for each syllabus
- `--continue-on-error` continue with next syllabus if one fails
- `--fetch-script` path to the `fetch_questions.py` if not in the same folder

Quiz website

This repo now also includes a lightweight quiz website with:

- subject selection
- syllabus selection
- question count input
- questions per page input
- timer per question input
- 4 randomized options per question
- active question highlight while its timer runs
- correct answer highlight in green when time is up

Run it with:

```bash
python3 quiz_server.py
```

Then open:

```text
http://localhost:8000
```

The server uses the same `.env` database settings as the fetch scripts, so it can read from MySQL or a local SQLite file.
