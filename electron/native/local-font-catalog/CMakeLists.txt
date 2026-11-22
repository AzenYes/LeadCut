cmake_minimum_required(VERSION 3.20)
project(leadcut-local-font-catalog LANGUAGES CXX)

set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_executable(leadcut-local-font-catalog src/main.cpp)
target_compile_features(leadcut-local-font-catalog PRIVATE cxx_std_17)
target_compile_options(leadcut-local-font-catalog PRIVATE /EHsc /W4 /utf-8)
target_link_libraries(leadcut-local-font-catalog PRIVATE dwrite)
