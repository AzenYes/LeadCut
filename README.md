# LeadCut

**基于 Recordly 二次开发、为 Agent 协作剪辑而改造的开源 Windows 录屏与视频编辑器。**

LeadCut 让 Codex 等支持 MCP 的 Agent 直接读取和编辑原生工程。你可以用它手动录制、剪辑和导出，也可以让 Agent 先从录屏里找停顿、读转写、做粗剪和加字幕，再打开同一份可编辑工程逐刀复核。确认后，可以在桌面端导出，也可以让 Agent 调用 LeadCut 导出成片。

[下载 Windows x64 安装包](https://github.com/AzenYes/LeadCut/releases/latest) · [接入 Agent](#接入-agent) · [功能清单](#功能清单) · [报告问题](https://github.com/AzenYes/LeadCut/issues)

## 为 Agent 改造了什么

- **读取录屏和工程。** 本地 MCP 可以读取工程、媒体信息和时间轴，抽取画面、检测静音、读取录制标记与按键事件，也可以调用本地语音识别并保存带时间戳的转写。录制时标记的口误或精彩片段，剪辑时可以直接按时间定位。
- **编辑同一条时间轴。** 工程分别记录源素材时间和剪辑后时间。Agent 可以按任一时间基准指定删减区间，在重排和变速后仍能定位原片。波纹剪切会对齐受影响的未锁定视频与音频轨。Agent 还可以增删改缩放、编辑原生字幕，以及拟定章节和样式。
- **复核与恢复修改。** Agent 可以复制工程并试算修改，正式写入时会校验工程版本并生成备份。编辑器占用工程时会阻止 Agent 写入。你可以按剪切记录逐刀复核、恢复片段，或留下重剪备注交给 Agent。版本历史支持预览和恢复整个工程。
- **调用桌面端导出。** 配好 LeadCut 的可执行文件后，Agent 可以用原生导出工具生成 MP4，沿用工程的字幕、章节和画面设置。工具会验证输出并返回文件路径、时长、帧数、分辨率和编码器等信息。

例如，把一段软件演示交给 Agent，要求它**复制工程，参考录制标记和转写删掉口误重说与长停顿，保留关键操作，补字幕和章节草稿**。然后在 LeadCut 里试听切口、校对字幕、确认章节并导出。章节确认后会出现在预览和成片底部。如果后来又剪切、变速或重排，需要重新核对章节边界。

## 功能清单

以下以 LeadCut 的开发基线为参照。[Recordly v1.4.0](https://github.com/webadderallorg/Recordly/releases/tag/v1.4.0)

| 环节 | 从 Recordly 继承的能力 | LeadCut 的新增与改进 |
| --- | --- | --- |
| 录屏 | 录制整屏或指定窗口，可同时采集系统声音、麦克风和摄像头。录制完成后直接进入编辑器，也可导入已有视频。 | 录制时可标记待剪和高光位置、在画面上实时标注，并按需把按键记录变成可编辑的屏幕提示。增加麦克风电平、磁盘空间提示和中断录制恢复。 |
| 时间轴与音频 | 拖放剪辑、裁剪画面、调整片段顺序和速度，添加视频和音频素材，查看音频波形和调整片段音量。 | 加强原声、系统声音和麦克风的波形定位与试听，波形随剪切、重排和变速同步。支持跨轨框选、批量切割和删除，以及在同类轨道间移动素材。 |
| 画面与动效 | 手动缩放和基于光标活动的自动缩放建议。可设置鼠标显隐、大小、平滑、点击效果和动感模糊，添加文字、图片和图形标注。支持摄像头画中画、镜像、圆角和阴影，以及壁纸、纯色或渐变背景、边距和画面比例。 | 可保存摄像头整体缩放预设，编辑按键提示的显示内容和样式，添加带标题的原生章节进度条。 |
| 字幕 | 下载模型后在本地识别语音，手动添加或编辑字幕，支持拆分、合并，以及随 MP4 导出 SRT 和 VTT。 | 支持导入 SRT。在连续文稿里联动播放、跳转时间码、查找替换、按文字光标拆分和检查字幕问题。可根据选中的字幕剪掉对应画面和声音。支持自定义字体、描边、投影和底板，并保存命名样式预设。 |
| 工程与校对 | 本地保存和重开工程、自定义快捷键。 | 使用独立的 `.leadcut` 格式，兼容转换 `.recordly` 和 `.openscreen` 工程并保留备份。支持丢失素材重链接、逐帧和倍速校对、独立预览、剪切记录和版本历史。 |
| 导出 | MP4 和 GIF，支持画幅、质量等设置，以及 GIF 帧率、尺寸和循环选项。上游也提供实验性的 NVIDIA CUDA 导出。 | MP4 支持手动视频码率，导出前检查章节状态、字幕字体和磁盘空间，并可通过 MCP 调用桌面端导出。 |

## 安装与使用

公开安装包面向 Windows x64。下载 `LeadCut-*-windows-x64.exe` 后运行安装向导。Windows 10 2004（Build 19041）及更新版本可使用原生 Windows 屏幕采集。[GitHub Releases](https://github.com/AzenYes/LeadCut/releases/latest)

录制、编辑和导出都在本机完成，无需账号。应用数据默认位于 `%APPDATA%\LeadCut`，安装后可双击 `.leadcut` 打开工程。工程文件引用原始视频和音频，搬迁、备份或从开发版升级时请一并保留源素材。

## 接入 Agent

MCP 是一个单独运行的本地服务。下载本仓库源码，在 `services/leadcut-mcp` 目录运行以下命令。服务需要 Node.js 20+、FFmpeg 和 ffprobe。

```powershell
npm ci
npm run build
node scripts/call-tool.mjs --list
```

以 Codex 为例，将下方路径换成你本机的绝对路径，加入 Codex 的 MCP 配置并重启客户端。

```toml
[mcp_servers.leadcut]
command = "node"
args = ["C:/path/to/LeadCut/services/leadcut-mcp/dist/index.js"]
```

如果工程已在桌面端打开，先保存并返回主页，再交给 Agent。写入流程、工具参数、本地语音识别依赖和原生导出配置见 [LeadCut MCP 文档](services/leadcut-mcp/README.md)。

## 从源码构建

构建 Windows x64 安装包需要 Node.js 22.12+（x64）、Visual Studio 2022 或 Build Tools（含 C++ 桌面开发工作负载和 Windows SDK）以及 CMake。首次构建需要联网下载依赖。

```powershell
git clone https://github.com/AzenYes/LeadCut.git
cd LeadCut
npm ci
npm run build:waveform
npm run smoke:packaged-binaries
```

安装包生成在 `release/`。运行 `npm run dev` 启动开发环境，运行 `npm test` 执行单元测试。

## 上游与许可证

LeadCut 基于 Recordly 1.4.0 开发。Recordly 源自 Siddharth Vaddem 的 OpenScreen 项目。感谢上游作者与贡献者。[Recordly](https://github.com/webadderallorg/Recordly) · [OpenScreen](https://github.com/siddharthvaddem/openscreen)

桌面应用按 AGPL-3.0 发布。许可、归属及第三方组件见 [LICENSE.md](LICENSE.md) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
