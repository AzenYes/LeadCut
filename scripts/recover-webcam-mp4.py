"""Recover complete fragmented MP4 segments from a LeadCut webcam .mp4.partial file."""
import argparse
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile


def complete_prefix(source):
    end = 0
    size = os.fstat(source.fileno()).st_size
    while source.tell() + 8 <= size:
        start = source.tell()
        length, kind = struct.unpack(">I4s", source.read(8))
        header = 8
        if length == 1:
            extended = source.read(8)
            if len(extended) < 8:
                break
            length = struct.unpack(">Q", extended)[0]
            header = 16
        if length < header or start + length > size:
            break
        source.seek(start + length)
        if kind == b"mdat":
            end = source.tell()
    return end


def recover(source_path, output):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("ffmpeg is required on PATH")
    if output.exists():
        raise FileExistsError(output)
    with tempfile.TemporaryDirectory(dir=output.parent) as directory:
        raw = Path(directory) / "fragments.mp4"
        ready = Path(directory) / "recovered.mp4"
        with source_path.open("rb") as source, raw.open("xb") as dest:
            remaining = complete_prefix(source)
            if not remaining:
                raise ValueError("No complete MP4 media fragments")
            source.seek(0)
            while remaining:
                data = source.read(min(remaining, 4 * 1024 * 1024))
                if not data:
                    raise EOFError("Recording changed during recovery")
                dest.write(data)
                remaining -= len(data)
        subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-xerror", "-i", str(raw),
                        "-map", "0:v:0", "-c", "copy", str(ready)], check=True)
        subprocess.run([ffmpeg, "-nostdin", "-v", "error", "-xerror", "-i", str(ready),
                        "-map", "0:v:0", "-f", "null", "-"], check=True)
        with ready.open("rb") as validated, output.open("xb") as published:
            shutil.copyfileobj(validated, published, 4 * 1024 * 1024)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("partial", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    recover(args.partial, args.output)