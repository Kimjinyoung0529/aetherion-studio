# AETHERION Universal Runtime v1.0

**Live:** https://hii.o-r.kr/runtime/  
**Source:** https://github.com/Kimjinyoung0529/aetherion-studio/tree/main/runtime

A first-party **local LLM model launcher, GPU configuration layer, performance profiler, and experimental WGSL kernel lab** for AETHERION.

## Supported and unsupported model formats

| Model asset | In-browser backend | Scope |
|---|---|---|
| GGUF, local file or ordered GGUF shards | Wllama 3.8.1 | Architectures / tensor encodings supported by **the embedded llama.cpp runtime** only |
| GGUF, CORS-enabled HTTPS / HF URL, including recognized shard suffix | Wllama 3.8.1 | Upstream compatibility and memory permitting |
| MLC-compiled prebuilt model IDs | MLC WebLLM 0.2.85 | **Only** the installed WebLLM catalog's model IDs |
| Plain safetensors, PyTorch checkpoints, arbitrary ONNX, all Hugging Face models | Not supported directly | Need preprocessing / model conversion or another native execution backend |
| PTQ1_0 / PQ2_0 ternary matvec | **Our own WGSL shaders** | Numerical / speed experiment only, **not** a complete LLM backend |

There is **no such thing as guaranteed universal local LLM compatibility**. Our Qwen3-0.6B GGUF quick preset uses a community 4-bit conversion from \`tensorblock/Qwen_Qwen3-0.6B-GGUF\` (approx. 484 MB). This is external model data, not our pretrained model. Qwen original license: Apache-2.0.

The WebGPU backend itself still depends on published Wllama / MLC inference runtimes. AETHERION's own first-party code manages profile selection, model source UX, device discovery, streaming, benchmark records, and a future-oriented WGSL quantized matrix-vector experiment.

## Performance architecture

- 3 GGUF load configurations, with mobile-aware requested GPU layer offload, batch size, microbatch, model context length, multithread-aware CPU threads, and parallel model-shard downloads.
- **GPU offload count is requested, not verified**. Wllama may reject or adapt it. Observe model runtime logs / actual performance; don't treat the requested number as confirmed.
- Loads only on user click, keeps an active model resident across chat questions, sets Wllama \`cache_prompt: true\`, and streams text.
- Benchmarks **two runs** with a fixed prompt and \`temperature:0\`, measuring time to first streamed text and rate for the subsequent stream.
- If the library exposes exact \`completion_tokens\`, displays tokens/s; otherwise displays streaming **chunks/s**, not a falsely claimed token rate. Runs without first text or at least two chunks cannot produce meaningful decode rate.
- Compares speedups only when backend, model, device, prompt hash, output cap, and unit match. Results live only in memory until user downloads JSON.
- Changing GGUF load profile requires releasing and reloading model. The MLC profile cannot modify precompiled model kernels and **does not optimize MLC by itself**.

## First-party WGSL parallel reduction

The independently written \`native-kernel.js\` uses compressed PrismML PTQ1_0 and PQ2_0 matvec for:
1. **Serial GPU baseline**: one invocation processes each output row.
2. **Parallel candidate**: each output row is split across 32 GPU lanes; four rows form a 128-thread workgroup, and lane results reduce via shared workgroup memory/barriers.
3. Both results are compared against an independent CPU reference before any performance win is reported. Candidate benchmark runs 7 GPU dispatches after a warm-up and reports median JS submission + GPU-fence latency, **not** raw GPU kernel-only duration.

A lower median kernel-dispatch time **does not mean an LLM produces tokens that much faster**. These WGSL kernels are not yet wired into the general-purpose GGUF or MLC runtime. On some devices the serial kernel could be faster; this is explicitly displayed.

## Browser testing

Run without installing dependencies:

~~~sh
node runtime/test_runtime.mjs
node runtime/test_native.mjs
node --check runtime/tuner.js
node --check runtime/engine.js
node --check runtime/app.js
node --check runtime/native-kernel.js
~~~

The tests check source compatibility, CPU codec parity, mocked GGUF/MLC adapter flows, and UI controls. **CI does not execute an actual iPhone GPU shader or download a model.** To validate a speed increase, load the same model and run the benchmark on a supported GPU browser in two configurations.

## Priority upgrades beyond v1

1. Dedicated worker isolation for heavy model runtimes (while respecting browser origin / COOP+COEP restrictions).
2. Real GPU timestamp queries where supported and memory/OOM diagnostics.
3. Native optimized WGSL kernels fused into specific supported architectures, with reference-logit/token parity and a rollback path.
4. Quantization-aware, per-model + per-device autotuning **based on measured end-to-end throughput**, not generic promises.
5. Model registry with architecture/quantization compatibility validation and cache-aware shard manifests.

The existing /chat/, /agent/, /lab/ endpoints are kept intact and not silently migrated to a different inference backend.
