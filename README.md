# gh-proxy

一个面向自部署的 GitHub 资源代理与加速项目，支持：

- release 文件下载
- archive 源码包下载
- blob/raw 文件访问
- gist 原始文件访问
- 部分 `git clone` / `info/refs` 请求转发
- Cloudflare Workers 部署
- Python 3.11+ 自部署
- **短路径访问**：`/owner/repo/...`

> 当前仓库已不再只是上游 fork 的镜像副本，已经加入了面向自部署场景的整理与增强，包括短路径支持、Python 3.11+ 运行栈、本地静态首页等改造。

## 特性

### 1. 两种访问格式

#### 完整 URL 格式
```text
https://your-proxy.com/https://github.com/owner/repo/releases/download/v1.0.0/file.zip
```

#### 简短路径格式
```text
https://your-proxy.com/owner/repo/releases/download/v1.0.0/file.zip
```

同样适用于：

- `archive/...`
- `blob/...`
- `raw/...`
- `info/refs?...`
- `git-*`

### 2. 支持的资源类型

- GitHub release 文件
- GitHub release/archive 源码包
- GitHub blob/raw 文件
- `raw.githubusercontent.com`
- `gist.githubusercontent.com`
- `git clone` 相关请求的一部分代理路径

### 3. Python 版增强

相比 Worker 版，Python 版额外支持：

- 文件大小限制
- 白名单 / 黑名单 / pass_list
- 自定义服务器部署
- 本地静态首页与 favicon

---

## 快速开始

## Cloudflare Workers 部署

适合：
- 轻量使用
- 不想养后端服务器
- 想快速上线一个边缘代理

### 步骤
1. 打开 Cloudflare Workers
2. 新建 Worker
3. 将仓库中的 `index.js` 内容粘贴进去
4. 保存并部署
5. 绑定你的自定义域名（可选）

### 关键配置

#### `ASSET_URL`
静态首页资源地址。

#### `PREFIX`
路径前缀，默认是 `/`。

如果你的路由挂在：
```text
https://example.com/gh/*
```
则应设置：
```js
const PREFIX = '/gh/'
```

---

## Python 版本部署

适合：
- 自建服务器
- 需要更强控制能力
- 需要白名单 / 黑名单 / 大小限制

### Docker 部署（Python 3.11+）

```bash
docker build -t gh-proxy-py:py311 .
docker run -d --name gh-proxy-py \
  -p 0.0.0.0:80:80 \
  --restart=always \
  gh-proxy-py:py311
```

### 直接运行

```bash
pip install -r requirements.txt
cd app
gunicorn --bind 127.0.0.1:8000 main:app
```

### Python 版说明

当前 Python 运行栈已调整为：
- Python 3.11+
- Flask 3.x
- Gunicorn

已移除旧的：
- `python3.7 + uwsgi-nginx`
- `entrypoint.sh`
- `uwsgi.ini`

---

## Web UI

Python 版首页现在使用仓库内置静态资源：

- `app/static/index.html`
- `app/static/favicon.ico`

这意味着：
- 服务启动不再依赖外网拉首页
- 你可以直接修改本地 HTML 做定制

---

## 使用示例

### release 文件
```text
https://your-proxy.com/owner/repo/releases/download/v1.0.0/example.zip
```

### archive 源码包
```text
https://your-proxy.com/owner/repo/archive/master.zip
```

### blob 文件
```text
https://your-proxy.com/owner/repo/blob/master/README.md
```

### 私有仓库 clone
```text
git clone https://user:TOKEN@your-proxy.com/https://github.com/owner/private-repo
```

---

## 兼容性说明

### Worker 版
- 适合轻量代理
- 逻辑简单
- 部署快

### Python 版
- 适合长期自部署
- 控制能力更强
- 更适合做私有或小范围公共服务

---

## 已完成的本仓库改造

- 增加短路径支持：`/owner/repo/...`
- Python 3.11+ 适配
- Docker 运行栈现代化
- `gunicorn` 替代旧 `uwsgi-nginx`
- 首页静态资源本地化
- 删除废弃部署文件
- README 重写

---

## 注意事项

- 大流量公共使用请自行加限流、缓存和鉴权
- 代理服务天然存在被滥用风险，不建议裸奔公网长期开放
- 如需自定义首页，可直接修改 `app/static/index.html`

---

## License

MIT
