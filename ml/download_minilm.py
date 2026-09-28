"""
Download all-MiniLM-L6-v2 for @xenova/transformers (ONNX format).
Saves to ml/cts_minilm/ — the path the semantic cache looks for.

Run: python ml/download_minilm.py
"""

from pathlib import Path
from huggingface_hub import snapshot_download

DEST = Path("ml/cts_minilm")
DEST.mkdir(parents=True, exist_ok=True)

print("Downloading Xenova/all-MiniLM-L6-v2 (ONNX, ~23 MB)...")
snapshot_download(
    repo_id="Xenova/all-MiniLM-L6-v2",
    local_dir=str(DEST),
    ignore_patterns=["*.msgpack", "*.h5", "flax_model*", "tf_model*", "rust_model*"],
)
print(f"Done — saved to {DEST.resolve()}")
print("Files:")
for f in sorted(DEST.rglob("*")):
    if f.is_file():
        print(f"  {f.relative_to(DEST)}  ({f.stat().st_size/1024:.0f} KB)")
