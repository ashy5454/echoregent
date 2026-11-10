"""
Export trained PyTorch checkpoints to ONNX, verify IR version <= 8,
apply int8 quantization, and run sanity checks before promotion.

ONNX IR version constraint:
  onnxruntime-node in this stack only supports IR version <= 8.
  optimum-cli with --opset 14 produces IR version 8 when using
  optimum==1.17.1 + onnx==1.14.1 (pinned in requirements.txt).

Sanity checks:
  Classifier: run inference on inputs from 5+ distinct domains; assert
              top predictions are not all the same class.
  Relevance:  run inference; assert output embedding is not constant
              (max - min > 0.001).

Usage:
    python -m pipeline.export.export_onnx --classifier models/classifier_<ts>/ --output ml/cts_classifier/
    python -m pipeline.export.export_onnx --relevance  models/relevance_<ts>/  --output ml/cts_relevance/
"""

import argparse
import json
import pathlib
import shutil
import subprocess
import sys
from datetime import datetime

# ONNX + onnxruntime — heavy optional deps
try:
    import onnx
    import onnxruntime as ort
    from onnxruntime.quantization import quantize_static, quantize_dynamic, QuantType
    from onnxruntime.quantization.calibrate import CalibrationDataReader
except ImportError as e:
    sys.exit(f"Missing dependency: {e}. Run: pip install onnx==1.14.1 onnxruntime==1.17.1")

try:
    from transformers import AutoTokenizer
    import numpy as np
except ImportError as e:
    sys.exit(f"Missing dependency: {e}. Run: pip install -r pipeline/requirements.txt")

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))
from pipeline.utils import read_json, write_json  # noqa: E402

MAX_ONNX_IR_VERSION = 8

# One probe sentence per domain — used for classifier sanity check and
# as a minimal calibration fallback when no corpus is provided.
_DOMAIN_PROBES = [
    # coding
    "Implement a binary search algorithm in Python that handles edge cases.",
    # customer_support
    "I have not received my order yet and the tracking shows it is stuck.",
    # sales
    "We are evaluating your enterprise plan and need a volume discount quote.",
    # legal
    "The indemnification clause in section 12 conflicts with our standard MSA terms.",
    # medical
    "Patient presents with acute chest pain radiating to the left arm since yesterday.",
    # education
    "Can you explain the difference between mitosis and meiosis for a high school student?",
    # commerce
    "The product listing shows a price discrepancy between the cart and checkout page.",
    # general
    "What is the weather forecast for New York City this weekend?",
]


class ExportError(Exception):
    pass


class SanityError(Exception):
    pass


# ---------------------------------------------------------------------------
# IR-version gate
# ---------------------------------------------------------------------------

def assert_ir_version(onnx_path: pathlib.Path) -> None:
    """Load *onnx_path* and raise ExportError when IR version exceeds the cap."""
    model = onnx.load(str(onnx_path))
    if model.ir_version > MAX_ONNX_IR_VERSION:
        raise ExportError(
            f"IR version {model.ir_version} > {MAX_ONNX_IR_VERSION} "
            "— incompatible with onnxruntime-node"
        )


# ---------------------------------------------------------------------------
# Sanity checks
# ---------------------------------------------------------------------------

def sanity_check_classifier(
    onnx_path: pathlib.Path,
    label_map: dict,
    tokenizer_name: str = "distilbert-base-uncased",
) -> None:
    """Run inference on 8 domain probes; assert at least 5 distinct predictions."""
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)

    predicted_classes: list[int] = []
    for sentence in _DOMAIN_PROBES:
        enc = tokenizer(
            sentence,
            padding="max_length",
            max_length=256,
            truncation=True,
            return_tensors="np",
        )
        inputs = {
            "input_ids": enc["input_ids"].astype(np.int64),
            "attention_mask": enc["attention_mask"].astype(np.int64),
        }
        outputs = session.run(None, inputs)
        logits = outputs[0]  # shape (1, num_labels)

        if np.any(np.isnan(logits)) or np.any(np.isinf(logits)):
            raise SanityError(
                f"NaN/Inf in classifier output for probe: {sentence!r}"
            )

        predicted_classes.append(int(np.argmax(logits, axis=-1)[0]))

    distinct = len(set(predicted_classes))
    if distinct < 5:
        raise SanityError(
            f"Classifier predicted only {distinct} distinct class(es) across "
            f"8 domain probes — expected at least 5. "
            f"Predictions: {predicted_classes}"
        )

    print(
        f"  [sanity] classifier OK — {distinct} distinct predictions "
        f"across {len(_DOMAIN_PROBES)} probes"
    )


def sanity_check_relevance(onnx_path: pathlib.Path) -> None:
    """Run inference on a short input; assert embedding is not near-constant."""
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

    # Use a non-trivial sentence so pooling produces a real embedding.
    test_sentence = (
        "Evaluate whether this conversation turn is relevant to the ongoing topic."
    )
    # Detect tokenizer from the model directory — fall back to bert-base-uncased.
    model_dir = onnx_path.parent
    tokenizer_name = "bert-base-uncased"
    tokenizer_config = model_dir / "tokenizer_config.json"
    if tokenizer_config.exists():
        try:
            cfg = read_json(tokenizer_config)
            tokenizer_name = cfg.get("tokenizer_class", tokenizer_name)
        except Exception:
            pass

    tokenizer = AutoTokenizer.from_pretrained(
        str(model_dir) if (model_dir / "vocab.txt").exists() else tokenizer_name
    )
    enc = tokenizer(
        test_sentence,
        padding="max_length",
        max_length=256,
        truncation=True,
        return_tensors="np",
    )
    inputs = {
        "input_ids": enc["input_ids"].astype(np.int64),
        "attention_mask": enc["attention_mask"].astype(np.int64),
    }
    outputs = session.run(None, inputs)

    # feature-extraction models return last_hidden_state (B, seq, dim) or
    # a pooled embedding (B, dim).  Flatten to 1-D for the range check.
    embedding = outputs[0].flatten()

    if np.any(np.isnan(embedding)) or np.any(np.isinf(embedding)):
        raise SanityError("NaN/Inf in relevance model output.")

    value_range = float(np.max(embedding) - np.min(embedding))
    if value_range <= 0.001:
        raise SanityError(
            f"Output embedding is near-constant — degenerate model "
            f"(max-min={value_range:.6f})"
        )

    print(f"  [sanity] relevance OK — embedding range {value_range:.4f}")


# ---------------------------------------------------------------------------
# Calibration data reader (static quantization for classifier)
# ---------------------------------------------------------------------------

class ClassifierCalibrationReader(CalibrationDataReader):
    """Feed tokenized batches from *corpus_path* for static int8 calibration."""

    def __init__(
        self,
        corpus_path: pathlib.Path | None,
        tokenizer_name: str,
        n_samples: int = 100,
    ) -> None:
        self._tokenizer = AutoTokenizer.from_pretrained(tokenizer_name)
        self._n_samples = n_samples
        self._idx = 0
        self._sentences: list[str] = []

        if corpus_path is not None and corpus_path.exists():
            with corpus_path.open("r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                        text = obj.get("text") or obj.get("sentence") or obj.get("content") or ""
                        if text:
                            self._sentences.append(text)
                    except json.JSONDecodeError:
                        continue
                    if len(self._sentences) >= n_samples:
                        break

        # Pad / fallback to probe sentences if corpus too small.
        if len(self._sentences) < n_samples:
            # Cycle through probes to reach n_samples.
            repeats = (n_samples - len(self._sentences)) // len(_DOMAIN_PROBES) + 1
            self._sentences += (_DOMAIN_PROBES * repeats)[
                : n_samples - len(self._sentences)
            ]

    # CalibrationDataReader interface

    def get_next(self) -> dict | None:
        if self._idx >= min(self._n_samples, len(self._sentences)):
            return None
        sentence = self._sentences[self._idx]
        self._idx += 1
        enc = self._tokenizer(
            sentence,
            padding="max_length",
            max_length=256,
            truncation=True,
            return_tensors="np",
        )
        return {
            "input_ids": enc["input_ids"].astype(np.int64),
            "attention_mask": enc["attention_mask"].astype(np.int64),
        }

    def rewind(self) -> None:
        self._idx = 0


# ---------------------------------------------------------------------------
# Export + quantize: classifier
# ---------------------------------------------------------------------------

def export_and_quantize_classifier(
    checkpoint_path: pathlib.Path,
    output_dir: pathlib.Path,
    corpus_path: pathlib.Path | None = None,
) -> None:
    """Export *checkpoint_path* to ONNX, quantize, verify, and promote."""
    label_map_src = checkpoint_path / "label_map.json"
    if not label_map_src.exists():
        raise ExportError(
            f"label_map.json not found in checkpoint: {checkpoint_path}"
        )
    label_map: dict = read_json(label_map_src)

    float32_dir = output_dir / "float32"
    float32_dir.mkdir(parents=True, exist_ok=True)

    # Infer the tokenizer name from the checkpoint (fall back to distilbert).
    tokenizer_name = "distilbert-base-uncased"
    tc_path = checkpoint_path / "tokenizer_config.json"
    if tc_path.exists():
        try:
            tc = read_json(tc_path)
            if tc.get("name_or_path"):
                tokenizer_name = tc["name_or_path"]
        except Exception:
            pass

    # --- Step 1: optimum-cli ONNX export ---
    print(f"[export] Running optimum-cli for classifier → {float32_dir}")
    result = subprocess.run(
        [
            sys.executable, "-m", "optimum.exporters.onnx",
            "--model", str(checkpoint_path),
            "--task", "text-classification",
            "--opset", "14",
            str(float32_dir),
        ],
        capture_output=True,
        text=True,
    )
    # optimum ≥ 1.14 also accepts the CLI entry point; try that if the above fails.
    if result.returncode != 0:
        result = subprocess.run(
            [
                "optimum-cli", "export", "onnx",
                "--model", str(checkpoint_path),
                "--task", "text-classification",
                "--opset", "14",
                str(float32_dir),
            ],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        raise ExportError(
            f"optimum-cli export failed (rc={result.returncode}):\n"
            f"{result.stderr.strip()}"
        )

    float32_model = float32_dir / "model.onnx"
    if not float32_model.exists():
        raise ExportError(
            f"optimum-cli exited 0 but model.onnx not found at {float32_model}"
        )

    # --- Step 2: IR version gate ---
    print(f"[export] Asserting IR version ≤ {MAX_ONNX_IR_VERSION} (float32)")
    assert_ir_version(float32_model)

    # --- Step 3: static int8 quantization ---
    quantized_model = output_dir / "model_quantized.onnx"
    print("[export] Applying static int8 quantization …")
    calibration_reader = ClassifierCalibrationReader(
        corpus_path=corpus_path,
        tokenizer_name=tokenizer_name,
        n_samples=100,
    )
    quantize_static(
        model_input=str(float32_model),
        model_output=str(quantized_model),
        calibration_data_reader=calibration_reader,
        weight_type=QuantType.QInt8,
    )

    # --- Step 4: IR version gate on quantized model ---
    print(f"[export] Asserting IR version ≤ {MAX_ONNX_IR_VERSION} (quantized)")
    assert_ir_version(quantized_model)

    # --- Step 5: sanity check ---
    print("[export] Running classifier sanity check …")
    sanity_check_classifier(
        onnx_path=quantized_model,
        label_map=label_map,
        tokenizer_name=tokenizer_name,
    )

    # --- Step 6: copy label_map.json ---
    label_map_dst = output_dir / "label_map.json"
    try:
        shutil.copy2(str(label_map_src), str(label_map_dst))
    except OSError as exc:
        # Roll back partial artefact so downstream consumers don't pick up a
        # broken export.
        quantized_model.unlink(missing_ok=True)
        raise ExportError(
            f"Failed to copy label_map.json to {label_map_dst}: {exc}"
        ) from exc

    # --- Done ---
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(
        f"\n✓ Classifier export complete [{ts}]\n"
        f"  float32 : {float32_model}\n"
        f"  quantized: {quantized_model}\n"
        f"  label_map: {label_map_dst}\n"
    )


# ---------------------------------------------------------------------------
# Export + quantize: relevance encoder
# ---------------------------------------------------------------------------

def export_and_quantize_relevance(
    checkpoint_path: pathlib.Path,
    output_dir: pathlib.Path,
) -> None:
    """Export *checkpoint_path* to ONNX, dynamic-quantize weights, and verify."""
    float32_dir = output_dir / "float32"
    float32_dir.mkdir(parents=True, exist_ok=True)

    # --- Step 1: optimum-cli ONNX export ---
    print(f"[export] Running optimum-cli for relevance encoder → {float32_dir}")
    result = subprocess.run(
        [
            sys.executable, "-m", "optimum.exporters.onnx",
            "--model", str(checkpoint_path),
            "--task", "feature-extraction",
            "--opset", "14",
            str(float32_dir),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        result = subprocess.run(
            [
                "optimum-cli", "export", "onnx",
                "--model", str(checkpoint_path),
                "--task", "feature-extraction",
                "--opset", "14",
                str(float32_dir),
            ],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        raise ExportError(
            f"optimum-cli export failed (rc={result.returncode}):\n"
            f"{result.stderr.strip()}"
        )

    float32_model = float32_dir / "model.onnx"
    if not float32_model.exists():
        raise ExportError(
            f"optimum-cli exited 0 but model.onnx not found at {float32_model}"
        )

    # --- Step 2: IR version gate ---
    print(f"[export] Asserting IR version ≤ {MAX_ONNX_IR_VERSION} (float32)")
    assert_ir_version(float32_model)

    # --- Step 3: dynamic int8 quantization (weights only) ---
    quantized_model = output_dir / "model_quantized.onnx"
    print("[export] Applying dynamic int8 weight quantization …")
    quantize_dynamic(
        model_input=str(float32_model),
        model_output=str(quantized_model),
        weight_type=QuantType.QInt8,
    )

    # --- Step 4: IR version gate on quantized model ---
    print(f"[export] Asserting IR version ≤ {MAX_ONNX_IR_VERSION} (quantized)")
    assert_ir_version(quantized_model)

    # --- Step 5: sanity check ---
    print("[export] Running relevance sanity check …")
    sanity_check_relevance(onnx_path=quantized_model)

    # --- Done ---
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    print(
        f"\n✓ Relevance export complete [{ts}]\n"
        f"  float32 : {float32_model}\n"
        f"  quantized: {quantized_model}\n"
    )


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Export and quantize EchoRegent model checkpoints to ONNX.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--classifier",
        metavar="CHECKPOINT_DIR",
        type=pathlib.Path,
        help="Path to a trained classifier checkpoint (HuggingFace format).",
    )
    group.add_argument(
        "--relevance",
        metavar="CHECKPOINT_DIR",
        type=pathlib.Path,
        help="Path to a trained relevance encoder checkpoint (HuggingFace format).",
    )
    parser.add_argument(
        "--output",
        metavar="OUTPUT_DIR",
        type=pathlib.Path,
        required=True,
        help="Directory where ONNX artefacts will be written.",
    )
    parser.add_argument(
        "--corpus",
        metavar="CORPUS_PATH",
        type=pathlib.Path,
        default=None,
        help=(
            "Optional path to a .jsonl corpus for static calibration "
            "(classifier only). Each line must have a 'text' field."
        ),
    )
    return parser


if __name__ == "__main__":
    parser = _build_parser()
    args = parser.parse_args()

    try:
        if args.classifier is not None:
            export_and_quantize_classifier(
                checkpoint_path=args.classifier.resolve(),
                output_dir=args.output.resolve(),
                corpus_path=args.corpus.resolve() if args.corpus else None,
            )
        else:
            export_and_quantize_relevance(
                checkpoint_path=args.relevance.resolve(),
                output_dir=args.output.resolve(),
            )
    except (ExportError, SanityError) as exc:
        print(f"\n✗ Export failed: {exc}", file=sys.stderr)
        sys.exit(1)
