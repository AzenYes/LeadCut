#include <windows.h>
#include <shobjidl.h>
#include <shlwapi.h>
#include <thumbcache.h>
#include <wincodec.h>
#include <wrl/client.h>
#include <cstdio>
#include <vector>
using Microsoft::WRL::ComPtr;

// Uses the same Shell image factory as Explorer; THUMBNAILONLY rules out icons.
int wmain(int argc, wchar_t** argv) {
    if (argc < 3) return 2;
    HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(hr)) return 3;
    ComPtr<IShellItemImageFactory> factory;
    hr = SHCreateItemFromParsingName(argv[1], nullptr, IID_PPV_ARGS(&factory));
    HBITMAP image = nullptr;
    if (SUCCEEDED(hr)) hr = factory->GetImage({256,256}, SIIGBF_THUMBNAILONLY, &image);
    if (SUCCEEDED(hr)) {
        ComPtr<IWICImagingFactory> wic;
        hr = CoCreateInstance(CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&wic));
        ComPtr<IWICBitmap> bitmap;
        if (SUCCEEDED(hr)) hr = wic->CreateBitmapFromHBITMAP(image, nullptr, WICBitmapUsePremultipliedAlpha, &bitmap);
        ComPtr<IWICStream> stream;
        if (SUCCEEDED(hr)) hr = wic->CreateStream(&stream);
        if (SUCCEEDED(hr)) hr = stream->InitializeFromFilename(argv[2], GENERIC_WRITE);
        ComPtr<IWICBitmapEncoder> encoder;
        if (SUCCEEDED(hr)) hr = wic->CreateEncoder(GUID_ContainerFormatPng, nullptr, &encoder);
        if (SUCCEEDED(hr)) hr = encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache);
        ComPtr<IWICBitmapFrameEncode> frame;
        if (SUCCEEDED(hr)) hr = encoder->CreateNewFrame(&frame, nullptr);
        if (SUCCEEDED(hr)) hr = frame->Initialize(nullptr);
        if (SUCCEEDED(hr)) hr = frame->WriteSource(bitmap.Get(), nullptr);
        if (SUCCEEDED(hr)) hr = frame->Commit();
        if (SUCCEEDED(hr)) hr = encoder->Commit();
        BITMAP info{}; GetObject(image, sizeof(info), &info);
        std::printf("Shell thumbnail: %ldx%ld; HRESULT=0x%08lx\n", info.bmWidth, info.bmHeight, hr);
        DeleteObject(image);
    } else std::printf("Shell thumbnail failed: HRESULT=0x%08lx\n", hr);
    factory.Reset(); CoUninitialize();
    return SUCCEEDED(hr) ? 0 : 1;
}
