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

## WebGPU v2.1: Native competitive kernels + reusable inference session

The AETHERION in-browser WebGPU research lane is now significantly more than a single serial/parallel comparison:

- Native WGSL baseline plus **six candidates**: 8-, 16-, 32-, 64-lane parallel reductions and 16×8 / 32×8 row-tiling.
- The autotuner compiles **each candidate** for the current GPU (subject to workgroup limits), runs a **full-row CPU numerical parity comparison** on its deterministic fixture, and rejects bad or unsupported candidates before benchmarking.
- For valid candidates, it warms up the kernel and measures 7 submissions with \`queue.onSubmittedWorkDone()\`; it selects the fastest candidate **only if at least 8% faster than serial and with median absolute jitter ≤45%**. Otherwise serial remains the chosen implementation.
- **The new \`AetherionPackedSession\` executor** (\`native-session.js\`) keeps PTQ/PQ quantized weights, activation scratch, dispatch pipeline and output readback buffers **resident on the same GPU across repeated calls**. It validates its very first output against a CPU codec/reference row set, and **falls back to serial** if a chosen parallel candidate is wrong.
- For model-like tensor dimensions beyond 800,000 scalar entries it validates **nine representative rows**, not every row. The UI explicitly labels this as sampled parity. This is not proof of an entire trained model's logits.
- When WebGPU is unavailable, **GGUF can run via Wllama CPU WebAssembly** by explicitly setting GPU layers to zero; MLC still requires WebGPU. CPU and GPU measurements are separated by device key.

**The accelerated native matvec session is not yet connected to Qwen3-0.6B's Q4 weights or the general GGUF/MLC LLM decoder**. Therefore a kernel speedup is *not* evidence of an end-to-end LLM token/s improvement. iPhone Safari still requires user-device validation.

Run these additional tests:

~~~sh
node runtime/test_autotune.mjs
node runtime/test_session.mjs
~~~

The latter uses a fake GPU to intentionally corrupt parallel output, forcing serial rollback and confirming buffers are allocated once, reused and destroyed. It is **not a substitute for real WebGPU numerical validation**.

## Release gates / maximum engineering target

1. **Correctness is mandatory:** all supported block type codecs pass CPU reference checks, every GPU kernel is validated with the same input as its baseline, and corrupted/unstable candidates never enter production.
2. **Speed must be measured, not advertised:** baseline and candidate must run on the *same* hardware. At least 8% measured native-kernel throughput improvement is required to adopt a candidate; otherwise retain serial. The long-term ambition is meaningful **end-to-end** reduction in per-token latency, separately evaluated and never guaranteed.
3. **Broad compatibility in stages:** GGUF architectures/quant formats supported by Wllama; precompiled MLC models supported by WebLLM; future native kernels only after model-specific parity. "All local LLMs" is not a meaningful supported-architecture claim.
4. **Resource safety:** bounded single GPU buffers, try CPU GGUF at GPU-layer=0, dispose on failure/explicit unload; quantify actual mobile memory/OOM behavior before defaulting to more aggressive offload.
5. **Full-site readiness:** \`python3 tools/site_audit.py\` verifies all 10 HTML pages' internal links and common Korean identity; \`tools/site_browser_smoke.cjs\` performs actual headless Chrome checks in **390px and 1280px viewports**, checking mobile drawer, overflow, JavaScript exceptions and static resource 404s, and saves reference screenshots.

**What would be removed/reverted?** Any new GPU variant that fails numerical parity, GPU feature limits, reproducibility, or the stated performance threshold is automatically eliminated from the selected-path report. The underlying serial baseline remains available as rollback.

## Priority upgrades beyond v1

1. Dedicated worker isolation for heavy model runtimes (while respecting browser origin / COOP+COEP restrictions).
2. Real GPU timestamp queries where supported and memory/OOM diagnostics.
3. Native optimized WGSL kernels fused into specific supported architectures, with reference-logit/token parity and a rollback path.
4. Quantization-aware, per-model + per-device autotuning **based on measured end-to-end throughput**, not generic promises.
5. Model registry with architecture/quantization compatibility validation and cache-aware shard manifests.

The existing /chat/, /agent/, /lab/ endpoints are kept intact and not silently migrated to a different inference backend.
