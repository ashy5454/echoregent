"""Reproducible local export; keeps the existing relevance checkpoint intact.

Run: .venv/Scripts/python.exe pipeline/export/export_native_encoders.py
Requires locally cached base weights; never substitutes unrelated weights.
"""
import hashlib
import json
import pathlib
import shutil
import torch
import onnx
from onnx import helper, TensorProto
from transformers import AutoModel, AutoTokenizer
from huggingface_hub import try_to_load_from_cache
from onnxruntime.transformers.optimizer import optimize_model
from onnxruntime.quantization import quantize_dynamic, QuantType

ROOT = pathlib.Path(__file__).resolve().parents[2]

def export(name, source):
    scratch = ROOT / 'models' / 'native_exports' / name
    scratch.mkdir(parents=True, exist_ok=True)
    target = ROOT / 'ml' / name
    (target / 'onnx').mkdir(parents=True, exist_ok=True)
    model = AutoModel.from_pretrained(source, local_files_only=True, attn_implementation='eager').eval()
    tokenizer = AutoTokenizer.from_pretrained(source, local_files_only=True)
    inputs = tokenizer('Why does the server return an error?', return_tensors='pt')
    names = list(inputs)
    # Register the model so parameters are exported as weights.
    class ExportModel(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder = model
        def forward(self, *args):
            return self.encoder(**dict(zip(names, args))).last_hidden_state
    graph = scratch / 'model.onnx'
    with torch.no_grad():
        torch.onnx.export(ExportModel(), tuple(inputs.values()), str(graph), dynamo=False,
            input_names=names, output_names=['last_hidden_state'], opset_version=14,
            dynamic_axes={**{n:{0:'batch',1:'sequence'} for n in names},'last_hidden_state':{0:'batch',1:'sequence'}})
    optimized = optimize_model(str(graph), model_type='bert', num_heads=12, hidden_size=384, opt_level=1)
    optimized_path = scratch / 'optimized.onnx'
    optimized.save_model_to_file(str(optimized_path))
    quantized = scratch / 'quantized.onnx'
    quantize_dynamic(str(optimized_path), str(quantized), weight_type=QuantType.QInt8,
        per_channel=True, extra_options={'DefaultTensorType': TensorProto.FLOAT})
    pooled = onnx.load(quantized)
    pooled.graph.initializer.extend([
        helper.make_tensor('pool_axes1',TensorProto.INT64,[1],[1]),
        helper.make_tensor('pool_axes2',TensorProto.INT64,[1],[2]),
        helper.make_tensor('pool_epsilon',TensorProto.FLOAT,[1],[1e-12]),
    ])
    pooled.graph.node.extend([
        helper.make_node('Cast',['attention_mask'],['pool_mask'],to=TensorProto.FLOAT),
        helper.make_node('Unsqueeze',['pool_mask','pool_axes2'],['pool_mask3']),
        helper.make_node('Mul',['last_hidden_state','pool_mask3'],['pool_weighted']),
        helper.make_node('ReduceSum',['pool_weighted','pool_axes1'],['pool_sum'],keepdims=0),
        helper.make_node('ReduceSum',['pool_mask','pool_axes1'],['pool_count'],keepdims=1),
        helper.make_node('Max',['pool_count','pool_epsilon'],['pool_count_safe']),
        helper.make_node('Div',['pool_sum','pool_count_safe'],['pool_mean']),
        helper.make_node('Mul',['pool_mean','pool_mean'],['pool_squared']),
        helper.make_node('ReduceSum',['pool_squared','pool_axes1'],['pool_norm2'],keepdims=1),
        helper.make_node('Sqrt',['pool_norm2'],['pool_norm']),
        helper.make_node('Max',['pool_norm','pool_epsilon'],['pool_norm_safe']),
        helper.make_node('Div',['pool_mean','pool_norm_safe'],['sentence_embedding']),
    ])
    del pooled.graph.output[:]
    pooled.graph.output.append(helper.make_tensor_value_info('sentence_embedding',TensorProto.FLOAT,['batch',384]))
    used_domains = {node.domain for node in pooled.graph.node}
    imports = [entry for entry in pooled.opset_import if entry.domain in used_domains]
    del pooled.opset_import[:]
    pooled.opset_import.extend(imports)
    pooled.ir_version = 8
    onnx.checker.check_model(pooled)
    output = scratch / 'model_pooled_quantized.onnx'
    onnx.save(pooled, output)
    shutil.copy2(output, target / 'onnx' / output.name)
    tokenizer.save_pretrained(target)
    model.config.save_pretrained(target)
    cached_config = try_to_load_from_cache(source, 'config.json') if not pathlib.Path(source).exists() else None
    revision = pathlib.Path(cached_config).parent.name if isinstance(cached_config,str) else None
    provenance = {'source':source,'revision':revision,
        'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
        'architecture':'MiniLM-L6-H384, eager attention, per-channel int8, masked mean pooling, L2 normalization'}
    (target / 'native_provenance.json').write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf8')
    print(json.dumps(provenance),flush=True)

if __name__ == '__main__':
    torch.set_num_threads(4)
    export('cts_relevance',str(ROOT/'models/relevance_synthetic_20261020_040034'))
    export('cts_minilm','sentence-transformers/all-MiniLM-L6-v2')
