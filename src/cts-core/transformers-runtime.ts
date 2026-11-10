/** Configure Transformers.js 2.x for the unified native CPU runtime. */
export async function loadTransformersRuntime(): Promise<any> {
  const load = new Function('name', 'return import(name)') as (name: string) => Promise<any>
  const transformers = await load('@xenova/transformers')
  const backend = await load('@xenova/transformers/src/backends/onnx.js')
  // ORT 1.16 rejects an unavailable wasm provider even when CPU is first.
  backend.executionProviders.splice(0, backend.executionProviders.length, 'cpu')
  return transformers
}
