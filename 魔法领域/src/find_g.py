import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'hmjs_00.js'
s = open(path, encoding='utf-8', errors='replace').read()

print('=== 疑似 g 的定义 ===')
pats = [
    r'(?:^|[;,{}(\s])g\s*=\s*new\s',
    r'let\s+g\s*=',
    r'var\s+g\s*=',
    r'const\s+g\s*=',
    r'(?:^|[;,{}(\s])g\s*=\s*\{',
]
for p in pats:
    for m in re.finditer(p, s):
        a = max(0, m.start() - 120)
        b = min(len(s), m.end() + 160)
        print('---', p, 'at', m.start())
        print(s[a:b].replace('\n', '\\n'))
print()
print('=== PlayerInfo_save 定义 ===')
for m in list(re.finditer(r'PlayerInfo_save', s))[:6]:
    a = max(0, m.start() - 160)
    b = min(len(s), m.end() + 200)
    print('--- at', m.start())
    print(s[a:b].replace('\n', '\\n'))
print()
print('=== 内层 IIFE 结尾附近 ===')
idx = s.rstrip().rfind('}();')
print('last }();  at', idx, 'total', len(s))
print(repr(s[idx - 200:]))
