#!/usr/bin/env python3
"""Bulk runner that invokes fetch_questions.py over a range of syllabus ids.

This wrapper does not change `fetch_questions.py` logic — it simply calls it
for each specified syllabus id and streams output to stdout. It also writes
per-syllabus exit codes to a local log `bulk_fetch.log`.

Examples:
  python bulk_fetch.py --syl-range 1-100 --per_page 10 --all
  python bulk_fetch.py --syl-from 1 --syl-to 50 --per_page 5
  python bulk_fetch.py --syl 84 --per_page 10 --page 1
"""
import argparse
import subprocess
import sys
import os
from datetime import datetime


LOG_FILE = "bulk_fetch.log"


def parse_range(s: str):
    s = s.replace(':', '-').strip()
    a, b = [int(x) for x in s.split('-', 1)]
    return list(range(a, b + 1))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--syl", type=int, help="Single syllabus id to fetch")
    p.add_argument("--syl-from", type=int, help="Start syllabus id")
    p.add_argument("--syl-to", type=int, help="End syllabus id (inclusive)")
    p.add_argument("--syl-range", type=str, help="Range shorthand like 1-100 or 1:100")
    p.add_argument("--per_page", type=int, default=10)
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--all", action="store_true")
    p.add_argument("--db", default=None, help="Pass-through --db to fetch script")
    p.add_argument("--detail-url-template", default=None, help="Pass-through detail URL template")
    p.add_argument("--delay", type=float, default=None, help="Pass-through delay")
    p.add_argument("--python", default=sys.executable, help="Python executable to run fetch script")
    p.add_argument("--fetch-script", default="fetch_questions.py", help="Path to fetch_questions.py")
    p.add_argument("--continue-on-error", action="store_true", help="Continue on per-syllabus error")
    p.add_argument("--retry", type=int, default=0, help="Number of retries per syllabus on failure")
    args = p.parse_args()

    # build syllabus list
    syl_list = []
    if args.syl is not None:
        syl_list = [args.syl]
    elif args.syl_range:
        try:
            syl_list = parse_range(args.syl_range)
        except Exception as e:
            print("Invalid --syl-range:", e)
            return 1
    elif args.syl_from is not None and args.syl_to is not None:
        syl_list = list(range(args.syl_from, args.syl_to + 1))
    else:
        print("Specify --syl or --syl-range or --syl-from and --syl-to")
        return 1

    fetch_script = os.path.abspath(args.fetch_script)
    if not os.path.exists(fetch_script):
        print("fetch script not found:", fetch_script)
        return 1

    logfh = open(LOG_FILE, "a", encoding="utf-8")
    logfh.write(f"\n--- bulk run started {datetime.now().isoformat()} ---\n")
    logfh.flush()

    overall_failures = []

    for sid in syl_list:
        cmd = [args.python, fetch_script, "--syl", str(sid), "--per_page", str(args.per_page), "--page", str(args.page)]
        if args.all:
            cmd.append("--all")
        if args.db:
            cmd += ["--db", args.db]
        if args.detail_url_template:
            cmd += ["--detail-url-template", args.detail_url_template]
        if args.delay is not None:
            cmd += ["--delay", str(args.delay)]

        attempt = 0
        while True:
            attempt += 1
            print(f"Running syllabus {sid} (attempt {attempt}) -> { ' '.join(cmd) }")
            start = datetime.now()
            proc = subprocess.run(cmd)
            duration = (datetime.now() - start).total_seconds()
            rc = proc.returncode
            logfh.write(f"{datetime.now().isoformat()} syl={sid} rc={rc} duration={duration}s attempt={attempt}\n")
            logfh.flush()
            if rc == 0:
                print(f"syl={sid} succeeded (attempt {attempt})")
                break
            else:
                print(f"syl={sid} failed (rc={rc})")
                if attempt <= args.retry:
                    print("Retrying...")
                    continue
                overall_failures.append((sid, rc))
                if args.continue_on_error:
                    break
                else:
                    print("Stopping on first error. See bulk_fetch.log for details.")
                    logfh.write(f"--- bulk run aborted {datetime.now().isoformat()} ---\n")
                    logfh.close()
                    return 1

    logfh.write(f"--- bulk run finished {datetime.now().isoformat()} failures={len(overall_failures)} ---\n")
    logfh.close()
    if overall_failures:
        print("Completed with failures:")
        for sid, rc in overall_failures:
            print(" -", sid, "rc=", rc)
        return 2
    print("Bulk run completed successfully")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
