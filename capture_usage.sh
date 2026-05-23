#!/bin/bash
echo "=== cccswitch 代理运行状态 ==="
curl -s http://127.0.0.1:11435/health | python3 -m json.tool

echo ""
echo "=== 测试1: 代码生成 (thinking=on) ==="
curl -s -X POST http://127.0.0.1:11435/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"input":"用Python写一个二分查找函数，带中文注释","stream":false,"thinking":{"type":"enabled"}}' 2>&1 > /tmp/test1.json
python3 -c "
import json
with open('/tmp/test1.json') as f:
    r = json.load(f)
if r.get('error'):
    print('ERROR:', r['error']['message'][:200])
else:
    for o in r.get('output', []):
        if o['type'] == 'reasoning':
            print('--- REASONING ---')
            print(o['content'][0]['text'][:800])
        elif o['type'] == 'message':
            print('--- RESPONSE ---')
            print(o['content'][0]['text'][:1000])
    print('--- TOKENS ---')
    print(json.dumps(r.get('usage')))
"

echo ""
echo "=== 测试2: 复杂架构分析 ==="
curl -s -X POST http://127.0.0.1:11435/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"input":"分析微服务架构中分布式事务的处理方案，列举3种方案并比较优缺点","stream":false}' 2>&1 > /tmp/test2.json
python3 -c "
import json
with open('/tmp/test2.json') as f:
    r = json.load(f)
if not r.get('error'):
    for o in r.get('output', []):
        if o['type'] == 'message':
            print(o['content'][0]['text'][:800])
    print('TOKENS:', json.dumps(r.get('usage')))
else:
    print('ERROR:', r['error']['message'][:200])
"

echo ""
echo "=== 测试3: 工具调用 (function calling) ==="
curl -s -X POST http://127.0.0.1:11435/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"input":"告诉我北京和上海的天气","stream":false,
  "tools":[{"type":"function","name":"get_weather","description":"获取指定城市的天气","parameters":{"type":"object","properties":{"city":{"type":"string"}}}}]}' 2>&1 > /tmp/test3.json
python3 -c "
import json
with open('/tmp/test3.json') as f:
    r = json.load(f)
if not r.get('error'):
    for o in r.get('output', []):
        if o['type'] == 'function_call':
            print(f'Function call: {o[\"name\"]}({o[\"arguments\"]})')
        elif o['type'] == 'message':
            print('Message:', o['content'][0]['text'][:300])
    print('TOKENS:', json.dumps(r.get('usage')))
else:
    print('ERROR:', r['error']['message'][:200])
"
echo ""
echo "=== DONE ==="
