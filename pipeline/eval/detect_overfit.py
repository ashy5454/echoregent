"""
Overfitting detection for cts_classifier and cts_relevance.

For the classifier:
  - Computes per-class train/val F1 gap from the training run report
  - Flags any domain where gap > 0.15 as overfitting

For the relevance scorer:
  - Reads per-epoch validation loss from checkpoint directory
  - Identifies the best epoch (lowest val loss) and flags if training went past it

Usage:
    python -m pipeline.eval.detect_overfit --report reports/classifier_run_<ts>.json
    python -m pipeline.eval.detect_overfit --checkpoints checkpoints/relevance_epoch_*/
"""

import argparse
import json
import pathlib
import sys
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Optional

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))
from pipeline.utils import read_json, write_json  # noqa: E402

MAX_OVERFIT_GAP = 0.15


@dataclass
class ClassGapResult:
    domain: str
    train_f1: float
    val_f1: float
    gap: float
    overfit: bool

    def __post_init__(self) -> None:
        # Ensure overfit flag is consistent with the gap threshold
        self.overfit = self.gap > MAX_OVERFIT_GAP


@dataclass
class OverfitReport:
    model_type: str  # "classifier" or "relevance"
    any_overfit: bool
    per_class_gaps: list  # list[ClassGapResult] — classifier only, else []
    early_stop_epoch: Optional[int]  # relevance only, else None
    best_val_score: Optional[float]  # relevance only, else None
    overfit_domains: list  # list[str] — domains with overfit=True


def _extract_f1(metrics_dict: dict) -> float:
    """Extract F1 from a per-class metrics dict.

    sklearn's classification_report(output_dict=True) produces "f1-score";
    custom reports may use "f1".  Falls back gracefully.
    """
    if "f1-score" in metrics_dict:
        return float(metrics_dict["f1-score"])
    if "f1" in metrics_dict:
        return float(metrics_dict["f1"])
    raise KeyError(
        f"No 'f1-score' or 'f1' key found in metrics dict: {list(metrics_dict.keys())}"
    )


def compute_train_val_gap(
    train_metrics: dict, val_metrics: dict
) -> list:
    """Compute per-domain train/val F1 gap.

    Args:
        train_metrics: Mapping of domain → metric dict (with "f1-score" or "f1").
        val_metrics:   Same structure for the validation split.

    Returns:
        List of ClassGapResult sorted by gap descending (highest gap first).
    """
    # Only consider keys present in both splits; skip sklearn aggregate keys
    _SKIP_KEYS = {"accuracy", "macro avg", "weighted avg"}
    domains = [k for k in train_metrics.keys() if k not in _SKIP_KEYS]

    results: list[ClassGapResult] = []
    for domain in domains:
        if domain not in val_metrics:
            print(
                f"[detect_overfit] WARNING: domain '{domain}' missing from val_metrics, skipping.",
                file=sys.stderr,
            )
            continue

        train_f1 = _extract_f1(train_metrics[domain])
        val_f1 = _extract_f1(val_metrics[domain])
        gap = train_f1 - val_f1
        results.append(
            ClassGapResult(
                domain=domain,
                train_f1=train_f1,
                val_f1=val_f1,
                gap=gap,
                overfit=gap > MAX_OVERFIT_GAP,
            )
        )

    results.sort(key=lambda r: r.gap, reverse=True)
    return results


def detect_overfit_classifier(report_path: pathlib.Path) -> OverfitReport:
    """Detect overfitting in a classifier training run.

    Args:
        report_path: Path to the JSON training run report produced by
                     ``pipeline/train/train_classifier.py``.

    Returns:
        OverfitReport with per-class gaps populated and any_overfit flag set.
    """
    report = read_json(report_path)

    per_epoch = report.get("per_epoch_metrics")
    if not per_epoch:
        print(
            "[detect_overfit] WARNING: 'per_epoch_metrics' missing from report; "
            "cannot compute train/val gap.",
            file=sys.stderr,
        )
        return OverfitReport(
            model_type="classifier",
            any_overfit=False,
            per_class_gaps=[],
            early_stop_epoch=None,
            best_val_score=None,
            overfit_domains=[],
        )

    train_metrics = per_epoch[-1]  # last-epoch train metrics
    val_metrics = report.get("final_val_metrics")

    if val_metrics is None:
        print(
            "[detect_overfit] WARNING: 'final_val_metrics' missing from report; "
            "cannot compute train/val gap.",
            file=sys.stderr,
        )
        return OverfitReport(
            model_type="classifier",
            any_overfit=False,
            per_class_gaps=[],
            early_stop_epoch=None,
            best_val_score=None,
            overfit_domains=[],
        )

    gaps = compute_train_val_gap(train_metrics, val_metrics)
    any_overfit = any(g.overfit for g in gaps)
    overfit_domains = [g.domain for g in gaps if g.overfit]

    if any_overfit:
        print(
            f"[detect_overfit] WARNING: Overfitting detected in classifier for domains: "
            f"{overfit_domains}",
            file=sys.stderr,
        )

    return OverfitReport(
        model_type="classifier",
        any_overfit=any_overfit,
        per_class_gaps=gaps,
        early_stop_epoch=None,
        best_val_score=None,
        overfit_domains=overfit_domains,
    )


def detect_overfit_relevance(report_path: pathlib.Path) -> OverfitReport:
    """Detect overfitting in a relevance scorer training run.

    Args:
        report_path: Path to a JSON training run report that contains a
                     ``per_epoch_val_scores`` list (one float per epoch, higher
                     is better — e.g. validation F1 or similarity score).

    Returns:
        OverfitReport with early_stop_epoch and best_val_score populated.
    """
    report = read_json(report_path)

    per_epoch_val_scores = report.get("per_epoch_val_scores")

    if not per_epoch_val_scores:
        print(
            "[detect_overfit] WARNING: 'per_epoch_val_scores' not found in report at "
            f"'{report_path}'.  Cannot determine overfitting for relevance model.",
            file=sys.stderr,
        )
        return OverfitReport(
            model_type="relevance",
            any_overfit=False,
            per_class_gaps=[],
            early_stop_epoch=None,
            best_val_score=None,
            overfit_domains=[],
        )

    best_epoch: int = int(
        max(range(len(per_epoch_val_scores)), key=lambda i: per_epoch_val_scores[i])
    )
    best_val_score: float = float(per_epoch_val_scores[best_epoch])

    # Training ran past the best epoch → overfitting
    any_overfit = best_epoch < len(per_epoch_val_scores) - 1

    if any_overfit:
        print(
            f"[detect_overfit] WARNING: Relevance model overfit — best epoch was "
            f"{best_epoch} but training continued to epoch "
            f"{len(per_epoch_val_scores) - 1}.",
            file=sys.stderr,
        )

    return OverfitReport(
        model_type="relevance",
        any_overfit=any_overfit,
        per_class_gaps=[],
        early_stop_epoch=best_epoch,
        best_val_score=best_val_score,
        overfit_domains=[],
    )


def _report_to_dict(report: OverfitReport) -> dict:
    """Serialise an OverfitReport to a plain dict for JSON output."""
    d = asdict(report)
    # ClassGapResult instances are already converted by asdict; nothing extra needed.
    return d


def _print_summary(report: OverfitReport) -> None:
    """Print a human-readable summary to stdout."""
    print(f"\n=== Overfit Detection Report — {report.model_type} ===")
    if report.model_type == "classifier":
        if not report.per_class_gaps:
            print("  No per-class gap data available.")
        else:
            print(f"  {'Domain':<22} {'Train F1':>9} {'Val F1':>9} {'Gap':>8} {'Overfit':>8}")
            print(f"  {'-'*22} {'-'*9} {'-'*9} {'-'*8} {'-'*8}")
            for g in report.per_class_gaps:
                flag = "*** YES ***" if g.overfit else "no"
                print(
                    f"  {g.domain:<22} {g.train_f1:>9.4f} {g.val_f1:>9.4f} "
                    f"{g.gap:>8.4f} {flag:>8}"
                )
        print(
            f"\n  any_overfit: {report.any_overfit}  |  "
            f"overfit_domains: {report.overfit_domains or '(none)'}"
        )

    elif report.model_type == "relevance":
        print(f"  best_epoch:       {report.early_stop_epoch}")
        print(f"  best_val_score:   {report.best_val_score}")
        print(f"  any_overfit:      {report.any_overfit}")
        if report.any_overfit:
            print(
                "  Recommendation: use checkpoint from epoch "
                f"{report.early_stop_epoch} and discard later epochs."
            )
    print()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect overfitting for cts_classifier or cts_relevance."
    )
    parser.add_argument(
        "--report",
        type=pathlib.Path,
        required=True,
        help="Path to the JSON training run report.",
    )
    parser.add_argument(
        "--model-type",
        choices=["classifier", "relevance"],
        default="classifier",
        help="Which model type to analyse (default: classifier).",
    )
    args = parser.parse_args()

    if not args.report.exists():
        print(f"[detect_overfit] ERROR: report file not found: {args.report}", file=sys.stderr)
        return 1

    if args.model_type == "classifier":
        report = detect_overfit_classifier(args.report)
    else:
        report = detect_overfit_relevance(args.report)

    _print_summary(report)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = _ROOT / "reports" / f"overfit_{report.model_type}_{timestamp}.json"
    write_json(out_path, _report_to_dict(report))
    print(f"[detect_overfit] Report written to: {out_path}")

    return 1 if report.any_overfit else 0


if __name__ == "__main__":
    sys.exit(main())
