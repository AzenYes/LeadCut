#!/usr/bin/env bash
# Build the shared Windows x64 FFmpeg and FFprobe runtime on Ubuntu 22.04.
# An optional second argument supplies the pinned archives and an AMF checkout.
set -euo pipefail

destination=$(realpath -m "${1:?Pass a directory for the Windows media tools}")
source_cache=
if [[ -n ${2:-} ]]; then source_cache=$(realpath "$2"); fi
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
prefix="$work/windows"
jobs=$(nproc)
if ((jobs > 8)); then jobs=8; fi

download() {
  local url=$1 checksum=$2 archive=$3 directory=$4
  if [[ -n $source_cache ]]; then
    cp "$source_cache/$archive" "$work/$archive"
  else
    curl --fail --location --silent --show-error --retry 2 --max-time 120 "$url" -o "$work/$archive"
  fi
  printf '%s  %s\n' "$checksum" "$work/$archive" | sha256sum --check
  mkdir -p "$work/$directory"
  tar -xf "$work/$archive" -C "$work/$directory" --strip-components=1
}

download https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz \
  8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968 ffmpeg.tar.xz ffmpeg
download https://deb.debian.org/debian/pool/main/x/x264/x264_0.164.3095+gitbaee400.orig.tar.gz \
  8b237e94b08c196a1da22f2f25875f10be4cff3648df4eeff21e00da8f683fc2 x264.tar.gz x264
download https://codeload.github.com/FFmpeg/nv-codec-headers/tar.gz/refs/tags/n12.1.14.0 \
  2fefaa227d2a3b4170797796425a59d1dd2ed5fd231db9b4244468ba327acd0b nv-codec-headers.tar.gz nv-codec-headers
download https://codeload.github.com/intel/libvpl/tar.gz/refs/tags/v2.10.2 \
  ad956ea7ecf14614325f59dfb44cc5ba08e2fcac373342d61c7db152ac651253 libvpl.tar.gz libvpl
download https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz \
  9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23 zlib.tar.gz zlib
download https://downloads.videolan.org/pub/videolan/dav1d/1.5.4/dav1d-1.5.4.tar.xz \
  686616b7c69eb88d44459391ab25cac13b6647a3b288835c5784e71c1514a5c5 dav1d.tar.xz dav1d

amf_commit=e8c7cd7c10d4e05c1913aa8dfd2be9f9dbdb03d6
amf_repository="$work/amf-repository"
if [[ -n $source_cache ]]; then
  amf_repository="$source_cache/amf"
else
  git clone --quiet --no-checkout --filter=blob:none --depth=1 --branch v1.4.33 \
    https://github.com/GPUOpen-LibrariesAndSDKs/AMF.git "$amf_repository"
  git -C "$amf_repository" sparse-checkout set amf/public/include
  git -C "$amf_repository" -c advice.detachedHead=false checkout --quiet
fi
mkdir -p "$prefix/include/AMF" "$work/amf"
git -C "$amf_repository" -c safe.directory="$amf_repository" ls-tree -r --name-only "$amf_commit" -- \
  LICENSE.txt amf/public/include > "$work/amf-files.txt"
while IFS= read -r file; do
  mkdir -p "$(dirname "$work/amf/$file")"
  git -C "$amf_repository" -c safe.directory="$amf_repository" cat-file blob "$amf_commit:$file" > "$work/amf/$file"
done < "$work/amf-files.txt"
cp -a "$work/amf/amf/public/include/." "$prefix/include/AMF/"

export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"

cd "$work/dav1d"
cat > mingw64.ini <<'EOF'
[binaries]
c = 'x86_64-w64-mingw32-gcc'
ar = 'x86_64-w64-mingw32-ar'
strip = 'x86_64-w64-mingw32-strip'
windres = 'x86_64-w64-mingw32-windres'

[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
EOF
meson setup out --cross-file mingw64.ini --prefix="$prefix" --libdir=lib \
  --buildtype=release --default-library=static -Denable_tools=false -Denable_tests=false
meson compile -C out -j "$jobs"
meson install -C out

cd "$work/libvpl"
cmake -S . -B out -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
  -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++ \
  -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres -DCMAKE_INSTALL_PREFIX="$prefix" \
  -DBUILD_SHARED_LIBS=ON -DBUILD_EXAMPLES=OFF -DBUILD_TOOLS=OFF \
  -DCMAKE_SHARED_LINKER_FLAGS='-static-libgcc -static-libstdc++'
cmake --build out --parallel "$jobs"
cmake --install out

cd "$work/zlib"
cmake -S . -B out -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_SYSTEM_PROCESSOR=x86_64 \
  -DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc -DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres \
  -DCMAKE_INSTALL_PREFIX="$prefix" -DZLIB_BUILD_EXAMPLES=OFF
cmake --build out --target zlibstatic --parallel "$jobs"
cp zlib.h out/zconf.h "$prefix/include/"
cp out/libzlibstatic.a "$prefix/lib/libz.a"

cd "$work/x264"
./configure --host=x86_64-w64-mingw32 --cross-prefix=x86_64-w64-mingw32- \
  --prefix="$prefix" --disable-cli --enable-static
make -j "$jobs"
make install
make -C "$work/nv-codec-headers" PREFIX="$prefix" install

cd "$work/ffmpeg"
./configure --target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- \
  --enable-cross-compile --disable-doc --disable-debug --disable-ffplay \
  --disable-autodetect --enable-gpl --enable-version3 --disable-static --enable-shared \
  --enable-libx264 --enable-ffnvcodec --enable-nvenc --enable-nvdec --enable-d3d11va \
  --enable-dxva2 --enable-mediafoundation --enable-schannel --enable-zlib --enable-amf --enable-libvpl \
  --enable-libdav1d --enable-cuvid --enable-cuda-llvm --nvcc=clang-14 --host-cc=clang-14 \
  --pkg-config=pkg-config --pkg-config-flags=--static \
  --extra-cflags="-I$prefix/include" --extra-ldflags="-L$prefix/lib -static-libgcc"
make -j "$jobs" ffmpeg.exe ffprobe.exe

output="$work/output"
mkdir -p "$output/licenses" "$destination"
cp ffmpeg.exe ffprobe.exe lib*/*-[0-9]*.dll "$prefix/bin/libvpl.dll" \
  /usr/x86_64-w64-mingw32/lib/libwinpthread-1.dll "$output/"
x86_64-w64-mingw32-strip "$output"/*.dll "$output"/*.exe
cp COPYING.GPLv3 "$output/licenses/FFmpeg.txt"
cp "$work/x264/COPYING" "$output/licenses/x264.txt"
cp "$work/libvpl/LICENSE" "$output/licenses/Intel-VPL.txt"
cp "$work/zlib/LICENSE" "$output/licenses/zlib.txt"
cp "$work/dav1d/COPYING" "$output/licenses/dav1d.txt"
cp "$work/amf/LICENSE.txt" "$output/licenses/AMD-AMF.txt"
for header in "$work"/nv-codec-headers/include/ffnvcodec/*.h; do
  sed '/\*\//q' "$header"
done > "$output/licenses/NVIDIA-codec-headers.txt"
cp /usr/share/doc/mingw-w64-x86-64-dev/copyright "$output/licenses/MinGW-w64.txt"
(cd "$output" && sha256sum *.dll *.exe > SHA256SUMS.txt)
cp -a "$output/." "$destination/"
