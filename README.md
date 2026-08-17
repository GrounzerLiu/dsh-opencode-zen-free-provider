# dsh-opencode-zen-free-provider

OpenCode Zen Free provider for dsh.

[English](README.en.md)

<img height="650" alt="image" src="https://github.com/user-attachments/assets/8cc57d90-76b8-4a7d-a9fe-1ebb39c4f51c" />

本插件可以将 OpenCode Zen 的免费模型接入 dsh 使用。插件启动时会从 OpenCode Zen 和 models.dev 同步模型目录、包含 Reasoning Effort 和所有元数据。

其中 DeepSeek V4 Flash 额外支持到 1M 上下文。

## 安装

从 npm 安装（预构建产物，推荐）：

```sh
dsh plugin --profile web add @jiesou/dsh-opencode-zen-free-provider
```

或从 GitHub 安装：

```sh
dsh plugin --profile web add github:jiesou/dsh-opencode-zen-free-provider
```

## 安装之后

模型列表**无需任何配置**，插件启动时会自动从远程同步并过滤所有免费模型。在 Web Models 页面选择 OpenCode Zen Free 和模型后即可开始使用。

## License

[MIT](LICENSE)
