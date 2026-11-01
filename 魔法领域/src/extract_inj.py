import re

s = open('nativelib/hmshim.c', encoding='utf-8').read()
i = s.index('static const char INJ_JS[] =')
j = s.index('\n\n', i)
body = s[i:j]

parts = re.findall(r'"([^"]*)"', body, re.S)
js = ''.join(parts)
open('_inj_check.js', 'w', encoding='utf-8', newline='').write(js)
print('lines in c:', body.count('\n') + 1)
print('parts:', len(parts), 'len:', len(js))
