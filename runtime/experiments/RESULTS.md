# AETHERION GPU Kernel Tournament — measured 2026-10-18

Six independent **WGSL** strategies were implemented and executed via Chromium WebGPU on **Google SwiftShader (CPU-backed software GPU)**, using independently generated PTQ1_0/PQ2_0 CPU reference tensors. This was a real WGSL execution and GPU completion measurement, **not Apple Metal, not iPhone GPU, and not full LLM tokens/sec**. These results must NOT be presented as a guaranteed physical-GPU or LLM speedup.

**Evidence:** [Measured six-way tournament](https://github.com/Kimjinyoung0529/aetherion-studio/actions/runs/39135616288) and [independent repeat](https://github.com/Kimjinyoung0529/aetherion-studio/actions/runs/39135610130).

## Independent methods

- Scalar: original row-per-invocation packed decode
- Cooperative lane32: 32-lane shared-memory synchronized reduction
- Packed-byte lanes: decode several base-3 or 2-bit weights per byte, then cross-thread reduction
- Packed-row: decode entire bytes in a row-per-invocation loop **without barriers**
- Split-K: partial products of distinct 128-value blocks, then separate GPU reduction dispatch
- Predecode: one-time unpack to a dense FP32 GPU matrix, then dense matvec; costs large extra memory

## Results (ms per batched matrix-vector dispatch, lower is better)

| Matrix / format | Scalar | Lane32 | Packed lanes | **Packed Row** | Split-K | Predecode | Compressed speedup |
|---|---:|---:|---:|---:|---:|---:|---:|
| 128×256 PQ2_0 | 0.5600 | 2.0500 | 2.0400 | **0.3400** | 0.5600 | 0.3400 | **1.65×** |
| 128×256 PTQ1_0 | 0.7800 | 2.2600 | 1.7200 | **0.2300** | 0.6500 | 0.2300 | **3.39×** |
| 256×512 PQ2_0 | 1.6125 | 4.9875 | 3.7000 | **0.8125** | 1.8875 | 0.6875 | **1.98×** |
| 256×512 PTQ1_0 | 1.7625 | 5.2500 | 3.7375 | **0.8250** | 2.0750 | 0.7000 | **2.14×** |

All six methods passed numerical comparison against the CPU reference for all four matrix/format settings. Maximum observed absolute discrepancy for packed variants was about 1.53e-5 / 3.43e-5. CPU-reference and GPU shader execution are verified for these fixtures only.

Another independent tournament run selected Packed Row in the same four settings and observed 2.23× / 2.07× / 3.86× / 2.79×, showing run-to-run variability. Measurements use 8–10 consecutive dispatches per GPU submission, 3 samples, queue-completion synchronization; they are not timestamp-query-only GPU kernel nanoseconds.

## Decision

**Best compact kernel on tested SwiftShader: Packed Row.** Retain the original quantized 1.75- or 2.125-bit memory layout. Use it as an additional candidate in AETHERION device-specific AutoTune v2, not an unconditional replacement for other GPU vendors. The software-GPU winner may lose on physical Apple/NVIDIA/AMD hardware.

The dense predecode variant is faster for some tested shapes, but expands packed weights into 32-bit floats (~18.3× memory for PTQ1 or ~15.1× for PQ2), which is unsuitable for large mobile model weights without further design changes. Split-K and cooperative reductions remain device-dependent candidates.

The optimization is connected to our native packed-matrix session, **not** the generic Wllama/MLC runtime or complete Qwen3/Bonsai chat. Full real-model logits, memory limits, mobile GPU benchmarks and tokens/second comparisons remain open.

## Reproduce

- Source: https://github.com/Kimjinyoung0529/aetherion-studio/tree/main/runtime/experiments
- Web UI: https://hii.o-r.kr/runtime/experiments/
- CPU regression: run node runtime/experiments/test_strategies.mjs
- Browser CI: GitHub Actions workflow Kernel Tournament, archived JSON results

Reference methodology: [WebGPU timing caveats](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html) and [NVIDIA performance diagnostics](https://github.com/NVIDIA/elements/blob/main/.agents/skills/guidance-webgpu-performance/references/performance-diagnostics.md).

**No claim that our full local LLM became 1.65–3.39× faster.** This is a measured software-adapter microkernel speedup only.
