cmake_minimum_required(VERSION 3.24)

project(recordly_nvidia_cuda_compositor LANGUAGES CXX CUDA)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CUDA_STANDARD 17)
set(CMAKE_CUDA_STANDARD_REQUIRED ON)

set(RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT
  "${CMAKE_CURRENT_LIST_DIR}/../../../.tmp/video-sdk-samples"
  CACHE PATH
  "Path to the NVIDIA Video Codec SDK samples checkout"
)
set(NVIDIA_SAMPLES_DIR "${RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT}/Samples")
set(NVCODEC_DIR "${NVIDIA_SAMPLES_DIR}/NvCodec")

if(NOT EXISTS "${NVCODEC_DIR}")
  message(FATAL_ERROR "NVIDIA Video Codec SDK NvCodec directory not found: ${NVCODEC_DIR}. Set RECORDLY_NVIDIA_VIDEO_CODEC_SDK_ROOT.")
endif()

# Build the SDK encoder samples against the same NVENC header as LeadCut.
# The encoder header includes nvEncodeAPI.h from its own directory.
set(NVCODEC_ENCODER_ROOT "${CMAKE_CURRENT_BINARY_DIR}/nvenc")
set(NVCODEC_ENCODER_DIR "${NVCODEC_ENCODER_ROOT}/NvEncoder")
foreach(encoder_file NvEncoder.h NvEncoder.cpp NvEncoderCuda.h NvEncoderCuda.cpp)
  configure_file("${NVCODEC_DIR}/NvEncoder/${encoder_file}"
    "${NVCODEC_ENCODER_DIR}/${encoder_file}" COPYONLY)
endforeach()
configure_file(third_party/nvEncodeAPI.h "${NVCODEC_ENCODER_DIR}/nvEncodeAPI.h" COPYONLY)

add_executable(recordly-nvidia-cuda-compositor
  src/main.cu
  "${NVCODEC_DIR}/NvDecoder/NvDecoder.cpp"
  "${NVCODEC_ENCODER_DIR}/NvEncoder.cpp"
  "${NVCODEC_ENCODER_DIR}/NvEncoderCuda.cpp"
)

target_include_directories(recordly-nvidia-cuda-compositor PRIVATE
  "${NVCODEC_ENCODER_ROOT}"
  "${NVIDIA_SAMPLES_DIR}"
  "${NVCODEC_DIR}"
)

target_compile_definitions(recordly-nvidia-cuda-compositor PRIVATE
  NOMINMAX
  WIN32_LEAN_AND_MEAN
)

find_package(CUDAToolkit REQUIRED)
target_link_libraries(recordly-nvidia-cuda-compositor PRIVATE
  CUDA::cuda_driver
  "${NVCODEC_DIR}/Lib/x64/nvcuvid.lib"
)

set_target_properties(recordly-nvidia-cuda-compositor PROPERTIES
  CUDA_SEPARABLE_COMPILATION OFF
)
