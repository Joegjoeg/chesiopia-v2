import sys
with open(r'd:\Chesiopia v2\client\board_clean.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()
    line = lines[1260]  # 0-indexed = line 1261
    print('LINE 1261 length:', len(line))
    # Print in chunks of 500
    for i in range(0, len(line), 500):
        chunk = line[i:i+500]
        print(repr(chunk))
    print('---')
    # Also print lines 1262-1265
    for i in range(1261, min(1265, len(lines))):
        print(f'LINE {i+1}:', repr(lines[i]))
