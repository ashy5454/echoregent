import pathlib, onnx
from onnxruntime.quantization import quantize_dynamic, QuantType
root=pathlib.Path(__file__).resolve().parents[1]
folder=root/'reports/relevance-candidate'
for label,kind,reduce in [('uint8',QuantType.QUInt8,False),('int8-reduced',QuantType.QInt8,True)]:
 quantize_dynamic(str(folder/'optimized.onnx'),str(folder/f'{label}.onnx'),weight_type=kind,per_channel=True,reduce_range=reduce,extra_options={'DefaultTensorType':onnx.TensorProto.FLOAT})
 print(label,'done',flush=True)
