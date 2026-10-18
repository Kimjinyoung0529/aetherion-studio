#!/usr/bin/env python3
"""Auto split a GGUF into two tensor-safe shards, with size-based fallback."""
import argparse
import hashlib
import json
import math
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

MB = 1_000_000
PATTERN = re.compile(r"-\d{5}-of-\d{5}\.gguf$")


def get_header(path):
    with path.open("rb") as handle:
        first = handle.read(24)
    if len(first) != 24 or first[:4] != b"GGUF":
        raise ValueError("Invalid GGUF header; do not binary-split non-GGUF files")
    version, count, kv_count = struct.unpack_from("<IQQ", first, 4)
    if version not in (2, 3) or count < 2 or count > 2_000_000:
        raise ValueError("Unsupported GGUF version or tensor count")
    return {"version": version, "tensor_count": count, "metadata_items": kv_count}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_split(binary, path, prefix, mode, limit, dry=False):
    command = [str(binary), "--split"]
    if dry:
        command.append("--dry-run")
    command += ["--split-max-tensors" if mode == "tensors" else "--split-max-size",
                str(limit) if mode == "tensors" else f"{limit}M", str(path), str(prefix)]
    print("Running:", " ".join(command), flush=True)
    subprocess.run(command, check=True)
    if dry:
        return []
    parts = sorted(p for p in prefix.parent.glob(prefix.name + "-*-of-*.gguf")
                   if PATTERN.search(p.name))
    if not parts:
        raise RuntimeError("No GGUF split files generated")
    count = len(parts)
    for n, part in enumerate(parts, 1):
        if not part.name.endswith(f"-{n:05d}-of-{count:05d}.gguf"):
            raise RuntimeError("Split GGUF sequence incomplete: " + part.name)
    return parts


def get_input(args, work):
    if args.input:
        path = Path(args.input).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        return path, None
    if not args.hf_file or Path(args.hf_file).is_absolute() or ".." in Path(args.hf_file).parts:
        raise ValueError("A safe --hf-file path is required with --hf-repo")
    download_dir = work / "download"
    download_dir.mkdir()
    cmd = ["hf", "download", args.hf_repo, args.hf_file, "--local-dir", str(download_dir)]
    subprocess.run(cmd, check=True)
    path = (download_dir / args.hf_file).resolve()
    if not path.is_file():
        raise FileNotFoundError(path)
    return path, {"repo": args.hf_repo, "file": args.hf_file}


def main():
    parser = argparse.ArgumentParser(description="AETHERION GGUF automatic two-shard splitter")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", help="local GGUF file")
    source.add_argument("--hf-repo", help="Hugging Face repo of existing GGUF")
    parser.add_argument("--hf-file", help="exact name of GGUF in HF repo")
    parser.add_argument("--binary", default="llama-gguf-split", help="path to llama-gguf-split")
    parser.add_argument("--out-dir", default="gguf-shards")
    parser.add_argument("--max-shard-mb", type=int, default=1800)
    parser.add_argument("--fallback-shard-mb", type=int, default=750)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.input and args.hf_file:
        parser.error("--hf-file is only valid with --hf-repo")
    if not 100 <= args.max_shard_mb <= 1900:
        parser.error("--max-shard-mb must be 100..1900")
    if not 100 <= args.fallback_shard_mb <= args.max_shard_mb:
        parser.error("--fallback-shard-mb must be between 100 and max-shard-mb")
    exe = shutil.which(args.binary) if "/" not in args.binary else args.binary
    if not exe or not Path(exe).is_file():
        parser.error("llama-gguf-split not found; build official llama.cpp tool")
    destination = Path(args.out_dir).expanduser().resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="aetherion-gguf-") as scratch:
        scratch = Path(scratch)
        path, origin = get_input(args, scratch)
        header = get_header(path)
        tensor_half = math.ceil(header["tensor_count"] / 2)
        prefix = scratch / "try-two" / path.stem
        prefix.parent.mkdir()
        print(f"Original: {path.name} / {path.stat().st_size / MB:.2f}MB / "
              f"{header['tensor_count']} tensors", flush=True)
        if args.dry_run:
            run_split(exe, path, prefix, "tensors", tensor_half, dry=True)
            print("Dry-run only; no output shards written")
            return
        files = run_split(exe, path, prefix, "tensors", tensor_half)
        method = "two-by-tensors"
        if len(files) != 2 or max(f.stat().st_size for f in files) > args.max_shard_mb * MB:
            print("Two-way split exceeds target; falling back to size-limited sharding", flush=True)
            prefix = scratch / "by-size" / path.stem
            prefix.parent.mkdir()
            files = run_split(exe, path, prefix, "size", args.fallback_shard_mb)
            method = "size-based-fallback"
        if max(f.stat().st_size for f in files) > args.max_shard_mb * MB:
            raise ValueError("A large tensor may prevent respecting maximum shard size")
        for f in files:
            if (destination / f.name).exists():
                raise FileExistsError("Output exists: " + f.name)
        manifest_name = path.stem + "-manifest.json"
        if (destination / manifest_name).exists():
            raise FileExistsError("Output exists: " + manifest_name)
        shards = []
        for f in files:
            target = destination / f.name
            shutil.move(str(f), str(target))
            shards.append({"name": target.name, "bytes": target.stat().st_size,
                           "sha256": sha256(target)})
        manifest = {"schema": "aetherion-gguf-split-v1", "date": datetime.now(timezone.utc).isoformat(),
                    "source": path.name, "source_bytes": path.stat().st_size,
                    "source_sha256": sha256(path), "huggingface": origin,
                    "gguf": header, "strategy": method, "shard_count": len(shards),
                    "shards": shards,
                    "warning": "Splitting does not reduce RAM or GPU memory requirements"}
        (destination / manifest_name).write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                                  encoding="utf-8")
        print("Split complete:", len(shards), "shards. First:", shards[0]["name"], flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as exc:
        print("ERROR:", exc, file=sys.stderr)
        sys.exit(1)