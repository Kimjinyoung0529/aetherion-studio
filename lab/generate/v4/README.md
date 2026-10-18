# AETHERION Native Generator 0.4 (experimental)

**Live beta:** https://hii.o-r.kr/lab/generate/v4/  
**Stable older experiment:** https://hii.o-r.kr/lab/generate/

A locally trained **one-layer, one-head autoregressive Korean character Transformer**, executed with handwritten WebGPU WGSL code (not Wllama, WebLLM, Transformers.js, hosted inference, PrismML, or Noema).

## What changed since 0.3

| Attribute | 0.3 | 0.4 |
|---|---:|---:|
| Authored example Q&A pairs | 24 | 94 |
| Training utterances including question rephrasings | 24 (without variation) | 376 |
| Character vocabulary | 202 | 376 |
| Embedding width | 16 | 32 |
| Feed-forward width | 32 | 64 |
| Context window | 48 | 96 |
| Q8 weights | 6,298 bytes | 23,768 bytes |
| Training steps | 3,500 original | 4,700 in three phases |

A 202-character model is preserved in `../`. The new checkpoint is served from `model.json` in this folder and is **not** automatically loaded in the main Noema Chat.

## Files

- `model.json` — new Q8 checkpoint trained in the available CPU environment
- `core.wgsl` — handwritten causal Transformer forward pass (32D, FFN64, 376 logits)
- `engine.js` — WebGPU inference and independent quantized CPU reference
- `app.js` — mobile-friendly local streaming generation and parity diagnostics
- `corpus.tsv` — 94 hand-authored Korean training question/answer pairs
- `train.py` — offline three-phase PyTorch+NumPy trainer
- `test_generator.mjs` — CPU reference, tensor layout, and nine exact text regression tests

## Regression check

```sh
node lab/generate/v4/test_generator.mjs
node --check lab/generate/v4/engine.js
node --check lab/generate/v4/app.js
```

Browser WebGPU shader compilation and CPU/GPU numerical parity require a real WebGPU device, and **have not been verified on the user's iPhone**. An automatic CI pass means only the quantized CPU model and JavaScript source passed. The browser's startup self-test checks three prompt logits against the CPU reference before enabling generation, and does not silently substitute CPU inference if WebGPU fails.

## Quality caveat — essential

This is still a **toy generative model trained on a tiny authored corpus**, not a general-purpose assistant. It can reproduce some trained examples, but sometimes generates malformed Korean or spurious claims. For example, the prompt `인공지능이 뭐야` yielded incorrect garbled text in the regression sample, even after training. The nine green regression examples evaluate only memorized/in-domain requests; they **do not** establish broad generalization or factual accuracy.

Default temperature is **0.0** (greedy decoding) to make results reproducible; changing temperature can produce more varied but often worse outputs. The GPU processes one token per pass without a KV cache, which is not efficient for larger language models.

## Future priorities

- Evaluate against **held-out Korean questions**, not merely training examples.
- Improve tokenizer and add more varied high-quality data.
- Replace the 1-layer demo with validated multi-layer self-attention and KV cache.
- Continue the separate PrismML Bonsai core integration, which currently lacks full model-graph/tokenizer support.

