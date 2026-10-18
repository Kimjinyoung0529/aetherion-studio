"""Unit tests for AETHERION's GGUF sharding orchestrator.

These tests verify Python header handling, splitting flow and manifests by
mocking llama-gguf-split. They do NOT prove the upstream llama.cpp binary works.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE_PATH=Path(__file__).resolve().parent/"gguf_auto_split.py"
spec=importlib.util.spec_from_file_location("gguf_auto_split",MODULE_PATH)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class GgufAutoSplitTest(unittest.TestCase):
    def test_valid_header(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"sample.gguf"
            path.write_bytes(b"GGUF"+struct.pack("<IQQ",3,8,2)+b"\x00"*256)
            info=module.get_header(path)
            self.assertEqual(info["version"],3)
            self.assertEqual(info["tensor_count"],8)
            self.assertEqual(info["metadata_items"],2)
            self.assertEqual(module.sha256(path),hashlib.sha256(path.read_bytes()).hexdigest())

    def test_reject_bad_gguf(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"broken.gguf"
            for data in (b"NOTGGUF",b"GGUF"+struct.pack("<IQQ",5,8,0),b"GGUF"+struct.pack("<IQQ",3,0,0)):
                path.write_bytes(data)
                with self.assertRaises(ValueError):
                    module.get_header(path)

    def test_mocked_split_and_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            model=root/"source.gguf"
            model.write_bytes(b"GGUF"+struct.pack("<IQQ",3,8,0)+b"x"*180)
            output=root/"out"
            binary=root/"fake-tool"
            binary.write_bytes(b"test")
            def fake_tool(command,check):
                self.assertEqual(command[1],"--split")
                prefix=Path(command[-1])
                prefix.parent.mkdir(parents=True,exist_ok=True)
                for i in (1,2):
                    part=prefix.parent/(prefix.name+"-"+str(i).zfill(5)+"-of-00002.gguf")
                    part.write_bytes(b"GGUF"+bytes([i])*120)
                class Completed:
                    returncode=0
                return Completed()
            argv=["gguf_auto_split.py","--input",str(model),
                  "--binary",str(binary),"--out-dir",str(output)]
            with patch.object(sys,"argv",argv),patch.object(module.subprocess,"run",side_effect=fake_tool):
                with contextlib.redirect_stdout(io.StringIO()):
                    module.main()
            shard_files=sorted(output.glob("source-*-of-*.gguf"))
            self.assertEqual(len(shard_files),2)
            manifest=json.loads((output/"source-manifest.json").read_text())
            self.assertEqual(manifest["shard_count"],2)
            self.assertEqual(manifest["strategy"],"two-by-tensors")
            self.assertEqual(manifest["source_sha256"],hashlib.sha256(model.read_bytes()).hexdigest())
            self.assertEqual(len(manifest["shards"]),2)
            self.assertEqual(manifest["shards"][0]["sha256"],hashlib.sha256(shard_files[0].read_bytes()).hexdigest())

if __name__=="__main__":
    unittest.main()
