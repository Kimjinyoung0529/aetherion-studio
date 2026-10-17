# AETHERION Native Lab — v0.1

A minimal **first-party WebGPU inference prototype**, maintained independently of the public /chat/ and /agent/ workspaces.

## What it really does

- Trains a small **15-class Korean/English intent classifier** with supervised examples and a deterministic, manually written stochastic gradient descent trainer.
- Encodes a sentence as a normalized 512-dimensional hashed character feature vector.
- Uploads **7,680 trained float32 weights + 15 biases** to WebGPU storage buffers.
- Executes the matrix-vector multiply **in WGSL on the device GPU**, then reads 15 logits back.
- Applies softmax on the JavaScript side and selects a clearly labeled, **authored response template**.
- Does **not** call Wllama, WebLLM, Transformers.js, ONNX Runtime, an AI API, or server inference.
- Does **not** claim to generate free-form text or run Noema. It is **not an LLM**.

## Files

- `index.html` — mobile-ready AETHERION Native Lab experience
- `app.js` — our WebGPU shader, browser inference pipeline, preprocessing, and UI
- `model.json` — training result / trained weights for first-party local inference
- `train.mjs` — reproducible minimal SGD trainer: `node lab/train.mjs` from repository root

No build process is required to serve the site on GitHub Pages. Native WebGPU support **and HTTPS** are required. The initial weights download is approximately 67 KB.

## Reproduction

```sh
node lab/train.mjs
```

The script writes a newly trained `lab/model.json` and uses no external machine learning framework. Output is deterministic with the fixed seed.

## Architecture and caveats

- Shape: `[512] × [15,512] + [15] → [15 logits]`
- GPU: 1 WGSL workgroup with 32 threads, one class per active invocation.
- CPU: text normalization/feature vector, softmax and selecting a prewritten response.
- Real WebGPU computation is done in browser; `navigator.gpu` detection **alone** isn't considered evidence.
- The probability is a score from a tiny classifier and **not** a calibrated confidence or factual correctness score.
- 7,695 trainable parameters; a small classification model may run **slower** on GPU than CPU due to dispatch/readback overhead.
- This test does not prove that Noema 2B/4B can run on the same phone. iOS model-memory limits remain important.
- The static site fetches model weights; inference text does not go to an AI server from this app.

## Next milestones toward a real generative model

1. Implement shape-generic tensor kernels: `matmul`, `RMSNorm`, `softmax`, quantized GGUF dequantization.
2. Add correct tokenizer integration and positional encoding (RoPE).
3. Add causal multi-head/grouped-query attention and KV cache.
4. Start with **a small validated autoregressive transformer** and known test vectors before attempting Noema.
5. Add quantization, performance profiling, streamed token decoding, prefill batching and memory-pressure recovery.
6. Validate inference correctness against a trusted reference implementation; test on real Safari/iOS GPUs.

This is an **experimental virtual-company technology demonstration**. It does not imply Noema affiliation or commercial production readiness.
