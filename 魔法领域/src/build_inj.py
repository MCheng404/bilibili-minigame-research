import re
import sys

src = open('nativelib/inj.js', encoding='utf-8').read()
# 去掉行注释块（文件头注释），保留其余内容
lines = src.split('\n')

out = []
for ln in lines:
    esc = ln.replace('\\', '\\\\').replace('"', '\\"')
    out.append('"' + esc + '\\n"')

body = '\n'.join(out)
hdr = '/* 自动生成，请勿直接修改 —— 源文件 nativelib/inj.js */\n'
hdr += 'static const char INJ_JS[] =\n'
hdr += body + ';\n'

path = 'nativelib/inj_gen.h'
old = open(path, encoding='utf-8').read() if __import__('os').path.exists(path) else ''
if old != hdr:
    open(path, 'w', encoding='utf-8', newline='\n').write(hdr)
    print('written', path, len(hdr), 'bytes; js', len(src))
else:
    print('unchanged')
