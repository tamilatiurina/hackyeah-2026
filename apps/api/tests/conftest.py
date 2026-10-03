import pytest
from app.store import reset_store


@pytest.fixture(autouse=True)
def fresh_store() -> None:
    reset_store()
