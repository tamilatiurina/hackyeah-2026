import os


def main() -> None:
    import uvicorn

    uvicorn.run(
        "acme_test_agent.app:app_from_env",
        factory=True,
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8100")),
    )
