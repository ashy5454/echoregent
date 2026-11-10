"""
Model promotion script — archive existing artifacts and stage new ones.

Verifies that the eval report gate_result is "pass" before doing anything.
Archives the existing artifact (if any) with a timestamped directory name.
Writes a version.json sidecar with training provenance metadata.
Stages files for manual commit to the ml-models branch.

Does NOT auto-commit or auto-push — operator must review before pushing.

Usage:
    python -m pipeline.promote \
        --model cts_classifier \
        --artifact models/classifier_20261015_120000/ \
        --eval-report reports/eval_classifier_20261015_120500.json

    python -m pipeline.promote \
        --model cts_relevance \
        --artifact models/relevance_20261015_130000/ \
        --eval-report reports/eval_relevance_20261015_131000.json
"""

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
from datetime import datetime, timezone

_ROOT = pathlib.Path(__file__).resolve().parent.parent
ML_DIR = _ROOT / "ml"

sys.path.insert(0, str(_ROOT))
from pipeline.utils import read_json, write_json  # noqa: E402

MAX_ARCHIVE_ENTRIES = 10


class PromoteError(Exception):
    pass


def get_git_sha() -> str:
    """Return the current HEAD SHA, or 'unknown' if not in a git repo."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=_ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def archive_existing(model_dir: pathlib.Path) -> pathlib.Path | None:
    """Move existing model files into a timestamped archive subdirectory.

    Returns the archive path on success, None when there is nothing to archive.
    Warns when the archive directory accumulates more than MAX_ARCHIVE_ENTRIES.
    """
    if not model_dir.exists():
        return None

    # Collect items that are not the archive subdirectory
    items = [p for p in model_dir.iterdir() if p.name != "archive"]
    if not items:
        return None

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    archive_base = model_dir / "archive" / ts
    archive_path = archive_base
    counter = 1
    while archive_path.exists():
        archive_path = pathlib.Path(str(archive_base) + f"_{counter}")
        counter += 1

    archive_path.mkdir(parents=True, exist_ok=True)
    for item in items:
        shutil.move(str(item), str(archive_path / item.name))

    # Warn if archive is getting large
    archive_dir = model_dir / "archive"
    if archive_dir.exists():
        n = len(list(archive_dir.iterdir()))
        if n > MAX_ARCHIVE_ENTRIES:
            print(
                f"[WARN] {model_dir}/archive has {n} entries (>{MAX_ARCHIVE_ENTRIES}). "
                "Consider pruning old archives and updating ml/.gitignore to exclude "
                "ml/*/archive/ from LFS tracking."
            )

    return archive_path


def write_version_sidecar(model_dir: pathlib.Path, metadata: dict, eval_report_path: pathlib.Path) -> None:
    """Write ml/<model>/version.json with provenance metadata."""
    version = {
        "model_name": metadata.get("model_name"),
        "base_checkpoint": metadata.get("base_checkpoint"),
        "training_dataset_sources": metadata.get("training_dataset_sources"),
        "training_date": datetime.now(timezone.utc).isoformat(),
        "git_sha": get_git_sha(),
        "per_class_f1": metadata.get("per_class_f1"),
        "locomo_f1": metadata.get("locomo_f1"),
        "eval_report_path": str(eval_report_path),
    }
    write_json(model_dir / "version.json", version)


def promote_model(
    model_name: str,
    artifact_path: pathlib.Path,
    metadata: dict,
    eval_report_path: pathlib.Path,
) -> None:
    """Promote a trained model artifact to ml/<model_name>/.

    Verifies the eval gate passes, archives any existing artifact, copies the
    new artifact, writes a version.json sidecar, and stages everything for
    a manual commit to the ml-models branch.

    Raises:
        PromoteError: if the eval gate is not 'pass'.
    """
    eval_report = read_json(eval_report_path)
    gate = eval_report.get("gate_result", "unknown")
    if gate != "pass":
        raise PromoteError(
            f"Cannot promote: gate_result is '{gate}', not 'pass'. "
            f"Check {eval_report_path} for details."
        )

    model_dir = ML_DIR / model_name
    model_dir.mkdir(parents=True, exist_ok=True)

    archive_path = archive_existing(model_dir)
    if archive_path:
        print(f"Archived existing artifact to: {archive_path}")
    else:
        print("No existing artifact to archive.")

    shutil.copytree(str(artifact_path), str(model_dir), dirs_exist_ok=True)
    print(f"Copied artifact from {artifact_path} to {model_dir}")

    write_version_sidecar(model_dir, metadata, eval_report_path)
    print(f"Written version sidecar: {model_dir / 'version.json'}")

    # Stage for manual commit
    try:
        subprocess.run(["git", "add", str(model_dir)], cwd=_ROOT, check=True)
        print("Staged model directory with git add.")
    except subprocess.CalledProcessError as e:
        print(f"[WARN] git add failed: {e}. Stage manually before committing.")

    locomo_f1 = metadata.get("locomo_f1") or metadata.get("per_class_f1")
    print(f"""
Promotion complete for {model_name}.
  Artifact:   {model_dir}
  Version:    {model_dir / 'version.json'}

Next steps:
  git commit -m "chore: promote {model_name} — {locomo_f1 or 'see version.json'}"
  git push origin ml-models
""")


def _build_metadata_from_reports(
    model_name: str,
    training_report_path: pathlib.Path | None,
    base_checkpoint: str,
) -> dict:
    metadata: dict = {
        "model_name": model_name,
        "base_checkpoint": base_checkpoint,
        "training_dataset_sources": None,
        "per_class_f1": None,
        "locomo_f1": None,
    }
    if training_report_path and training_report_path.exists():
        try:
            report = read_json(training_report_path)
            # Classifier report: extract per-class F1 from final_val_metrics
            val = report.get("final_val_metrics", {})
            if val:
                per_class = {
                    domain: (
                        val[domain].get("f1-score") or val[domain].get("f1")
                    )
                    for domain in val
                    if isinstance(val.get(domain), dict)
                }
                metadata["per_class_f1"] = per_class or None
            # Relevance report: f1_float16
            if "f1_float16" in report:
                metadata["locomo_f1"] = report["f1_float16"]
        except Exception as exc:
            print(f"[WARN] Could not parse training report: {exc}")
    return metadata


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Promote a trained model artifact to ml/<model_name>/.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--model", required=True, help="Model directory name (e.g. cts_classifier)")
    parser.add_argument("--artifact", type=pathlib.Path, required=True, help="Path to trained model directory")
    parser.add_argument("--eval-report", type=pathlib.Path, required=True, dest="eval_report", help="Path to eval report JSON")
    parser.add_argument("--training-report", type=pathlib.Path, default=None, dest="training_report", help="Path to training run report JSON (optional)")
    parser.add_argument("--base-checkpoint", default="distilbert-base-uncased", dest="base_checkpoint", help="Base checkpoint name")
    args = parser.parse_args()

    metadata = _build_metadata_from_reports(args.model, args.training_report, args.base_checkpoint)

    try:
        promote_model(
            model_name=args.model,
            artifact_path=args.artifact,
            metadata=metadata,
            eval_report_path=args.eval_report,
        )
    except PromoteError as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        sys.exit(1)
