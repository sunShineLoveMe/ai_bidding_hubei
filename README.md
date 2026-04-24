# 清江峡能精密制造 AI 标书系统

基于大语言模型 (LLM) 与检索增强生成 (RAG) 技术的内网智能标书编制系统。本项目面向湖北恩施清江峡能精密制造厂，围绕三峡集团及相关水电装备供应链业务，覆盖水轮机叶片、专用螺母、紧固件、金属结构件、设备配套加工、质量检验、交付保障和现场服务等投标场景，通过结合本地知识库高精度检索与大模型文本生成能力，实现招投标文件的自动化分析、撰写、排版、在线编辑与导出。

> 本项目为清江峡能精密制造厂内网部署的 AI 标书系统，核心链路包括招标文件解析、企业知识库检索、投标章节设计、投标正文生成、Word 排版导出与 OnlyOffice 在线编辑。

---

## 🛠️ 技术栈 (Tech Stack)

* **核心语言:** Python 3.9+
* **后端 Web 框架:** Flask + Flask-CORS，详见 `main.py` 与 `routes.py`
* **前端当前实现:** Vite + React 18 + TypeScript 组件化工程，源码位于 `frontend/`
* **前端页面形态:** 单机版后台工作台，包含顶部栏、左侧导航、首页 Banner、智能标书入口、基础工具、最近任务、知识库状态、标书生成流程和 AI 助手浮窗
* **前端 UI 组件:** Ant Design 5 + Tailwind CSS + lucide-react
* **前端路由:** React Router
* **前端服务端状态:** TanStack Query
* **前端全局状态:** Zustand
* **前端编辑器预留:** TipTap，用于后续章节正文编辑器能力
* **前端接口调用:** Axios + FormData，直接调用 `/api/users/*`、`/api/bidding/*`、`/api/outputs/*`
* **前端资源管理:** `frontend/public/assets/` 与 Vite 构建资源，生产环境由 Flask `/assets/<filename>` 路由托管
* **在线文档编辑前端集成:** 现阶段 Word 生成和下载已接入；OnlyOffice 在线编辑配置仍由后端生成，后续放入 React 编辑器页
* **大语言模型:** 通义千问 (Qwen)
* **向量数据库:** ChromaDB (本地化运行)
* **关系型数据库:** SQLite
* **文档处理:** `python-docx` / Markdown 解析库

### 前端技术框架说明

当前版本定位为 **企业单机部署版 MVP**，前端已按 `AI标书系统前端技术选型建议.md` 迁移为 Vite + React + TypeScript 组件化工程：

```text
frontend/
→ Vite 构建与开发服务
→ React 组件化页面
→ Ant Design 负责表格、按钮、上传、步骤条、消息提示等企业级组件
→ Tailwind CSS 负责固定布局、工作台卡片、首页视觉样式
→ React Router 保留后续多页面扩展能力
→ TanStack Query 作为服务端状态基础设施
→ Zustand 管理 AI 助手和最近任务等轻量状态
→ Axios 封装后端 API 调用
```

当前采用的前端技术框架如下：

```text
React 18
Vite
TypeScript
Ant Design 5
Tailwind CSS
React Router
TanStack Query
Zustand
TipTap
lucide-react
```

前端构建产物输出到 `frontend/dist/`。后端 `main.py` 会优先托管该目录下的 `index.html` 和 Vite 静态资源；未构建时，访问 `/bidding` 会提示先执行前端构建。

## 📁 核心目录结构

```text
ai_bidding/
├── main.py                # 后端服务入口文件
├── routes.py              # 核心业务路由及 API 接口定义
├── users.py               # 用户认证与权限管理模块
├── qwen_client.py         # 大模型 API 封装与调用链路
├── file_to_chroma.py      # 知识库文档解析与 Chroma 向量化持久化
├── md_to_word.py          # Markdown 转 Word (.docx) 排版导出引擎
├── frontend/              # Vite + React + TypeScript 前端工程
│   ├── src/               # 前端源码，按 api/components/pages/stores/types/utils 拆分
│   ├── public/assets/     # 前端公共静态资源
│   └── dist/              # npm run build 后生成的生产构建产物
├── bidding_workbench.html # 旧版静态工作台页面，当前生产入口已切换到 frontend/dist
├── assets/                # 后端静态资源兜底目录
├── chroma_db/             # ChromaDB 向量数据库本地存储目录
├── bidding.db             # SQLite 关系型数据库文件
└── .env                   # 环境变量与敏感配置 (API Keys 等)
```

# AI招投标项目使用说明

## 💻 环境依赖与前置软件 (Prerequisites)

为了完整运行本项目，你需要在本地或服务器上安装以下基础软件：

* Python 3.9+
* Docker（用于部署 ONLYOFFICE 和独立的向量数据库服务）

## 🐳 Docker 部署必需服务

### 1. 部署 ONLYOFFICE 文档服务器 (必须)

系统依赖 ONLYOFFICE 实现文档的在线预览和编辑。请运行以下命令启动服务（此处传入的 `JWT_SECRET` 必须与下方 `.env` 配置文件中的保持一致）：

```bash
docker run -i -t -d -p 80:80 \
  --restart=always \
  -e JWT_SECRET=fsdftertrt34768586sfhjsdhfjhhjfsuhaiubue \
  onlyoffice/documentserver
```

### 2. 部署 ChromaDB 向量数据库 (可选)

注意：当前后端代码默认使用了 Chroma 的本地持久化客户端（数据保存在本地 `chroma_db/` 目录），因此无需额外部署即可运行。

如果你希望将向量数据库作为独立服务运行以提升性能和解耦，可以使用以下 Docker 命令启动：

```bash
docker run -d -p 8000:8000 \
  -v ./chroma_data:/chroma/chroma \
  --name chromadb \
  chromadb/chroma
```

(如使用独立服务，请相应修改代码中的 Chroma 客户端连接方式)

## 快速开始 (Quick Start)

### 1. 克隆项目

```bash
git clone <内网代码仓库地址>
cd ai_bidding
```

### 2. 安装 Python 依赖

建议使用虚拟环境：

```bash
# 创建并激活虚拟环境
python -m venv venv
source venv/bin/activate  # Linux/Mac
# venv\Scripts\activate   # Windows

pip install -r requirements.txt
```

### 2.1 安装并构建前端

当前前端采用 Vite + React 工程，首次运行或前端代码变更后需要执行：

```bash
cd frontend
npm install
npm run build
cd ..
```

开发调试前端时可运行：

```bash
cd frontend
npm run dev
```

Vite 开发服务默认启动在 `http://localhost:5173`，并通过 `vite.config.ts` 将 `/api` 请求代理到 Flask 后端。

### 3. 配置环境变量

在项目根目录创建或修改 `.env` 文件，配置以下核心参数：

```ini
# 阿里云百炼 (通义千问) API Key
DASHSCOPE_API_KEY=your_dashscope_api_key_here

# ONLYOFFICE 配置 (需与 Docker 启动时传入的密钥一致)
ONLYOFFICE_JWT_SECRET=fsdftertrt34768586sfhjsdhfjhhjfsuhaiubue

# 宿主机与 Docker 容器间的通信地址配置
BACKEND_URL_FOR_DOCKER=host.docker.internal:3012
APP_HOST=<服务器地址>:3012
```

### 4. 启动后端服务

```bash
python main.py
```

服务启动后，可以通过后端暴露的 API 接口进行联调和验收。

### 5. 访问内网标书工作台

后端启动后，浏览器访问：

```text
http://<服务器地址>:3012/bidding
```

工作台提供完整业务闭环：

```text
上传招标文件 -> AI 预分析 -> 提取章节格式 -> 生成章节设计 -> 生成 Word -> OnlyOffice 在线编辑
```

注意：生产访问 `/bidding` 前，请确保已在 `frontend/` 目录执行 `npm run build` 并生成 `frontend/dist/`。

## ✅ 当前已完成任务

### 前端工程化

* 已新增 `frontend/` Vite + React 18 + TypeScript 工程。
* 已接入 Ant Design 5、Tailwind CSS、React Router、TanStack Query、Zustand、TipTap、lucide-react。
* 已将首页按组件拆分为 `HeroBanner`、`SmartBidCard`、`BasicTools`、`RecentTasks`、`KnowledgeStats`、`BidWorkflow`、`AIAssistantWidget`。
* 已实现固定 Header、固定左侧菜单、固定 Footer，中间工作区采用一屏化网格布局并避免页面级滚动。
* 已实现首页 Banner、智能标书入口、基础工具、最近任务、知识库状态和 AI 助手浮窗。
* 已将上传、AI 预分析、章节格式提取、章节设计、Word 生成流程接入现有 Flask API。
* 已完成 `npm install` 和 `npm run build`，生成 `frontend/dist/` 构建产物。

### 管理模块页面

* 已实现 **企业知识库** 页面：资料分类、知识库统计、文件列表、索引状态、重建索引和上传资料入口。
* 已实现 **企业资信库** 页面：资信分类、证照统计、资信文件表格、有效期状态、临期提醒和证照信息维护表单。
* 已实现 **企业产品库** 页面：产品分类、产品资料统计、产品与服务列表、能力标签、资料数量和产品能力维护表单。
* 已实现 **系统设置** 页面：模型配置、存储路径、文档与模板、备份恢复四类配置页签。
* 已接入前端路由：`/knowledge`、`/qualification`、`/products`、`/settings`。
* 四个模块均复用固定 Header、固定左侧菜单、固定 Footer，并采用一屏化布局避免页面级滚动。

### 后端托管调整

* `main.py` 已调整为优先托管 `frontend/dist/index.html`。
* `/assets/<filename>` 已支持优先读取 Vite 构建资源，再回退到后端 `assets/` 目录。
* 保留原有 `/api/users/*`、`/api/bidding/*`、`/api/outputs/*` 接口不变。

本地 Docker 部署 OnlyOffice 时，建议 `.env` 保持以下配置：

```ini
BACKEND_URL_FOR_DOCKER=host.docker.internal:3012
APP_PUBLIC_BASE_URL=http://host.docker.internal:3012
```

其中 `APP_PUBLIC_BASE_URL` 必须是 OnlyOffice Document Server 能访问到的后端地址。若部署在内网服务器，应改为真实内网可访问地址，例如：

```ini
APP_PUBLIC_BASE_URL=http://内网服务器地址:3012
```

若现场 OnlyOffice 服务暂不可用，工作台仍提供 Word 下载链接，可保障“AI 生成 Word 并下载”的主业务链路可用。

## 备注

前端方向

* 根据客户内网部署规范完善前端工程。
* 实现用户登录、知识库上传管理界面。
* 实现与大模型的交互对话、章节设计界面。
* 集成 ONLYOFFICE 实现生成文档的在线编辑与预览。

### 后端/AI 方向

* 优化复杂文档解析策略（如针对 PDF 的表格提取）。
* 优化 RAG 检索算法（混合检索、重排序 Rerank）。
* 完善 API 接口文档 (Swagger/OpenAPI)。
* 增加对内网私有化模型服务的适配能力。
