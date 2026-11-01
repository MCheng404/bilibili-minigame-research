#!/usr/bin/env python3
"""把 hmzygisk/ 打包成可被 KernelSU / Magisk 安装的模块 zip。

注意 module.prop 必须在 zip 根目录，不能多一层 hmzygisk/。
"""
import os
import sys
import zipfile

SRC = "hmzygisk"
OUT = "hmzygisk-v1.0.zip"


def main() -> int:
    if not os.path.isdir(SRC):
        print(f"missing {SRC}/", file=sys.stderr)
        return 1
    if not os.path.isfile(os.path.join(SRC, "module.prop")):
        print("missing module.prop", file=sys.stderr)
        return 1

    so = os.path.join(SRC, "zygisk", "arm64-v8a.so")
    if not os.path.isfile(so):
        print(f"missing {so}", file=sys.stderr)
        return 1

    if os.path.exists(OUT):
        os.remove(OUT)

    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(SRC):
            for f in sorted(files):
                p = os.path.join(root, f)
                # 相对 SRC，去掉顶层目录
                z.write(p, os.path.relpath(p, SRC))

    with zipfile.ZipFile(OUT) as z:
        print("--- 包内结构 ---")
        for n in z.namelist():
            print(" ", n, z.getinfo(n).file_size)
    print("zip size", os.path.getsize(OUT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
