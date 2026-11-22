# LeadCut

LeadCut 是一款基于 Recordly 的开源屏幕录制与视频剪辑工具。它可以在本机完成录屏、编辑和导出。首个公开预览版为 Windows x64 的 0.1.0。

## 安装

打开本仓库的 Releases 下载 LeadCut-0.1.0-windows-x64.exe，运行安装向导。Windows 会将 .leadcut 工程文件关联到 LeadCut。应用数据默认位于 %APPDATA%\LeadCut。

如果之前安装过本地开发版，请先保存项目并备份项目文件。工程引用原始视频和音频文件，移动或备份工程时请一并保留源素材。

## 主要功能

- 录制整个屏幕或指定窗口，可同时记录系统声音、麦克风、摄像头和按键提示。
- 在多轨时间轴剪切、调整顺序、变速和缩放。原声、麦克风和系统声音支持查看波形。
- 手动添加字幕、导入 SRT 或下载模型进行本地语音识别。在字幕文稿中校对文字和时间码。
- 添加章节进度条、标注、鼠标效果、摄像头叠加和背景，导出 MP4 或 GIF。
- 打开 .leadcut 工程。打开 .recordly 或 .openscreen 工程时可转换成 .leadcut，原工程会保留备份。

## 从源码构建 Windows x64 安装包

准备 Node.js 22.12 或更高版本（x64）、带 C++ 桌面开发工作负载和 Windows SDK 的 Visual Studio 2022，以及 CMake。首次构建需要联网下载依赖。

    npm ci
    npm run build:waveform
    npm run smoke:packaged-binaries

安装包位于 release/ 目录。运行 npm run dev 可以启动开发环境，运行 npm test 可以执行单元测试。可选的 MCP 服务及用法见 [服务说明](services/leadcut-mcp/README.md)。

## 上游与许可证

LeadCut 基于 [Recordly](https://github.com/webadderallorg/Recordly) 1.4.0。Recordly 源自 Siddharth Vaddem 的 OpenScreen 项目。LeadCut 对本地录制、编辑、字幕、章节和 Windows 安装进行了修改。

桌面应用按 AGPL-3.0 发布。完整许可和归属请参阅 [LICENSE.md](LICENSE.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
