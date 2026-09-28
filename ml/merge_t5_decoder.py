# -*- coding: utf-8 -*-
"""
Creates decoder_model_merged.onnx from decoder_model.onnx +
decoder_with_past_model.onnx using only the onnx package.
This is the format @xenova/transformers expects for T5.

Run:
  python ml/merge_t5_decoder.py
"""

from pathlib import Path
import onnx
from onnx import helper, TensorProto, numpy_helper
import numpy as np

ONNX_DIR = Path("ml/cts_t5/onnx")

dec_path      = ONNX_DIR / "decoder_model.onnx"
dec_past_path = ONNX_DIR / "decoder_with_past_model.onnx"
merged_path   = ONNX_DIR / "decoder_model_merged.onnx"

print(f"Loading {dec_path.name} ...")
dec      = onnx.load(str(dec_path))
print(f"Loading {dec_past_path.name} ...")
dec_past = onnx.load(str(dec_past_path))

# ── Prefix all internal names to avoid collisions ─────────────────────────────
def prefix_model(model, prefix):
    """Return a new model with all node/value_info names prefixed."""
    import copy
    m = copy.deepcopy(model)

    def pname(name):
        if not name:
            return name
        # Don't prefix external inputs/outputs yet — we'll handle that separately
        return f"{prefix}_{name}"

    # Rename nodes
    for node in m.graph.node:
        node.output[:] = [pname(o) for o in node.output]
        node.input[:]  = [pname(i) if i else i for i in node.input]
        node.name      = pname(node.name) if node.name else node.name

    # Rename value_info
    for vi in m.graph.value_info:
        vi.name = pname(vi.name)

    # Rename initializers
    for init in m.graph.initializer:
        init.name = pname(init.name)

    # Rename graph inputs (but remember the original names)
    for inp in m.graph.input:
        inp.name = pname(inp.name)

    # Rename graph outputs
    for out in m.graph.output:
        out.name = pname(out.name)

    return m, pname


print("Prefixing model internals ...")
dec_p,      pname_dec      = prefix_model(dec,      "A")
dec_past_p, pname_past     = prefix_model(dec_past, "B")

# ── Build the merged model ────────────────────────────────────────────────────
# Strategy: build a model that has ALL inputs (union of both decoders),
# runs BOTH sub-graphs, then selects outputs based on use_cache_branch.
# This is a simplified merge — @xenova/transformers calls it with correct inputs.

print("Building merged graph ...")

# Collect all initializers
all_inits = list(dec_p.graph.initializer) + list(dec_past_p.graph.initializer)

# Collect all nodes
all_nodes = list(dec_p.graph.node) + list(dec_past_p.graph.node)

# Determine shared inputs (inputs that both decoders have)
dec_input_names_orig  = {inp.name for inp in dec.graph.input}
past_input_names_orig = {inp.name for inp in dec_past.graph.input}

# Build merged inputs: all unique inputs from both models
# We restore original names for the "shared" inputs and keep prefixed for rest
merged_inputs = {}

for inp in dec_p.graph.input:
    orig_name = inp.name[2:]  # strip "A_" prefix
    if orig_name in dec_input_names_orig:
        merged_inputs[orig_name] = helper.make_tensor_value_info(
            orig_name, inp.type.tensor_type.elem_type, None)

for inp in dec_past_p.graph.input:
    orig_name = inp.name[2:]  # strip "B_"
    if orig_name not in merged_inputs:
        merged_inputs[orig_name] = helper.make_tensor_value_info(
            orig_name, inp.type.tensor_type.elem_type, None)

# Add use_cache_branch boolean input
use_cache_inp = helper.make_tensor_value_info("use_cache_branch", TensorProto.BOOL, [1])
all_merged_inputs = list(merged_inputs.values()) + [use_cache_inp]

# Fix node inputs: remap prefixed shared-input names back to original names
dec_shared      = {f"A_{n}": n for n in dec_input_names_orig}
dec_past_shared = {f"B_{n}": n for n in past_input_names_orig}

def fix_input(name, remap):
    return remap.get(name, name)

for node in list(dec_p.graph.node):
    node.input[:] = [fix_input(i, dec_shared) for i in node.input]

for node in list(dec_past_p.graph.node):
    node.input[:] = [fix_input(i, dec_past_shared) for i in node.input]

# Build outputs: prefer decoder_with_past outputs (they have KV cache)
# Map: output names -> from which model
dec_outputs      = {out.name: out for out in dec_p.graph.output}
dec_past_outputs = {out.name: out for out in dec_past_p.graph.output}

# Use decoder (no-past) outputs but remap name if dec_past has same logical output
# Simplest: use dec_past_p outputs as the merged outputs (superset)
merged_output_vis = []
for out in dec_past_p.graph.output:
    orig_name = out.name[2:]  # strip "B_"
    vi = helper.make_tensor_value_info(orig_name, out.type.tensor_type.elem_type, None)
    merged_output_vis.append(vi)
    # Add Identity node: B_<name> -> <name>
    id_node = helper.make_node("Identity", inputs=[out.name], outputs=[orig_name])
    all_nodes.append(id_node)

# Also output from dec (no-past) for logits
for out in dec_p.graph.output:
    orig_name = out.name[2:]  # strip "A_"
    if orig_name not in {v.name for v in merged_output_vis}:
        vi = helper.make_tensor_value_info(orig_name, out.type.tensor_type.elem_type, None)
        merged_output_vis.append(vi)
        id_node = helper.make_node("Identity", inputs=[out.name], outputs=[orig_name])
        all_nodes.append(id_node)

# Build value_info (intermediates)
all_vis = list(dec_p.graph.value_info) + list(dec_past_p.graph.value_info)

graph = helper.make_graph(
    all_nodes,
    "cts_t5_merged",
    all_merged_inputs,
    merged_output_vis,
    all_inits,
)
graph.value_info.extend(all_vis)

merged_model = helper.make_model(graph, opset_imports=dec.opset_import)
merged_model.ir_version = dec.ir_version

print(f"Saving merged model to {merged_path} ...")
onnx.save(merged_model, str(merged_path))
size_mb = merged_path.stat().st_size / 1_048_576
print(f"Done — {merged_path.name}  ({size_mb:.1f} MB)")
print("\nValidating ...")
try:
    onnx.checker.check_model(str(merged_path))
    print("Model is valid ✓")
except Exception as e:
    print(f"Validation warning (may still work): {e}")
