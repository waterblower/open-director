# Open Director

[English](./README.en.md)

Open Director (开放导演)
是一款本地运行的AI视频生成工具。所有素材资产、生成结果都储存在本地。你的本地文件夹就是你的项目文件夹。

开发者不搭载任何服务器，储存或中转你的数据。

AI生成的实际运行由模型提供商负责。目前支持3个模型提供商：

1. 火山引擎（字节跳动官方Seedance）
2. Minimax 官方
3. Fal AI

如有需求，后续会加入更多模型提供商。

# 使用

本软件支持Windows、Mac、Linux。目前还没有发行版，需要从源代码直接运行。

# 开发

## 依赖

本软件使用 `Deno` 开发。需要先从 https://deno.com 下载。

## 运行

`git clone` 后运行

```
deno task dev
```
