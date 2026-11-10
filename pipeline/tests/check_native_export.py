"""Compare installed pooled int8 exports against source encoder weights."""
import json
import pathlib
import numpy as np
import torch
import onnxruntime as ort
from transformers import AutoTokenizer, AutoModel
ROOT=pathlib.Path(__file__).resolve().parents[2]
torch.set_num_threads(4)
reports=[]
for name,source in [('cts_relevance',str(ROOT/'models/relevance_synthetic_20261020_040034')),('cts_minilm','sentence-transformers/all-MiniLM-L6-v2')]:
    tokenizer=AutoTokenizer.from_pretrained(source,local_files_only=True)
    model=AutoModel.from_pretrained(source,local_files_only=True,attn_implementation='eager').eval()
    texts=['Reset the password from account settings.','The database socket hangs until the pool restarts.','Please select a quiet keyboard, not one with loud clicks.','The delivery arrived damaged and the refund is pending.']
    inputs=tokenizer(texts,padding=True,truncation=True,return_tensors='pt')
    with torch.no_grad():
        hidden=model(**inputs).last_hidden_state
        mask=inputs['attention_mask'].unsqueeze(-1)
        expected=torch.nn.functional.normalize((hidden*mask).sum(1)/mask.sum(1),p=2,dim=1).numpy()
    options=ort.SessionOptions(); options.intra_op_num_threads=4
    session=ort.InferenceSession(str(ROOT/'ml'/name/'onnx/model_pooled_quantized.onnx'),sess_options=options,providers=['CPUExecutionProvider'])
    actual=session.run(None,{key:inputs[key].numpy() for key in [entry.name for entry in session.get_inputs()]})[0]
    cosine=np.sum(expected*actual,axis=1)
    assert float(cosine.min())>0.98,(name,cosine)
    reports.append({'name':name,'minimum_source_export_cosine':float(cosine.min()),'vectors':len(texts),'passed':True})
(ROOT/'reports/native-export-parity.json').write_text(json.dumps(reports,indent=2)+'\n')
print(json.dumps(reports))
