"""Test-wide environment setup.

Must run before `app.config` is imported, since Settings reads the environment once at
import time.
"""

import os

os.environ.setdefault("DATABASE_URL", os.getenv("EVALS_TEST_DATABASE_URL", "postgresql://localhost/unused"))
