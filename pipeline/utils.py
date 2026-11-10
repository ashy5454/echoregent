"""Shared I/O utilities for the EchoRegent fine-tuning pipeline."""
import json
import pathlib
from typing import Any, Generator, Iterable


def write_jsonl(path: str | pathlib.Path, records: Iterable[dict]) -> int:
    """Write an iterable of dicts to a .jsonl file. Returns lines written."""
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
    return count


def load_jsonl(path: str | pathlib.Path) -> Generator[dict, None, None]:
    """Lazily yield dicts from a .jsonl file."""
    path = pathlib.Path(path)
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def write_json(path: str | pathlib.Path, data: Any) -> None:
    """Write data as pretty-printed JSON."""
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def read_json(path: str | pathlib.Path) -> Any:
    """Read JSON from a file."""
    with pathlib.Path(path).open("r", encoding="utf-8") as f:
        return json.load(f)


def load_config(config_path: str | pathlib.Path | None = None) -> dict:
    """Load pipeline_config.json from the pipeline root."""
    if config_path is None:
        config_path = pathlib.Path(__file__).parent / "pipeline_config.json"
    return read_json(config_path)
