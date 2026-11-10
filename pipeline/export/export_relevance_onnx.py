"""
Export a fine-tuned SentenceTransformer to the layout the browser/Node
@xenova/transformers loader expects.

src/cts-core/ml-relevance.ts loads:
    ml/cts_relevance/model_quantized.onnx
with tokenizer/config files alongside it.

Usage:
    python -m pipeline.export.export_relevance_onnx \
        --model-dir models/relevance_synthetic_<ts> \
        --output-dir ml/cts_relevance
"""

import argparse
import inspect
import pathlib
import shutil
import sys

_ROOT = pathlib.Path(__file__).resolve().parents[2]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output-dir", default=str(_ROOT / "ml" / "cts_relevance"))
    parser.add_argument("--no-quantize", action="store_true")
    args = parser.parse_args()

    try:
        import torch
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        print(f"Missing dependency: {exc}")
        return 2

    model_dir = pathlib.Path(args.model_dir)
    if not model_dir.is_absolute():
        model_dir = _ROOT / model_dir
    output_dir = pathlib.Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = _ROOT / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading {model_dir} ...")
    sentence_model = SentenceTransformer(str(model_dir))
    auto_model = sentence_model[0].auto_model.eval()
    tokenizer = sentence_model.tokenizer

    dummy = tokenizer("warmup sentence", return_tensors="pt")
    forward_params = inspect.signature(auto_model.forward).parameters
    input_names = [name for name in ("input_ids", "attention_mask", "token_type_ids")
                   if name in forward_params and name in dummy]
    inputs = tuple(dummy[name] for name in input_names)

    onnx_dir = output_dir / "onnx"
    onnx_dir.mkdir(parents=True, exist_ok=True)
    onnx_path = onnx_dir / "model.onnx"
    dynamic_axes = {name: {0: "batch", 1: "sequence"} for name in input_names}
    dynamic_axes["last_hidden_state"] = {0: "batch", 1: "sequence"}
    dynamic_axes["pooler_output"] = {0: "batch"}

    class KeywordForward(torch.nn.Module):
        """Pass inputs by name: transformers 5.x reordered BertModel's
        positional parameters, so positional export binds the wrong arg."""

        def __init__(self, model, names):
            super().__init__()
            self.model = model
            self.names = list(names)

        def forward(self, *args):
            return self.model(**dict(zip(self.names, args)))

    export_model = KeywordForward(auto_model, input_names).eval()

    print(f"Exporting ONNX with inputs {input_names} ...")
    export_kwargs = dict(
        input_names=input_names,
        output_names=["last_hidden_state", "pooler_output"],
        dynamic_axes=dynamic_axes,
        opset_version=14,
        do_constant_folding=True,
    )
    with torch.no_grad():
        try:
            # Legacy exporter: predictable output names and dynamic axes.
            torch.onnx.export(export_model, inputs, str(onnx_path), dynamo=False, **export_kwargs)
        except TypeError:
            torch.onnx.export(export_model, inputs, str(onnx_path), **export_kwargs)

    # @xenova/transformers also needs the tokenizer/config files.
    for name in ("config.json", "tokenizer.json", "tokenizer_config.json",
                 "special_tokens_map.json", "vocab.txt", "sentence_bert_config.json"):
        source = model_dir / name
        if source.exists():
            shutil.copy2(source, output_dir / name)

    if not args.no_quantize:
        try:
            from onnxruntime.quantization import quantize_dynamic, QuantType
            quantized_path = onnx_dir / "model_quantized.onnx"
            print("Quantizing to int8 ...")
            quantize_dynamic(str(onnx_path), str(quantized_path), weight_type=QuantType.QInt8)
        except Exception as exc:  # noqa: BLE001 - report and keep the fp32 export
            print(f"Quantization skipped ({exc}); fp32 model.onnx remains usable if quantized:false is set.")

    print(f"Exported to {output_dir}")
    for item in sorted(output_dir.iterdir()):
        print(f"  {item.name}: {item.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
