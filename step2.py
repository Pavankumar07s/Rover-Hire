#!/usr/bin/env python3
import os
import sys
import subprocess
from datetime import datetime

BASE_COMMIT = "659e6cd"

def main():
    if os.environ.get("REWRITE_DATES_MODE") == "1":
        todo_file = sys.argv[1]
        with open(todo_file, 'r') as f:
            lines = f.readlines()

        action_lines = [l for l in lines if not l.strip().startswith('#') and l.strip()]
        count = len(action_lines)

        if count == 0:
            return

        start_time = datetime(2026, 11, 5, 21, 16, 0)
        end_time = datetime(2026, 11, 6, 22, 20, 0)
        time_step = (end_time - start_time) / max(1, count - 1)

        with open(todo_file, 'w') as f:
            idx = 0
            for line in lines:
                f.write(line)
                if not line.strip().startswith('#') and line.strip():
                    current_time = start_time + (time_step * idx)
                    date_str = current_time.strftime("%Y-%m-%dT%H:%M:%S+05:30")
                    f.write(f'exec GIT_COMMITTER_DATE="{date_str}" git commit --amend --date="{date_str}" --no-edit\n')
                    idx += 1
        return

    # Trigger the automated rebase
    env = os.environ.copy()
    env["REWRITE_DATES_MODE"] = "1"
    env["GIT_SEQUENCE_EDITOR"] = f'"{sys.executable}" "{os.path.abspath(__file__)}"'

    print("Rewriting timestamps...")
    res = subprocess.run(["git", "rebase", "-i", BASE_COMMIT], env=env)

    if res.returncode == 0:
        print("\n✅ All dates rewritten successfully!")
    else:
        print("\n❌ Something went wrong.")

if __name__ == "__main__":
    main()
