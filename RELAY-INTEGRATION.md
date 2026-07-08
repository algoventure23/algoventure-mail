# Mail Relay 接入说明（给 DigitalOcean 端）

> 这份文档给负责 DigitalOcean 服务器上应用的开发者/AI。
> 按此文档把应用的邮件发送改为调用 HTTP relay，**不要再尝试直连 SMTP**。

## 背景

- DigitalOcean 服务器出站 587 端口被封，无法直连 SMTP 发邮件。
- 解决方案：另一台服务器上已部署好一个 **HTTP → SMTP relay**，它接收 HTTP 请求，用 Titan Email 的 SMTP 账号把邮件发出去。
- relay 已上线、已通过 HTTPS + Postman 实测，**你不需要部署或修改 relay 本身**。你的任务只有一个：把应用里所有发邮件的地方改成调用这个 relay 的 API。

## 你要做的事

1. 在应用的环境变量里加入下面两个配置（值由用户提供，不要写死在代码里）：

   ```ini
   MAIL_RELAY_URL=https://mail.algo-venture.com/send
   MAIL_RELAY_API_KEY=5b5efd1e133f475d715d2d0c02f2c1bf48563bee46e7b0b4ad895123a7237f07
   ```

2. 找到应用中所有发送邮件的代码（SMTP 客户端、PHPMailer、nodemailer、Laravel Mail、`mail()` 等），改为向 `MAIL_RELAY_URL` 发 HTTP POST 请求（规格见下文）。

3. 邮件模板照旧在本地渲染 —— relay 不管模板，把渲染完成的 HTML 字符串放进请求的 `html` 字段即可。

4. 按 relay 的响应处理成功/失败（结构见下文），失败时把 `error` 记入日志。

## API 规格

### 发送邮件

```
POST {MAIL_RELAY_URL}
```

**Headers（两个都必须）：**

```
X-API-Key: {MAIL_RELAY_API_KEY}
Content-Type: application/json
```

**Body（JSON）：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `smtpUsername` | string | **是** | 发信邮箱账号（完整邮箱地址），见下方「多邮箱」说明 |
| `smtpPassword` | string | **是** | 该邮箱的密码 / 授权码 |
| `to` | string 或 string[] | 是 | 收件人，多个可用数组或逗号分隔字符串 |
| `subject` | string | 是 | 邮件主题 |
| `html` | string | html/text 至少一个 | HTML 正文（渲染好的完整 HTML） |
| `text` | string | html/text 至少一个 | 纯文本正文 |
| `cc` | string 或 string[] | 否 | 抄送 |
| `bcc` | string 或 string[] | 否 | 密送 |
| `replyTo` | string | 否 | 回复地址 |
| `fromEmail` | string | 否 | 显示的发件邮箱，不传则用 `smtpUsername` |
| `fromName` | string | 否 | 显示的发件人名称 |
| `attachments` | array | 否 | `[{ "filename": "a.pdf", "content": "<base64字符串>", "encoding": "base64" }]` |

> **重大变更**：relay 端 `.env` 里不再固定配置发信邮箱账号密码。现在支持多个邮箱账号，**每次请求都必须带上 `smtpUsername` / `smtpPassword`** 来指定用哪个邮箱发送。不再传就会返回 400。

**请求示例：**

```json
{
  "smtpUsername": "noreply@yourdomain.com",
  "smtpPassword": "该邮箱的密码或授权码",
  "to": "customer@example.com",
  "subject": "Welcome",
  "html": "<h1>Hello</h1><p>本地渲染好的模板放这里</p>"
}
```

### 多邮箱账号怎么接

- 在你的应用（DigitalOcean 端）环境变量里，按用途分别存每个邮箱的账号密码，例如：
  ```ini
  MAIL_NOREPLY_USERNAME=noreply@yourdomain.com
  MAIL_NOREPLY_PASSWORD=xxx
  MAIL_SUPPORT_USERNAME=support@yourdomain.com
  MAIL_SUPPORT_PASSWORD=xxx
  ```
- 调用 `sendMail()` 时，根据场景（注册通知用 noreply、客服回复用 support 等）选择对应的账号密码传入 `smtpUsername` / `smtpPassword`。
- 所有邮箱共用同一个 `MAIL_RELAY_URL` 和 `MAIL_RELAY_API_KEY`，只是请求体里的 `smtpUsername`/`smtpPassword` 不同。
- **密码只能放环境变量，绝不能写死在代码或提交进 git**，处理方式和 `MAIL_RELAY_API_KEY` 一样。

### 响应

**成功 — HTTP 200：**

```json
{
  "success": true,
  "messageId": "<xxx@domain>",
  "accepted": ["customer@example.com"],
  "rejected": []
}
```

**失败：**

| HTTP 状态 | 含义 | 响应示例 |
|---|---|---|
| 401 | API key 缺失或错误 | `{"success":false,"error":"Invalid or missing API key"}` |
| 400 | 缺少必填字段 | `{"success":false,"error":"Field \"subject\" is required"}` |
| 502 | SMTP 发送失败 | `{"success":false,"error":"...","code":"EAUTH","smtpResponse":"535 ..."}` |

判断标准：**以 JSON 里的 `success` 字段为准**。`success: false` 时 `error` 是人类可读的失败原因，`smtpResponse`（如果有）是 SMTP 服务器的原始回复。

### 探活

```
GET https://mail.algo-venture.com/health
```

无需 API key，返回 `{"status":"ok"}`。可用于部署后的连通性检查或监控。

## 调用示例

### Node.js

```js
// account: 'noreply' | 'support' | ... 对应你在 env 里存的那组 smtpUsername/smtpPassword
async function sendMail({ account, to, subject, html, text }) {
  const res = await fetch(process.env.MAIL_RELAY_URL, {
    method: 'POST',
    headers: {
      'X-API-Key': process.env.MAIL_RELAY_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      smtpUsername: process.env[`MAIL_${account.toUpperCase()}_USERNAME`],
      smtpPassword: process.env[`MAIL_${account.toUpperCase()}_PASSWORD`],
      to, subject, html, text,
    }),
  });
  const result = await res.json();
  if (!result.success) {
    throw new Error(`Mail relay failed: ${result.error}`);
  }
  return result; // { success, messageId, accepted, rejected }
}
```

### PHP

```php
function sendMail(string $account, string $to, string $subject, string $html): array
{
    $accountKey = strtoupper($account);
    $ch = curl_init(getenv('MAIL_RELAY_URL'));
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_HTTPHEADER => [
            'X-API-Key: ' . getenv('MAIL_RELAY_API_KEY'),
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'smtpUsername' => getenv("MAIL_{$accountKey}_USERNAME"),
            'smtpPassword' => getenv("MAIL_{$accountKey}_PASSWORD"),
            'to' => $to,
            'subject' => $subject,
            'html' => $html,
        ]),
    ]);
    $response = curl_exec($ch);
    if ($response === false) {
        throw new RuntimeException('Mail relay unreachable: ' . curl_error($ch));
    }
    $result = json_decode($response, true);
    if (empty($result['success'])) {
        throw new RuntimeException('Mail relay failed: ' . ($result['error'] ?? 'unknown'));
    }
    return $result;
}
```

### Python

```python
import os, requests

def send_mail(account: str, to: str, subject: str, html: str) -> dict:
    account_key = account.upper()
    res = requests.post(
        os.environ["MAIL_RELAY_URL"],
        headers={"X-API-Key": os.environ["MAIL_RELAY_API_KEY"]},
        json={
            "smtpUsername": os.environ[f"MAIL_{account_key}_USERNAME"],
            "smtpPassword": os.environ[f"MAIL_{account_key}_PASSWORD"],
            "to": to, "subject": subject, "html": html,
        },
        timeout=60,
    )
    result = res.json()
    if not result.get("success"):
        raise RuntimeError(f"Mail relay failed: {result.get('error')}")
    return result
```

## 注意事项

- **超时设置 ≥ 60 秒**：relay 是同步发送的，SMTP 握手偶尔较慢。
- **API key 和每个邮箱的 smtpUsername/smtpPassword 只放环境变量**，不要写进代码、不要提交进 git。
- **必须走 HTTPS**：现在真实邮箱密码会跟着每次请求一起传输，如果 `MAIL_RELAY_URL` 还是 `http://`，密码是明文过网的。确认 relay 已经配好 Nginx + HTTPS 证书，且 `MAIL_RELAY_URL` 用 `https://` 开头，不要再用裸 IP + 明文端口。
- **不要重试 400/401**：这两类是请求本身的问题，重试没有意义；只有网络错误或 502 才值得重试（建议最多 2 次，间隔几秒）。
- **relay 不做队列**：请求返回 `success:true` 即表示 SMTP 服务器已接受该邮件。如果应用有大批量群发需求，请在应用侧自行控制节奏，避免触发 Titan 的发送频率限制。
- 附件用 base64 编码放 `content` 字段，整个请求体上限 10 MB。

## 验收标准

改造完成后：

1. `GET /health` 从 DigitalOcean 服务器上 curl 通。
2. 应用原有的每个发信场景（注册、通知、密码重置等）各实测一封，邮件实际送达且 relay 返回 `success:true`，且确认用的是场景对应的那个邮箱账号发出（收件时检查发件人地址）。
3. 应用代码里不再残留任何直连 SMTP 的调用路径。
4. 不传 `smtpUsername`/`smtpPassword` 时应收到 400 + `Fields "smtpUsername" and "smtpPassword" are required`，确认应用没有漏传这两个字段的路径。
