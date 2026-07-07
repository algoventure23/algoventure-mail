# Mail Relay

极简 SMTP 邮件中继。跑在 Hostinger VPS 上，接收 HTTP 请求，用 env 里配置的 SMTP 账号发邮件。给无法直连 587 端口的服务器（如 DigitalOcean）用。

只有一个功能：`POST /send` → 发成功返回成功，失败返回失败和原因。

## 部署（Hostinger VPS）

```bash
# 1. 上传代码到 VPS（scp / git clone 均可），进入目录后：
npm install

# 2. 配置环境变量
cp .env.example .env
nano .env   # 填入 SMTP 账号和 API_KEY（openssl rand -hex 32 生成）

# 3. 用 pm2 常驻运行
npm install -g pm2
pm2 start server.js --name mail-relay
pm2 save
pm2 startup   # 按提示执行输出的命令，开机自启
```

确认防火墙放行端口（默认 3000）：`ufw allow 3000/tcp`。
建议之后用 Nginx 反代 + HTTPS，避免 API key 明文传输。

## API

### `POST /send`

Header：`X-API-Key: <你的 API_KEY>`，`Content-Type: application/json`

| 字段 | 必填 | 说明 |
|---|---|---|
| `to` | 是 | 收件人，字符串或数组 |
| `subject` | 是 | 主题 |
| `text` | text/html 二选一 | 纯文本正文 |
| `html` | text/html 二选一 | HTML 正文 |
| `cc` / `bcc` / `replyTo` | 否 | 抄送 / 密送 / 回复地址 |
| `attachments` | 否 | `[{ "filename": "a.pdf", "content": "<base64>", "encoding": "base64" }]` |

成功响应：

```json
{ "success": true, "messageId": "<...>", "accepted": ["a@b.com"], "rejected": [] }
```

失败响应（HTTP 401 / 400 / 502）：

```json
{ "success": false, "error": "原因", "code": "EAUTH", "smtpResponse": "535 ..." }
```

### `GET /health`

无需 API key，返回 `{ "status": "ok" }`，用于探活。

## 从 DigitalOcean 调用示例

```bash
curl -X POST http://<hostinger-vps-ip>:3000/send \
  -H "X-API-Key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"to":"someone@example.com","subject":"Test","text":"Hello from relay"}'
```

Node.js:

```js
const res = await fetch('http://<hostinger-vps-ip>:3000/send', {
  method: 'POST',
  headers: { 'X-API-Key': process.env.RELAY_API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: 'someone@example.com', subject: 'Test', text: 'Hello' }),
});
const result = await res.json(); // { success: true/false, ... }
```

PHP:

```php
$ch = curl_init('http://<hostinger-vps-ip>:3000/send');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['X-API-Key: ' . $apiKey, 'Content-Type: application/json'],
    CURLOPT_POSTFIELDS => json_encode(['to' => 'someone@example.com', 'subject' => 'Test', 'text' => 'Hello']),
]);
$result = json_decode(curl_exec($ch), true);
```
