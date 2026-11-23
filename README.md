# AniLens · 动漫截图溯源
快捷链接：https://yueningkoria.github.io/anilens/

上传一张番剧截图、游戏 CG 或插画，识别它出自哪部作品、哪一话、哪个角色。

纯静态单页应用，无构建、无后端：所有图片只在浏览器本地处理，API Key 仅保存在本机。

## 功能

- **截图识别**：拖拽 / 点击上传、Ctrl + V 粘贴、粘贴图片直链
- **免费动画溯源**：基于 [trace.moe](https://trace.moe/)，自动过滤相似度不足 75% 的假命中，标注可信度
- **视觉模型识别**：支持任意 OpenAI 兼容的视觉模型（OpenAI / 硅基流动 / DeepSeek / 通义千问 / 智谱 / Gemini）
- **联网增强**：自动补全 AniList 封面、评分、简介、相似角色与相似作品，并翻译为中文
- **Galgame 识别**：多路召回 + 打分，联动 [VNDB](https://vndb.org/) 展示作品档案与官方截图
- **发现最新**：本季新番 / 最新新话 / 新游上线，标题自动中文化，按时间动态刷新
- **以图搜图跳转**：SauceNAO、ascii2d、IQDB、Google Lens、Yandex、萌娘百科

## 技术说明

- 纯 `HTML + CSS + 原生 JavaScript`，无框架、无打包、无依赖
- 数据源（均为公开 CORS 接口）：AniList GraphQL、trace.moe、VNDB Kana API、Steam、FreeToGame、MyMemory 翻译
- 配置持久化于 `localStorage`


## 隐私

- 上传的图片不会上传到本站服务器（本站没有服务器），仅在浏览器内处理
- 视觉模型的 API Key 保存在浏览器 `localStorage`，不会发送给本 Demo 以外的任何地方
- 识别时图片会直接发送到你配置的模型服务商，以及（免费溯源时）trace.moe

## 免责声明

识别结果仅供参考，AI 可能出错，请结合下方以图搜图工具交叉验证。数据版权归各自来源所有。
