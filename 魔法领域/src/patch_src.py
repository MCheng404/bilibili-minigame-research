import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'hmjs_00.js'
s = open(path, encoding='utf-8', errors='replace').read()

# 内层 IIFE 的结尾形如 ...}}();  后面跟换行和外层 wrapper 的 })
idx = s.rstrip().rfind('}();')
print('tail index', idx, 'of', len(s))
print('tail repr:', repr(s[idx:]))

INJ = '};try{globalThis.__hmg=g}catch(e){globalThis.__hmge=String(e)}();'
patched = s[:idx] + INJ + s[idx + 4:]
print()
print('patched tail:', repr(patched[-260:]))
open('_patched_test.js', 'w', encoding='utf-8', newline='').write(patched)
print('written _patched_test.js', len(patched))

# 看看 g 是不是内层作用域的顶层变量：统计 g 出现前是否有声明
for pat in [r'[,;\s]g\s*=\s*(?:new|Laya|gg|\w+\s*\()', r'class\s+g\b', r'(?:let|var|const)\s+g\b[^=]']:
    hits = [(m.start(), s[max(0, m.start() - 60):m.end() + 60].replace('\n', ' ')) for m in re.finditer(pat, s)]
    print()
    print('### pattern', pat, 'hits', len(hits))
    for h in hits[:8]:
        print('  ', h[0], '|', h[1])
