import pathlib
import shutil
import torch
import onnx
from transformers import AutoModel, AutoTokenizer
from onnxruntime.transformers.optimizer import optimize_model
from onnxruntime.quantization import quantize_dynamic, QuantType

root = pathlib.Path(__file__).resolve().parents[1]
torch.set_num_threads(4)
for name, source in [
    ('relevance', str(root / 'models/relevance_synthetic_20261020_040034')),
    ('cache', 'sentence-transformers/all-MiniLM-L6-v2'),
]:
    out_dir = root / 'reports' / f'{name}-candidate'
    out_dir.mkdir(exist_ok=True)
    model = AutoModel.from_pretrained(source, local_files_only=True, attn_implementation='eager').eval()
    tokenizer = AutoTokenizer.from_pretrained(source, local_files_only=True)
    inputs = tokenizer('Why does my TypeScript Express server return an error?', return_tensors='pt')
    names = list(inputs)
    class ExportModel(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.encoder = model
        def forward(self, *args):
            return self.encoder(**dict(zip(names, args))).last_hidden_state
    original = out_dir / 'model.onnx'
    with torch.no_grad():
        torch.onnx.export(ExportModel(model), tuple(inputs.values()), str(original), dynamo=False,
            input_names=names, output_names=['last_hidden_state'], opset_version=14,
            dynamic_axes={**{n: {0:'batch',1:'sequence'} for n in names}, 'last_hidden_state':{0:'batch',1:'sequence'}})
    optimized = optimize_model(str(original), model_type='bert', num_heads=12, hidden_size=384, opt_level=1)
    print(name, optimized.get_fused_operator_statistics(), flush=True)
    optimized_path = out_dir / 'optimized.onnx'
    optimized.save_model_to_file(str(optimized_path))
    quantize_dynamic(str(optimized_path), str(out_dir / 'model_quantized.onnx'), weight_type=QuantType.QInt8, per_channel=True, extra_options={'DefaultTensorType': onnx.TensorProto.FLOAT})
    tokenizer.save_pretrained(str(out_dir))
    model.config.save_pretrained(str(out_dir))
    print('Saved', out_dir, flush=True)
