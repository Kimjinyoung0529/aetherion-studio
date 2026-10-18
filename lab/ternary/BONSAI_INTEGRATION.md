# Bonsai 2 / PTQ1_0 integration — engineering checklist

This is a **research integration plan**, not a claim that the AETHERION native engine can run PrismML Bonsai today.

Official model: https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf

## Stage 1 — inspect and validate the actual format
- Pin an exact model revision and file SHA-256.
- Inspect upstream PrismML PTQ1_0 / PQ2_0 block layout and GGUF tensor types from official source. Do not assume that our generic 1.6-bit trit packing is binary compatible.
- Build a fixture with known packed bytes, scales, dimensions, and a trusted reference output.
- Add a parser that rejects unsupported GGUF tensor types instead of silently interpreting bytes as ordinary trits.

## Stage 2 — implement WGSL dequantization
- Implement PTQ1_0 decode matching the official reference, including grouping, scales, and any transform required by the selected tensor format.
- Verify individual decoded weights, matrix-vector products, and numerical error against a CPU reference.
- Benchmark mobile GPU memory allocation and dispatch/readback overhead. Keep the test matrix small before allocating full model weights.

## Stage 3 — implement the model
- Read exact GGUF metadata for tokenizer, RoPE, layer count, and hybrid attention architecture.
- Implement attention and state-space components required by the specific Bonsai 2 variant; add KV/state cache and streaming decoding.
- Compare logits and token IDs against a trusted implementation at each layer.
- Only after parity tests, enable free-form chat.

## Stage 4 — ship safely
- Keep the existing /chat/ and /lab/ternary/ functional.
- Display actual downloaded bytes, GPU memory errors, and runtime status.
- Test Safari/iPhone on-device; a green GitHub Pages deployment is **not** a GPU inference test.

Current status: generic ternary WGSL matvec demo works in code and has CPU packing checks. **No PTQ1_0 GGUF loader or Bonsai inference yet.**
