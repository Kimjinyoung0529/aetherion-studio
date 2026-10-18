# AETHERION Native Ternary / Direct WebGPU

## v0.1 experiment

A first-party ternary matrix-vector compute benchmark implemented in WGSL,
without Wllama, WebLLM, Transformers.js, ONNX or remote AI inference.

- Kernels support signed ternary {-1, 0, +1} and row-wise f32 scales.
- **2-bit mode:** 16 ternary values / u32. Exactly 2.0 bits per weight.
- **Dense mode:** 5 ternary values / byte, 20 values / u32. Exactly 1.6 bits per
  weight in the packed data (not the theoretical Shannon minimum log2(3)).
- The GPU shader decodes packed weights in the dot product. It does not allocate
  a full f32 dequantized weight matrix.
- Both encodings are verified to reproduce the source trits exactly. After the
  compute shader runs, ALL rows are compared against a CPU reference. The CPU
  work is validation only, not a silent fallback.
- User choices: 320, 640, 1280 square matrices; one compute pass, four repeat
  samples, median of GPU submission/readback elapsed times.
- Compression statistic compares packed weight bytes to FP16 weight bytes,
  excluding scales and runtime buffers. The full runtime memory reduction
  differs and context/KV caches are not measured.

## Limitations

**This is not the PrismML model format**, and it does NOT load PrismML GGUF files.
Their Bonsai 2 quantization formats PTQ1_0/PQ2_0 require correct block decoders,
group scales, Hadamard transform and their model-specific inference architecture
(Qwen3.5 hybrid layers, tokenizer, attention, KV caching, generation).
A functioning WGPU matrix kernel does not prove supported model weights can be
loaded or tokenized. WebGPU performance varies by device.

To integrate Bonsai 2, first implement and cross-check format decoding
against PrismML's official source, then add fused matmul and model architecture.
Do not copy or rename incompatible formats as though they were equivalent.

References:
- https://github.com/PrismML-Eng/Bonsai-demo/blob/main/MODEL-FORMATS.md
- https://huggingface.co/prism-ml/Ternary-Bonsai-2-2B-gguf

## Live

https://hii.o-r.kr/lab/ternary/
