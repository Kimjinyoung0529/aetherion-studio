# AETHERION Native Generator v0.3 — first-party WebGPU character generator

Live research page: **https://hii.o-r.kr/lab/generate/**

This research engine is **not** a PrismML Bonsai runtime. It demonstrates a much smaller complete autoregressive generation loop with model arithmetic performed in a handwritten WebGPU WGSL shader. There is no Wllama, WebLLM, Transformers.js, ONNX, or hosted neural inference in the browser path.

## What is genuinely implemented

- Locally trained experimental 1-layer, 1-head **causal Transformer**; character vocabulary of 202 symbols; embedding width 16; feed-forward width 32; context 48 characters.
- A Q8 / signed int8 quantized neural model of **6,298 serialized weight bytes**, plus scales and Unicode vocabulary metadata in \`model.json\`.
- In \`core.wgsl\`: learned embedding + positional vectors, LayerNorm with epsilon 1e-5, Q/K/V linear transforms, causally correct final-token attention with online numerically stable softmax, residual path, ReLU feed-forward network, output projection tied to the input embeddings.
- In \`engine.js\`: browser WebGPU device allocation, buffer upload, compute dispatch, logits readback, greedy/top-8 temperature-based sampling, streamed character generation, stop control, and complete CPU reference of the same quantized equations.
- The browser **requires** three preflight GPU/CPU logit parity tests to pass (same top-1 token and max absolute logit difference below 0.08) before the generation button unlocks. If WebGPU is missing, no silent CPU fallback occurs.
- In \`test_generator.mjs\`: deterministic Q8 model regression checks with four exact generated sample answers, run by GitHub Actions on changes.

## Important limitations

- Trained from **24 short hand-authored example Q/A pairs**. Tiny model, tiny vocabulary, very limited capacity. It may overfit and emit wrong, repetitive or malformed Korean for unseen inputs.
- The browser selects and displays characters on CPU, but **neural model math for generation** is computed by the WebGPU shader. The CPU network is used only for the preflight reference.
- The numerical reference follows the quantized model. It is **not evidence** of equivalence to the original floating point training model. There is no full Bonsai parity, no Qwen3.5 support, and no generic GGUF loading in this page.
- This implementation recalculates attention from scratch for the last token at each step instead of using a KV cache. At 48 characters this is acceptable as a research example, not suitable for 2B models.
- \`lab/train_generator.py\` is the offline training recipe using PyTorch, and its current default output is \`lab/generator-model.json\` (an alternative trained checkpoint). The shipped \`lab/generate/model.json\` is a separately pinned 0.2 training checkpoint. They **do not produce identical Q8 arrays**. Regression tests pin the actual shipped weights; retraining is not guaranteed to reproduce the same file.

## Files

- \`index.html\` — standalone mobile generator interface
- \`model.json\` — pinned trained tiny checkpoint
- \`core.wgsl\` — direct handwritten WGSL Transformer forward pass
- \`engine.js\` — browser runtime plus independent CPU reference
- \`app.js\` — streaming text generation and UI
- \`test_generator.mjs\` — no-dependency CPU reference regression tests

## Testing

~~~bash
node lab/generate/test_generator.mjs
node --check lab/generate/engine.js
node --check lab/generate/app.js
~~~

**GPU compile/dispatch validation requires a WebGPU-equipped browser.** GitHub Actions cannot by itself verify successful GPU output on iPhone Safari.

## Toward Bonsai 2B

The Bonsai 2 2B checkpoint is architecturally different. See \`lab/bonsai/\` for independent PrismML PTQ1_0/PQ2_0 codec and WebGPU matvec research, GGUF partial-tensor inspection, and normalized Hadamard experiments. To actually run Bonsai we still need graph transforms/sign flips, tokenizer, Qwen3.5 hybrid GDN/attention layers, model-wide weight loading, state/KV cache, and per-layer logit parity against a trusted reference.

The research pages deliberately label these components as unintegrated rather than pretending a 2B model is already running.
