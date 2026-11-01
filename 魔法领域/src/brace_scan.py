s = open('_inj_check.js', encoding='utf-8').read()
d = 0
q = None
i = 0
n = len(s)
while i < n:
    c = s[i]
    if q:
        if c == '\\':
            i += 2
            continue
        if c == q:
            q = None
    else:
        if c in ('"', "'"):
            q = c
        elif c == '{':
            d += 1
        elif c == '}':
            d -= 1
            if d < 0:
                print('NEG depth at', i)
                print(repr(s[max(0, i - 120):i + 40]))
                break
    i += 1
print('end depth', d, 'quote open', q)

# 打印所有 "catch" 前后 60 字符，看第几个不是紧跟 }
import re
for m in re.finditer(r'catch', s):
    pre = s[max(0, m.start() - 24):m.start()]
    print(m.start(), '|', repr(pre))
