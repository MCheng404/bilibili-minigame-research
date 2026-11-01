"""把 nativelib/common.js 重新内联进 nativelib/inj.js（幂等）。

**为什么需要这一步**：
common.js 最初是 patch_v16.py 一次性内联进 inj.js 的静态副本。
后来直接改 nativelib/common.js 就不会生效 —— 源码与产物漂移，
调试时极易被误导（我就在这上面绕了一圈）。

现在改为：每次构建都从源文件重新生成内联块，
内联块带内容指纹，指纹不变就跳过（有改动才重写）。

用法：
  python build_common.py          # 重新内联
  python build_common.py --check  # 只检查是否漂移，不改
"""

import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
NAT = os.path.join(ROOT, 'nativelib')

START = '    // ===== HM COMMON INLINE ====='
END = '    // ===== /HM COMMON INLINE ====='

common_path = os.path.join(NAT, 'common.js')
inj_path = os.path.join(NAT, 'inj.js')

common = open(common_path, encoding='utf-8').read().rstrip()
inj = open(inj_path, encoding='utf-8').read()

digest = hashlib.sha1(common.encode('utf-8')).hexdigest()[:12]

block = (
    START + '\n'
    + '    /* 本块由 build_common.py 自动生成，请改 nativelib/common.js */\n'
    + '    /* content-sha1: ' + digest + ' */\n'
    + common + '\n'
    + END + '\n'
)

check_only = '--check' in sys.argv

# ------------------------------------------------------- 定位旧块
a = inj.find(START)
b = inj.find(END)
if a >= 0 and b >= 0:
    b += len(END)
    # 连着后面的换行一起吃掉
    if inj[b:b + 1] == '\n':
        b += 1
    old = inj[a:b]
else:
    old = None

if old is not None and ('content-sha1: ' + digest) in old:
    print('common.js inlined block up-to-date (sha1=' + digest + ')')
    sys.exit(0)

if check_only:
    print('DRIFT: inj.js 里的 common.js 内联块与源文件不一致')
    print('  源文件 sha1 = ' + digest)
    sys.exit(1)

if old is not None:
    inj = inj[:a] + block + inj[b:]
    print('common.js inlined block refreshed (sha1=' + digest + ')')
else:
    # 首次插入：放在 Unity 内联块之后
    anchor = '    // ===== /HM UNITY INLINE =====\n'
    if anchor not in inj:
        print('WARN: 找不到 Unity 内联块锚点，尝试用版本锚点')
        anchor = '    G.__hmw12 = 1;\n'
    inj = inj.replace(anchor, anchor + block, 1)
    print('common.js inlined for the first time (sha1=' + digest + ')')

with open(inj_path, 'w', encoding='utf-8', newline='\n') as f:
    f.write(inj)

# 校验：块只能有一份
n = inj.count(START)
print('inj.js len', len(inj), '| COMMON 块份数:', n, 'OK' if n == 1 else 'DUPLICATED!')
