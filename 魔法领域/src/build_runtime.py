"""构建注入脚本：把 inj.js 与三个 Unity 模块合成一份可 eval 的文件。

产物有两个用途：
  1. nativelib/hm_runtime.js —— 放到设备上供 native 层运行时加载
  2. nativelib/inj_gen.h     —— 编译进 .so 的兜底版本

Unity 三个模块（harvest.js / unity_ui.js / harvest_adapt.js）以
**字符串常量**的形式挂在 G.__hmModuleSrc 上，由 inj.js 里的分发器
在判定为 Unity 引擎时再 eval —— 这样 Laya 游戏不会白白解析一遍。
"""

import os
import json

ROOT = os.path.dirname(os.path.abspath(__file__))
NAT = os.path.join(ROOT, 'nativelib')

# ---------------------------------------------------------------- 读源文件
inj = open(os.path.join(NAT, 'inj.js'), encoding='utf-8').read()

MODULES = ['harvest.js', 'unity_ui.js', 'harvest_adapt.js']
srcs = {}
for m in MODULES:
    p = os.path.join(NAT, m)
    if not os.path.exists(p):
        raise SystemExit('缺少模块文件: ' + p)
    srcs[m] = open(p, encoding='utf-8').read()

# ------------------------------------------------- 生成 __hmModuleSrc 前置块
def js_str(s):
    """转成 JS 字符串字面量（用 JSON 转义，保证引号/换行都对）"""
    return json.dumps(s, ensure_ascii=False)

parts = []
parts.append(';(function(G){\n')
parts.append('  if (typeof G.__hmModuleSrc === "undefined") G.__hmModuleSrc = {};\n')
for m in MODULES:
    parts.append('  G.__hmModuleSrc[%s] = %s;\n' % (js_str(m), js_str(srcs[m])))
parts.append('})(typeof globalThis !== "undefined" ? globalThis : this);\n')
module_block = ''.join(parts)

# ---------------------------------------------------------------- 拼装
# 前置块放在最前面 —— inj.js 里的分发器要用到 __hmModuleSrc
runtime = module_block + inj

out_runtime = os.path.join(NAT, 'hm_runtime.js')
with open(out_runtime, 'w', encoding='utf-8', newline='\n') as f:
    f.write(runtime)

# ---------------------------------------------------------------- 生成 C 头
lines = runtime.split('\n')
out = []
for ln in lines:
    esc = ln.replace('\\', '\\\\').replace('"', '\\"')
    out.append('"' + esc + '\\n"')
body = '\n'.join(out)

hdr = '/* 自动生成，请勿直接修改 —— 源文件 nativelib/inj.js + Unity 模块 */\n'
hdr += 'static const char INJ_JS[] =\n'
hdr += body + ';\n'

path = os.path.join(NAT, 'inj_gen.h')
old = open(path, encoding='utf-8').read() if os.path.exists(path) else ''
if old != hdr:
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(hdr)
    print('written', path, len(hdr), 'bytes')
else:
    print('unchanged', path)

print('runtime:', out_runtime, len(runtime), 'bytes')
print('modules:', ', '.join('%s(%d)' % (m, len(srcs[m])) for m in MODULES))
