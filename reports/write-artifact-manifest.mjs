import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
const paths=[
 'ml/cts_classifier/compact_weights.json','ml/cts_classifier/label_map.json',
 'ml/cts_relevance/onnx/model_pooled_quantized.onnx','ml/cts_relevance/tokenizer.json',
 'models/relevance_synthetic_20261020_040034/model.safetensors',
 'ml/cts_minilm/onnx/model_pooled_quantized.onnx','ml/cts_minilm/tokenizer.json',
]
const artifacts=paths.map(path=>({path,bytes:statSync(path).size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))
for(const name of ['cts_relevance','cts_minilm']){
 const path=`ml/${name}/native_provenance.json`
 const provenance=JSON.parse(readFileSync(path,'utf8'))
 provenance.sha256=artifacts.find(row=>row.path===`ml/${name}/onnx/model_pooled_quantized.onnx`).sha256
 if(name==='cts_minilm')provenance.revision='1110a243fdf4706b3f48f1d95db1a4f5529b4d41'
 writeFileSync(path,JSON.stringify(provenance,null,2)+'\n')
}
writeFileSync('reports/model_artifact_manifest.json',JSON.stringify({runtime:'onnxruntime-node 1.16.3; Transformers.js 2.17.2',artifacts},null,2)+'\n')
console.log('Recorded seven model/tokenizer artifact hashes.')
