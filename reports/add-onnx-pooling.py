import pathlib
import onnx
from onnx import helper, TensorProto
from onnxruntime.transformers.float16 import convert_float_to_float16

root = pathlib.Path(__file__).resolve().parents[1]
for name in ['relevance', 'cache']:
    folder = root / 'reports' / f'{name}-candidate'
    for variant in (['model', 'model_quantized', 'uint8', 'int8-reduced'] if name=='relevance' else ['model', 'model_quantized']):
        if not (folder / f'{variant}.onnx').exists(): continue
        model = onnx.load(folder / f'{variant}.onnx')
        hidden = model.graph.output[0].name
        nodes = [
            helper.make_node('Cast',['attention_mask'],['pool_mask'],to=TensorProto.FLOAT),
            helper.make_node('Unsqueeze',['pool_mask','pool_axes2'],['pool_mask3']),
            helper.make_node('Mul',[hidden,'pool_mask3'],['pool_weighted']),
            helper.make_node('ReduceSum',['pool_weighted','pool_axes1'],['pool_sum'],keepdims=0),
            helper.make_node('ReduceSum',['pool_mask','pool_axes1'],['pool_count'],keepdims=1),
            helper.make_node('Max',['pool_count','pool_epsilon'],['pool_count_safe']),
            helper.make_node('Div',['pool_sum','pool_count_safe'],['pool_mean']),
            helper.make_node('Mul',['pool_mean','pool_mean'],['pool_squared']),
            helper.make_node('ReduceSum',['pool_squared','pool_axes1'],['pool_norm2'],keepdims=1),
            helper.make_node('Sqrt',['pool_norm2'],['pool_norm']),
            helper.make_node('Max',['pool_norm','pool_epsilon'],['pool_norm_safe']),
            helper.make_node('Div',['pool_mean','pool_norm_safe'],['sentence_embedding']),
        ]
        model.graph.initializer.extend([
            helper.make_tensor('pool_axes1',TensorProto.INT64,[1],[1]),
            helper.make_tensor('pool_axes2',TensorProto.INT64,[1],[2]),
            helper.make_tensor('pool_epsilon',TensorProto.FLOAT,[1],[1e-12]),
        ])
        model.graph.node.extend(nodes)
        del model.graph.output[:]
        model.graph.output.append(helper.make_tensor_value_info('sentence_embedding',TensorProto.FLOAT,['batch',384]))
        onnx.checker.check_model(model)
        onnx.save(model, folder / f'{variant}_pooled.onnx')
        if variant == 'model':
            fp16 = convert_float_to_float16(model,keep_io_types=True,disable_shape_infer=False)
            onnx.save(fp16, folder / 'model_fp16_pooled.onnx')
    print('Pooled exports saved for',name,flush=True)
