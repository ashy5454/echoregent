import pathlib
from collections import Counter
import onnx
from onnxruntime.transformers.optimizer import optimize_model
from onnxruntime.quantization import quantize_dynamic, QuantType

root = pathlib.Path(__file__).resolve().parents[1]
original = root / 'ml/cts_relevance/onnx/model.onnx'
model = onnx.load(original)
print('Original', model.ir_version, Counter(n.op_type for n in model.graph.node), flush=True)
optimized = optimize_model(str(original), model_type='bert', num_heads=12, hidden_size=384, opt_level=1)
out = root / 'reports/relevance-optimized.onnx'
optimized.save_model_to_file(str(out))
print('Optimized', Counter(n.op_type for n in optimized.model.graph.node), flush=True)
quantized = root / 'reports/relevance-optimized-quantized.onnx'
quantize_dynamic(str(out), str(quantized), weight_type=QuantType.QInt8, per_channel=True)
print('Quantized', Counter(n.op_type for n in onnx.load(quantized).graph.node), flush=True)
