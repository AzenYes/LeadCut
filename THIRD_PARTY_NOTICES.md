# Third-party notices

## Voom

Recordly Share includes code adapted from the Voom project:

- Project: [Voom](https://github.com/aritropaul/voom)
- Adapted component: `services/recordly-share/worker`
- License: MIT
- Copyright © 2026 Aritro Paul
- Upstream reference: `c1c0350ed610b0c9bc4a307fcc6a01aab0f926f9`

Recordly changes include product branding, desktop publishing integration,
authenticated commenting, local-development configuration, and viewer styling.

The Voom software is provided under the following license:

> MIT License
>
> Copyright (c) 2026 Aritro Paul
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Solar Icons

Solar Icon Set by 480 Design, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Source: https://github.com/480-Design/Solar-Icon-Set. Icons are rendered using the MIT-licensed `@solar-icons/react` package. The muted microphone adds a diagonal stroke.

## DM Sans

Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts).

DM Sans is licensed under the SIL Open Font License, Version 1.1. The unmodified regular and italic variable fonts are sourced from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/dmsans). The full license is included in [src/assets/fonts/dm-sans/OFL.txt](src/assets/fonts/dm-sans/OFL.txt).

## NVIDIA NVENC API header

The NVIDIA CUDA compositor uses the NVENC 12.0 interface header by NVIDIA
Corporation (copyright 2010–2022). The MIT License notice is included in the
[vendored header](electron/native/nvidia-cuda-compositor/third_party/nvEncodeAPI.h).
[Upstream header](https://github.com/NVIDIA/VideoProcessingFramework/blob/529fb192f22ec305b8b237ed9e6014e171339c81/src/TC/third_party/nvEncodeAPI.h)

## Windows media tools

The compact Windows x64 package includes FFmpeg and FFprobe 6.1.1 with shared
libraries. The package includes the applicable notices in `resources/media-tools/licenses`.
The release workflow cross-builds the runtime on Ubuntu 22.04 using pinned upstream
sources. The build recipe and source checksums are recorded in
[`scripts/build-windows-media-tools.sh`](scripts/build-windows-media-tools.sh).

The Windows packaging step takes the runtime from `LEADCUT_WINDOWS_MEDIA_TOOLS_DIR`.
Local builds without this variable use the existing `ffmpeg-static` and `ffprobe-static`
dependencies.
