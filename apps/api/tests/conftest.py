import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.store import reset_store  # noqa: E402  (needs the path above)


@pytest.fixture(autouse=True)
def fresh_store() -> None:
    reset_store()
