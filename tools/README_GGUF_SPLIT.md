# AETHERION GGUF 자동 분할기

`gguf_auto_split.py`는 **모델 텐서 및 GGUF 메타데이터를 보존**하며 모델을 분할합니다. 단순 바이트 분할이 아닙니다. 실제 분할 연산은 공식 [llama.cpp](https://github.com/ggml-org/llama.cpp)의 `llama-gguf-split` 실행 파일에 맡깁니다.

## 동작 방식

1. GGUF 헤더를 직접 읽어 텐서 수를 검사합니다.
2. 텐서를 반씩 나눠 **가능하면 정확히 2개**의 GGUF 파일을 만듭니다.
3. 파일 하나가 1,800MB(기본값)를 넘으면 크기 제한에 맞춰 **더 많은 파일**로 다시 분할합니다.
4. 파일명·해시·용량·원본 정보가 포함된 JSON manifest를 함께 만듭니다.

> 중요: 두 파일로 나눴다고 AI 추론에 필요한 전체 RAM/VRAM이 절반으로 줄지는 않습니다. 모델 추론 엔진의 지원도 별개입니다. 2GB 단일 파일 제한을 피하려는 포장 전략입니다.

## 직접 실행

최신 [llama.cpp](https://github.com/ggml-org/llama.cpp)의 `llama-gguf-split`을 먼저 준비하세요.

```bash
python3 tools/gguf_auto_split.py \
  --input ./model-Q4_K_M.gguf \
  --binary ./llama.cpp/build/bin/llama-gguf-split \
  --out-dir ./gguf-shards
```

Hugging Face에 이미 존재하는 GGUF를 자동 다운로드해서 분할하려면 `pip install huggingface_hub` 후:

```bash
python3 tools/gguf_auto_split.py \
  --hf-repo LiquidAI/LFM2.5-2.6B-GGUF \
  --hf-file LFM2.5-2.6B-Q4_K_M.gguf \
  --binary ./llama.cpp/build/bin/llama-gguf-split \
  --out-dir ./gguf-shards
```

`--dry-run`은 텐서 기준 계획만 검토하고 실제 파일은 생성하지 않습니다.

### GitHub에서 자동 실행

**Actions → AETHERION GGUF Auto Split → Run workflow**에서 공개 GGUF 저장소와 정확한 파일명을 입력하세요. 모든 실행은 수동입니다.

- `artifact`: GitHub Actions 결과물로 내려받기. 큰 모델은 GitHub 저장 공간 제한 때문에 실패할 수 있습니다.
- `huggingface`: 내 Hugging Face 모델 저장소로 업로드. 미리 저장소를 만들고 GitHub Repository Settings → Secrets and variables → Actions에서 `HF_TOKEN`을 추가해야 합니다. **토큰을 채팅에 보내지 마세요.** 라이선스상 재배포 가능한 모델만 게시해야 합니다.

모델 호스팅은 GitHub Pages가 아닌 Hugging Face나 별도 CDN을 쓰는 것을 추천합니다. 분할 파일을 로드할 때는 공식 Wllama의 첫 shard URL 자동 탐색을 활용할 수 있지만, 우리 자체 WebGPU 코어에서는 GGUF 텐서 파서·토크나이저·아키텍처별 연산이 추가로 필요합니다.

[분할기 공식 근거](https://github.com/ggml-org/llama.cpp/tree/master/tools/gguf-split) · [Wllama split 안내](https://github.com/ngxson/wllama)

**PrismML Bonsai 참고:** 기본 `official` 소스는 Q2_0처럼 메인라인 llama.cpp가 이해하는 형식에 사용하고, Prism 전용 **PTQ1_0·PQ2_0** 파일에는 Actions의 **`llama_source: prism`** 옵션을 선택해야 합니다. 분할이 성공해도 브라우저의 우리 자체 Bonsai 2B 전체 추론이 구현된 것은 아닙니다.
