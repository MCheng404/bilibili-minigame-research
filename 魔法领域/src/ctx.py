import re
import sys

path = sys.argv[1] if len(sys.argv) > 1 else 'hmjs_00.js'
key = sys.argv[2] if len(sys.argv) > 2 else 'outDiamondNum'
span = int(sys.argv[3]) if len(sys.argv) > 3 else 260

s = open(path, encoding='utf-8', errors='replace').read()
print('file len', len(s), 'lines', s.count('\n') + 1)
print('---')
for i, m in enumerate(re.finditer(re.escape(key), s)):
    a = max(0, m.start() - span)
    b = min(len(s), m.end() + span)
    print('### hit', i, 'at', m.start())
    print(s[a:b].replace('\n', '\\n'))
    print()
    if i >= 40:
        print('... truncated')
        break
