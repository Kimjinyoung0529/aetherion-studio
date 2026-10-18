# AETHERION Bonsai Native Codec Lab v0.2

**Live:** https://hii.o-r.kr/lab/bonsai/

This is a native, browser-only WebGPU codec and matvec experiment for **PrismML Bonsai 2** quantized tensor formats. **It is not a completed Bonsai LLM runtime or chatbot.**

## What works

- Parses **actual `prism.hadamard` metadata** (folded tensor names, inverse embedding list, block size, per-width explicit sign vectors) and the `qwen35` hybrid attention layer counts from a user-selected GGUF. Reports strict compatibility issues; the audit does not claim successful model inference.
- Runs a **signed WebGPU blockwise Hadamard** (`signs × activation → normalized FWHT`) and compares it against an independent CPU inverse / parity reference. The sign vectors can come directly from the GGUF metadata.
- Adds a **staged single-real-tensor test**: GGUF compressed rows → GPU sign+Hadamard → readback → GPU packed matvec → CPU reference parity. The intermediary readback is intentionally simple and must be eliminated in a future fused production pipeline. `ssm_out` weights requiring GDN head permutation are guarded and not executed.
- Reads the actual published Prism fork **PTQ1_0 (GGML type 143)** block representation: 128 trits, 24 base-3 packed bytes, 2 tail bytes, and one little-endian FP16 scale = **28 bytes** (1.75 bits/weight).
- Reads Prism **PQ2_0 (type 142)**: 128 packed 2-bit values and one little-endian FP16 scale = **34 bytes** (2.125 bits/weight).
- The WGSL shader fetches packed bytes and decodes weights **inside the matvec loop**, without allocating a full FP32 weight tensor on GPU.
- Compares **every output row** against an independently calculated CPU reference. The CPU reference is a check, not a fallback backend.
- Accepts a locally selected GGUF file. It **streams metadata and selected bytes using File.slice**, lists supported PTQ1_0/PQ2_0 tensors, and lets the user test only the first 32 rows of a selected tensor.
- Browser file selection does **not** upload files to a server.
- Automatically executes GitHub Actions Node conformance tests on changes, including 5-trit code checks, PTQ/PQ round-trips, and synthetic GGUF streaming inspection.
- Adds an independent GPU WGSL **normalized Fast Walsh-Hadamard Transform (FWHT)** test (widths 64/128/256/512). The CPU reference verifies involution (FWHT(FWHT(x)) ≈ x) and the GPU output against CPU; **this is not the Bonsai-specific sign-flip/Hadamard integration**.

## Architecture

- `codec.js`: PTQ1_0/PQ2_0 block layouts, FP16 scaling, round-trip fixture encoding, CPU reference matvec.
- `gguf.js`: independent read-only GGUF v2/v3 metadata/tensor inspector, including selected Prism sign metadata.
- `engine.js`: first-party WGSL WebGPU packed matvec, numerical comparison, and file-picker integration.
- `index.html`: interactive research interface.
- `test_codec.mjs`: standalone Node conformance tests, no external npm packages.
- `hadamard.js`: independent direct WebGPU normalized FWHT and CPU reference, with GPU result comparison.
- `audit.js`: Prism explicit sign-map and folded-weight header validation.
- `signed_fold.js`: sign-first FWHT WGSL kernel and CPU inverse reference.
- `test_audit.mjs`, `test_signed_fold.mjs`: synthetic GGUF metadata, sign order, and orthogonality regression checks.
- `ffn.js`: first-party WGSL RMSNorm + SwiGLU dense feed-forward + residual kernel with deterministic CPU reference.
- `test_ffn.mjs`: checks FFN reference, zero-weight residual behavior, and shape guards (GPU output verification requires on-device browser).
- `test_hadamard.mjs`: standalone normalized FWHT algebraic / inverse test.

## Critical limits

- No full Bonsai 2 generation, tokenizer, real-model logits, full GGUF loading, **model-specific** Hadamard/sign-flip integration, or Qwen3.5 hybrid attention implementation yet.
- Real GGUF inspection requires the user to **already have the GGUF file** on the device.
- A pass here means **some tensor data was decoded and its matvec output matched the CPU reference**. It does not prove that Bonsai chat works or that all its tensors are supported.
- A ~430 MB ternary weight file does not mean the full model consumes only 430 MB at runtime.
- Native Safari/iPhone WebGPU compute still needs user-device verification. CI validates JavaScript and codec logic; it does not run a genuine iPhone GPU.

## Upstream references

- [PrismML llama.cpp fork / actual PTQ/PQ codec source](https://github.com/PrismML-Eng/llama.cpp/blob/prism/ggml/src/ggml-quants.c)
- [PrismML GGUF layout definitions](https://github.com/PrismML-Eng/llama.cpp/blob/prism/ggml/src/ggml-common.h)
- [Bonsai 2 2B model](https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf)
- [Format and backend notes](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/MODEL-FORMATS.md)

## Next implementation milestones

1. Compare **real PrismML fixture/logits** to the existing decoder and transform steps. CPU self-parity alone cannot prove full PrismML compatibility.
2. Integrate the correct Prism Bonsai 2 sign-flip/Hadamard transforms at the verified model graph locations (the generic FWHT proof of concept is implemented separately).
3. Implement the Qwen3.5 hybrid model graph, tokenizer, state cache, KV cache, streaming autoregressive decode.
4. Logit/token parity testing against a trusted reference across multiple prompts and browsers.

## Latest FFN building block

A handcrafted WebGPU shader now benchmarks **RMSNorm → Gate/Up projections → SiLU(gate)·up → Down projection → residual** on deterministic 32/64-wide test tensors. This is an independent Qwen3.5-style FFN primitive, not a validated Bonsai layer: correct model tensors, sign transforms, GDN recurrence, rotary embeddings, cache handling, tokenizer and real-model logit parity remain unimplemented.
