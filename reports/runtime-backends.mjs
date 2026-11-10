import ort from 'onnxruntime-node'
console.log(ort.listSupportedBackends())
for (const provider of ['dml', 'cuda']) {
  try {
    const session = await ort.InferenceSession.create('reports/relevance-candidate/optimized.onnx', { executionProviders: [provider] })
    console.log(provider, 'READY', session.inputNames)
    await session.release()
  } catch (error) { console.log(provider, error.message) }
}
